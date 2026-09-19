/**
 * /api/meetings/[id]/summary — טיוטת הסיכום, ואישור ושליחה.
 *
 * PUT  → שומר/מעדכן טיוטה: נקודות, החלטות, שאלות פתוחות ומשימות מוצעות.
 * POST → אישור הגרסה, הפיכת המשימות המוצעות למשימות חיות, ושליחה לנמענים.
 *
 * ═══ שלוש הפרדות שה-UX-SPEC דורש, ושקל מאוד לטשטש ═══
 *
 * 1. משימה מוצעת אינה משימה לביצוע. עד האישור הסטטוס הוא proposed, והיא לא נספרת
 *    ב"משימות פתוחות" ולא נשלחת לאיש.
 * 2. אישור ושליחה הן שתי פעולות מתועדות. כשל בשליחה אינו מבטל את האישור, ו-retry
 *    שולח שוב בלי לאשר מחדש ובלי ליצור משימות מחדש.
 * 3. משימה בלי אחראי או בלי תאריך אינה חוסמת אישור, אבל היא נשארת needs_details
 *    ואינה נשלחת לאדם מומצא.
 */
import { requireMeeting, actorOf, nextSummaryVersion, loadMeetingDetail } from '../../../../../lib/meetings/store'
import { shareSummary } from '../../../../../lib/meetings/share-email'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const json = (b, s = 200) => Response.json(b, { status: s })
const trim = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** רשימת מחרוזות עם מקורות: [{ text, sourceSegmentIds? }] */
function normalizeItems(arr, max = 100) {
  if (!Array.isArray(arr)) return []
  return arr.slice(0, max).map(x => {
    const text = trim(typeof x === 'string' ? x : x?.text, 2000)
    if (!text) return null
    const ids = Array.isArray(x?.sourceSegmentIds)
      ? x.sourceSegmentIds.filter(n => Number.isInteger(n)).slice(0, 50) : []
    return { text, sourceSegmentIds: ids }
  }).filter(Boolean)
}

function normalizeTasks(arr) {
  if (!Array.isArray(arr)) return []
  return arr.slice(0, 100).map(t => {
    const title = trim(t?.title, 500)
    if (!title) return null
    const due = trim(t?.dueAt, 10)
    const review = trim(t?.reviewAt, 10)
    const ymd = /^\d{4}-\d{2}-\d{2}$/
    const email = trim(t?.assigneeEmail, 200)
    return {
      title,
      description: trim(t?.description, 4000),
      assignee_email: email && EMAIL_RE.test(email) ? email : null,
      assignee_label: trim(t?.assigneeLabel, 200),
      due_at: due && ymd.test(due) ? due : null,
      review_at: review && ymd.test(review) ? review : null,
      source_segment_ids: Array.isArray(t?.sourceSegmentIds)
        ? t.sourceSegmentIds.filter(n => Number.isInteger(n)).slice(0, 50) : null,
      human_added: t?.humanAdded !== false,
    }
  }).filter(Boolean)
}

