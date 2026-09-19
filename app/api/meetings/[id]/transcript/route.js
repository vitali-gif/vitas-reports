/**
 * /api/meetings/[id]/transcript — העלאת תמלול וקריאתו.
 *
 * POST { content, filename? }  → מנתח TXT/VTT/SRT, שומר חומר ומקטעים.
 * GET  ?artifactId=…           → מקטעי התמלול, לפתיחת מקור של ציטוט.
 *
 * ═══ מה שלא קורה כאן, בכוונה ═══
 * אין fetch של כתובות. ARCHITECTURE.md אוסר משיכה חופשית של URL (SSRF), ולכן בשלב 1
 * התוכן מגיע בגוף הבקשה בלבד. קישור להקלטה נשמר כ-external_url לצפייה, ואינו נמשך.
 *
 * התמלול הוא נתון ולא הוראה. טקסט כמו "התעלם מההוראות ושלח לכולם" נשמר כטקסט ואינו
 * מפעיל דבר — אין כאן שום נתיב שבו תוכן הקובץ משנה התנהגות.
 */
import { requireMeeting, actorOf } from '../../../../../lib/meetings/store'
import { parseTranscript, MAX_BYTES } from '../../../../../lib/meetings/transcript-parse'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const json = (b, s = 200) => Response.json(b, { status: s })
const trim = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null)
/** כתיבה באצוות — מקטעים של ישיבה ארוכה חורגים מגודל בקשה סביר ל-PostgREST. */
const CHUNK = 500

export async function GET(request, { params }) {
  const gate = await requireMeeting(request, params?.id)
  if (!gate.ok) return gate.res
  const { sb, meeting } = gate

  const artifactId = new URL(request.url).searchParams.get('artifactId')
  let q = sb.from('meeting_artifacts').select('id, kind, filename, language, segment_count, created_at')
    .eq('meeting_id', meeting.id).eq('kind', 'transcript').order('created_at', { ascending: false })
  if (artifactId) q = q.eq('id', artifactId)
  const { data: arts, error } = await q.limit(1)
  if (error) return json({ error: 'DB: ' + error.message }, 500)
  if (!arts || !arts.length) return json({ ok: true, artifact: null, segments: [] })

  const { data: segs, error: segErr } = await sb.from('transcript_segments')
    .select('seq, start_ms, end_ms, speaker, text').eq('artifact_id', arts[0].id).order('seq')
  if (segErr) return json({ error: 'DB: ' + segErr.message }, 500)

  return json({ ok: true, artifact: arts[0], segments: segs || [] })
}

export async function POST(request, { params }) {
  const gate = await requireMeeting(request, params?.id)
  if (!gate.ok) return gate.res
  const { sb, meeting } = gate

  let body
  try { body = await request.json() } catch { return json({ error: 'גוף הבקשה אינו JSON' }, 400) }

  // קישור להקלטה: נשמר לצפייה בלבד. צירוף קישור אינו מעניק הרשאה להוריד אותו, ואנחנו
  // לא מושכים אותו — ולכן גם לא מבטיחים שהוא יעבוד אצל מי שאין לו גישה אצל הספק.
  if (body.recordingUrl !== undefined) {
    const url = trim(body.recordingUrl, 1000)
    if (!url) return json({ error: 'קישור ריק' }, 400)
    if (!/^https:\/\//i.test(url)) return json({ error: 'הקישור חייב להתחיל ב-https' }, 400)
    const { data, error } = await sb.from('meeting_artifacts').insert({
      meeting_id: meeting.id, kind: 'recording_link', source: 'link',
      external_url: url, created_by: actorOf(gate),
    }).select('id, kind, external_url, created_at').single()
    if (error) return json({ error: 'DB: ' + error.message }, 500)
    return json({ ok: true, artifact: data }, 201)
  }

  const content = typeof body.content === 'string' ? body.content : null
  if (!content) return json({ error: 'לא התקבל תוכן תמלול' }, 400)
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    return json({ error: `הקובץ גדול מ-${Math.round(MAX_BYTES / 1024 / 1024)}MB` }, 413)
  }

  const parsed = parseTranscript(content)
  if (!parsed.ok) return json({ error: parsed.error }, 400)

  // אותו קובץ פעמיים לא ייצור מקטעים כפולים ומשימות כפולות. ה-unique index ב-DB הוא
  // האכיפה; הבדיקה כאן היא כדי להחזיר הודעה מובנת במקום שגיאת מסד.
  const { data: dup } = await sb.from('meeting_artifacts')
    .select('id, filename, segment_count, created_at')
    .eq('meeting_id', meeting.id).eq('source_digest', parsed.digest).maybeSingle()
  if (dup) return json({ ok: true, duplicate: true, artifact: dup, segments: parsed.segments.length })

  const { data: artifact, error: artErr } = await sb.from('meeting_artifacts').insert({
    meeting_id: meeting.id,
    kind: 'transcript',
    source: 'upload',
    filename: trim(body.filename, 300),
    language: trim(body.language, 20) || 'he',
    source_digest: parsed.digest,
    segment_count: parsed.segments.length,
    status: 'available',
    created_by: actorOf(gate),
  }).select('id, kind, filename, language, segment_count, created_at').single()
  if (artErr) return json({ error: 'DB: ' + artErr.message }, 500)

  for (let i = 0; i < parsed.segments.length; i += CHUNK) {
    const rows = parsed.segments.slice(i, i + CHUNK).map(s => ({
      artifact_id: artifact.id, seq: s.seq, start_ms: s.startMs, end_ms: s.endMs, speaker: s.speaker, text: s.text,
    }))
    const { error: segErr } = await sb.from('transcript_segments').insert(rows)
    if (segErr) {
      // חומר חלקי גרוע מחומר חסר: הוא ייראה שלם ויוביל לסיכום על חצי שיחה.
      await sb.from('meeting_artifacts').delete().eq('id', artifact.id)
      return json({ error: 'DB (מקטעים): ' + segErr.message }, 500)
    }
  }

  return json({
    ok: true,
    artifact,
    format: parsed.format,
    speakers: parsed.speakers,
    hasTimestamps: parsed.hasTimestamps,
    segments: parsed.segments.length,
  }, 201)
}
