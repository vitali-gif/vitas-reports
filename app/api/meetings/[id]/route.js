/**
 * /api/meetings/[id] — ישיבה אחת: קריאה ועדכון.
 *
 * GET   → הישיבה, מוזמנים, חומרים, גרסאות סיכום, משימות ושיתופים. התמלול עצמו לא נטען
 *         כאן (הוא הדבר הכבד) — ראו /api/meetings/[id]/transcript.
 * PATCH → עדכון שדות הישיבה. בשלב 1 אין יומן, ולכן עדכון אינו מודיע לאיש.
 *
 * הרשאה: requireMeeting — קודם שולפים את הפרויקט של הישיבה, ורק אז בודקים הרשאה עליו.
 */
import { requireMeeting, loadMeetingDetail } from '../../../../lib/meetings/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const json = (b, s = 200) => Response.json(b, { status: s })
const trim = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null)

export async function GET(request, { params }) {
  const gate = await requireMeeting(request, params?.id)
  if (!gate.ok) return gate.res
  const detail = await loadMeetingDetail(gate.sb, gate.meeting)
  return json({ ok: true, ...detail })
}

export async function PATCH(request, { params }) {
  const gate = await requireMeeting(request, params?.id)
  if (!gate.ok) return gate.res
  const { sb, meeting } = gate

  let body
  try { body = await request.json() } catch { return json({ error: 'גוף הבקשה אינו JSON' }, 400) }

  const patch = {}
  if (body.title !== undefined) {
    const t = trim(body.title, 300)
    if (!t) return json({ error: 'כותרת לא יכולה להיות ריקה' }, 400)
    patch.title = t
  }
  if (body.agenda !== undefined) patch.agenda = trim(body.agenda, 8000)
  if (body.joinUrl !== undefined) patch.join_url = trim(body.joinUrl, 1000)
  if (body.timezone !== undefined) patch.timezone = trim(body.timezone, 60) || 'Asia/Jerusalem'
  if (body.startAt !== undefined) {
    if (body.startAt === null) patch.start_at = null
    else { const d = new Date(body.startAt); if (isNaN(d)) return json({ error: 'תאריך התחלה לא תקין' }, 400); patch.start_at = d.toISOString() }
  }
  if (body.endAt !== undefined) {
    if (body.endAt === null) patch.end_at = null
    else { const d = new Date(body.endAt); if (isNaN(d)) return json({ error: 'תאריך סיום לא תקין' }, 400); patch.end_at = d.toISOString() }
  }
  if (body.status !== undefined) {
    const allowed = ['draft', 'scheduled', 'ended', 'cancelled']
    if (!allowed.includes(body.status)) return json({ error: 'סטטוס לא מוכר' }, 400)
    patch.status = body.status
  }

  // start<end נבדק על המצב שאחרי המיזוג, לא רק על מה שנשלח — אחרת אפשר לשבור את הסדר
  // בעדכון של שדה אחד בלבד. יש גם constraint ב-DB; כאן זה בשביל הודעה בעברית.
  const nextStart = patch.start_at !== undefined ? patch.start_at : meeting.start_at
  const nextEnd = patch.end_at !== undefined ? patch.end_at : meeting.end_at
  if (nextStart && nextEnd && new Date(nextStart) >= new Date(nextEnd)) {
    return json({ error: 'שעת הסיום חייבת להיות אחרי שעת ההתחלה' }, 400)
  }

  if (Object.keys(patch).length === 0) return json({ error: 'אין מה לעדכן' }, 400)

  const { data, error } = await sb.from('marketing_meetings').update(patch).eq('id', meeting.id).select('*').single()
  if (error) return json({ error: 'DB: ' + error.message }, 500)

  // מוזמנים מוחלפים כמקשה אחת כשנשלחה רשימה — פשוט יותר מלנהל הפרשים, ובשלב 1 אין
  // הזמנות שנשלחו ולכן אין מה לשמר.
  if (Array.isArray(body.invitees)) {
    const rows = body.invitees.slice(0, 50).map(i => ({
      meeting_id: meeting.id,
      email: trim(i?.email, 200),
      display_name: trim(i?.displayName, 200),
      role_label: trim(i?.roleLabel, 200),
    })).filter(r => r.email || r.display_name || r.role_label)
    await sb.from('meeting_invitees').delete().eq('meeting_id', meeting.id)
    if (rows.length) {
      const { error: invErr } = await sb.from('meeting_invitees').insert(rows)
      if (invErr) return json({ error: 'DB (מוזמנים): ' + invErr.message }, 500)
    }
  }

  const detail = await loadMeetingDetail(sb, data)
  return json({ ok: true, ...detail })
}