export async function PUT(request, { params }) {
  const gate = await requireMeeting(request, params?.id)
  if (!gate.ok) return gate.res
  const { sb, meeting } = gate

  let body
  try { body = await request.json() } catch { return json({ error: 'גוף הבקשה אינו JSON' }, 400) }

  const { data: existing } = await sb.from('meeting_summaries')
    .select('id, version, status').eq('meeting_id', meeting.id)
    .order('version', { ascending: false }).limit(1)
  const head = existing && existing[0]

  const payload = {
    key_points: normalizeItems(body.keyPoints),
    decisions: normalizeItems(body.decisions),
    open_questions: normalizeItems(body.openQuestions),
    source_artifact_id: trim(body.sourceArtifactId, 40) || null,
    generator: body.generator === 'ai' ? 'ai' : 'human',
  }

  let summary
  if (head && head.status === 'draft') {
    const { data, error } = await sb.from('meeting_summaries').update(payload).eq('id', head.id).select('*').single()
    if (error) return json({ error: 'DB: ' + error.message }, 500)
    summary = data
  } else {
    // אין טיוטה, או שהאחרונה מאושרת — גרסה חדשה. אישור לא נדרס לעולם.
    const version = await nextSummaryVersion(sb, meeting.id)
    const { data, error } = await sb.from('meeting_summaries')
      .insert({ meeting_id: meeting.id, version, status: 'draft', ...payload }).select('*').single()
    if (error) return json({ error: 'DB: ' + error.message }, 500)
    summary = data
  }

  // המשימות המוצעות של הגרסה נכתבות מחדש. משימות שכבר אושרו (כל מה שאינו proposed)
  // לא נגעות — הן ישויות חיות עם היסטוריה.
  if (Array.isArray(body.tasks)) {
    await sb.from('meeting_tasks').delete().eq('meeting_id', meeting.id).eq('status', 'proposed')
    const rows = normalizeTasks(body.tasks).map(t => ({
      ...t, meeting_id: meeting.id, project_id: meeting.project_id,
      summary_version: summary.version, status: 'proposed',
    }))
    if (rows.length) {
      const { error } = await sb.from('meeting_tasks').insert(rows)
      if (error) return json({ error: 'DB (משימות): ' + error.message }, 500)
    }
  }

  const detail = await loadMeetingDetail(sb, meeting)
  return json({ ok: true, ...detail })
}

export async function POST(request, { params }) {
  const gate = await requireMeeting(request, params?.id)
  if (!gate.ok) return gate.res
  const { sb, meeting } = gate

  let body
  try { body = await request.json() } catch { return json({ error: 'גוף הבקשה אינו JSON' }, 400) }

  const version = Number(body.version)
  if (!Number.isInteger(version) || version < 1) return json({ error: 'חסרה גרסת סיכום לאישור' }, 400)

  const { data: summary, error: sErr } = await sb.from('meeting_summaries')
    .select('*').eq('meeting_id', meeting.id).eq('version', version).maybeSingle()
  if (sErr) return json({ error: 'DB: ' + sErr.message }, 500)
  if (!summary) return json({ error: 'גרסת הסיכום לא נמצאה' }, 404)

  const actor = actorOf(gate)

  // ── אישור: פעם אחת. לחיצה כפולה או retry לא מאשרים מחדש ולא מייצרים משימות שוב. ──
  if (summary.status !== 'approved') {
    const { error } = await sb.from('meeting_summaries')
      .update({ status: 'approved', approved_by: actor, approved_at: new Date().toISOString() })
      .eq('id', summary.id).eq('status', 'draft')
    if (error) return json({ error: 'DB: ' + error.message }, 500)

    // משימות מוצעות הופכות לחיות. חסר אחראי או תאריך יעד → needs_details, לא open:
    // משימה כזאת נשארת אצל המנהל להשלמה ואינה נשלחת לאף אחד.
    const { data: proposed } = await sb.from('meeting_tasks')
      .select('id, assignee_email, due_at').eq('meeting_id', meeting.id).eq('status', 'proposed')
    for (const t of (proposed || [])) {
      const complete = !!t.assignee_email && !!t.due_at
      await sb.from('meeting_tasks').update({ status: complete ? 'open' : 'needs_details' }).eq('id', t.id)
    }
    if (meeting.status === 'draft' || meeting.status === 'scheduled') {
      await sb.from('marketing_meetings').update({ status: 'ended' }).eq('id', meeting.id)
    }
  }

  // ── שליחה: פעולה נפרדת. כשל כאן אינו נוגע באישור. ──
  const recipients = [...new Set((Array.isArray(body.recipients) ? body.recipients : [])
    .map(r => trim(r, 200)).filter(r => r && EMAIL_RE.test(r)))].slice(0, 50)

  let shared = { attempted: 0, sent: 0, failed: 0, skipped: 'no recipients' }
  if (recipients.length) {
    shared = await shareSummary({ sb, meeting, summary, recipients, actor })
  }

  const detail = await loadMeetingDetail(sb, meeting)
  return json({ ok: true, approved: true, share: shared, ...detail })
}
