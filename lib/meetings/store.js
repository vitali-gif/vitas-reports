/**
 * lib/meetings/store.js — גישה ל-DB ואכיפת הרשאה לפיצ'ר הישיבות.
 *
 * כל הטבלאות של הישיבות הן service_role בלבד (RLS דלוק בלי policies, מיגרציה 017), ולכן
 * ה-RLS אינו האכיפה — ה-route הוא האכיפה. כאן יושבת התבנית שכל route חייב לעבור דרכה.
 *
 * ⚠️ הסדר חשוב. בקשה שמגיעה עם meetingId בלבד אינה נושאת projectId, ואם נסמוך על projectId
 * מהדפדפן אפשר יהיה לערוך ישיבה של לקוח אחר על ידי ניחוש מזהה. לכן: קודם שולפים את
 * project_id של הישיבה מה-DB, ורק אז בודקים הרשאה עליו. זו בדיוק התבנית של
 * app/api/tasks/update/route.js, וההערה שם מסבירה למה היא קיימת.
 */
import { createClient } from '@supabase/supabase-js'
import { requireProjectAccess, requireUser, isInternalCall } from '../auth'

/** לקוח service_role. בלי נפילה חזרה למפתח הציבורי: מפתח חסר = 500 מפורש. */
export function meetingsClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

const json = (body, status = 200) => Response.json(body, { status })
/** תקלת תצורה לא מדליפה שמות של משתני סביבה החוצה; הפירוט נשאר בלוג. */
const configError = (e) => { console.error('[meetings] config:', e?.message || e); return json({ error: 'שירות הישיבות אינו זמין' }, 500) }

/**
 * שער זול שרץ ראשון: יש בכלל זהות מאומתת?
 *
 * ⚠️ בלי זה, פנייה אנונימית עם מזהה ישיבה/משימה הייתה מגיעה עד שאילתת ה-DB ומבדילה
 * בתשובה בין מזהה שקיים (401 מהשלב הבא) למזהה שלא קיים (404) — אורקל קיום. אימות JWT
 * הוא מקומי ולא נוגע ב-DB, ולכן זה גם זול. קרון פנימי עובר עם CRON_SECRET.
 */
async function requireSignedIn(req) {
  if (isInternalCall(req)) return { ok: true, user: null }
  const gate = await requireUser(req)
  return gate.ok ? { ok: true, user: gate.user } : { ok: false, res: gate.res }
}

/**
 * שומר לישיבה קיימת: שולף את הפרויקט שלה ואז בודק הרשאה.
 * @returns {Promise<{ok:true, sb, meeting, user}|{ok:false, res:Response}>}
 */
export async function requireMeeting(req, meetingId) {
  if (!meetingId || !/^[0-9a-f-]{36}$/i.test(String(meetingId))) {
    return { ok: false, res: json({ error: 'meetingId לא תקין' }, 400) }
  }
  const signed = await requireSignedIn(req)
  if (!signed.ok) return { ok: false, res: signed.res }
  let sb
  try { sb = meetingsClient() } catch (e) { return { ok: false, res: configError(e) } }

  const { data, error } = await sb
    .from('marketing_meetings')
    .select('id, project_id, title, start_at, end_at, timezone, organizer_email, status, agenda, join_url, created_at, updated_at')
    .eq('id', meetingId)
    .maybeSingle()
  if (error) return { ok: false, res: json({ error: 'DB: ' + error.message }, 500) }
  // 404 ולא 403: אי אפשר לברר קיום של ישיבה בפרויקט אחר על ידי ניחוש מזהים.
  if (!data) return { ok: false, res: json({ error: 'ישיבה לא נמצאה' }, 404) }

  const gate = await requireProjectAccess(req, data.project_id)
  if (!gate.ok) return { ok: false, res: gate.res }

  return { ok: true, sb, meeting: data, user: gate.user }
}

/** שומר לפעולה שמגיעה עם projectId מפורש (רשימה, יצירה). */
export async function requireProject(req, projectId) {
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(String(projectId))) {
    return { ok: false, res: json({ error: 'projectId לא תקין' }, 400) }
  }
  const gate = await requireProjectAccess(req, projectId)
  if (!gate.ok) return { ok: false, res: gate.res }
  let sb
  try { sb = meetingsClient() } catch (e) { return { ok: false, res: configError(e) } }
  return { ok: true, sb, user: gate.user }
}

export { requireSignedIn }

/** מי ביצע את הפעולה, לשדות created_by / approved_by. קרון פנימי אינו אדם. */
export const actorOf = (gate) => gate.user?.email || 'internal'

/**
 * הישיבה על כל מה שתלוי בה. התמלול עצמו לא נטען כאן — הוא הדבר הכבד, ונטען רק
 * כשבאמת פותחים אותו.
 */
export async function loadMeetingDetail(sb, meeting) {
  const [inv, art, sum, tasks, shares] = await Promise.all([
    sb.from('meeting_invitees').select('id, email, display_name, role_label').eq('meeting_id', meeting.id).order('created_at'),
    sb.from('meeting_artifacts').select('id, kind, source, filename, external_url, language, segment_count, status, created_at').eq('meeting_id', meeting.id).order('created_at'),
    sb.from('meeting_summaries').select('id, version, status, source_artifact_id, key_points, decisions, open_questions, generator, approved_by, approved_at, updated_at').eq('meeting_id', meeting.id).order('version', { ascending: false }),
    sb.from('meeting_tasks').select('*').eq('meeting_id', meeting.id).order('created_at'),
    sb.from('meeting_shares').select('summary_version, recipient_email, delivery_status, sent_at, error').eq('meeting_id', meeting.id).order('created_at', { ascending: false }),
  ])
  const summaries = sum.data || []
  return {
    meeting,
    invitees: inv.data || [],
    artifacts: art.data || [],
    summaries,
    // הגרסה שעובדים עליה: המאושרת האחרונה אם אין טיוטה חדשה ממנה, אחרת הטיוטה.
    currentSummary: summaries[0] || null,
    tasks: tasks.data || [],
    shares: shares.data || [],
  }
}

/** הגרסה הבאה של הסיכום. אין דריסה של גרסה מאושרת — תמיד גרסה חדשה. */
export async function nextSummaryVersion(sb, meetingId) {
  const { data } = await sb.from('meeting_summaries').select('version').eq('meeting_id', meetingId).order('version', { ascending: false }).limit(1)
  return ((data && data[0] && data[0].version) || 0) + 1
}
