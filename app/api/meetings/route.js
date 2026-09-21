/**
 * /api/meetings — רשימת הישיבות של פרויקט, ויצירת ישיבה חדשה כטיוטה.
 *
 * GET  ?projectId=…  → ישיבות, משימות פתוחות, ומשימות שהגיע מועד הבדיקה שלהן.
 * POST { projectId, title, … } → טיוטה. **בלי שום תופעת לוואי חיצונית**: לא נוצר אירוע
 *      ביומן, לא נשלחת הזמנה ולא נשלח מייל. זו דרישה מפורשת ב-UX-SPEC.md.
 *
 * הרשאה: requireProjectAccess דרך lib/meetings/store.js.
 */
import { requireProject, actorOf } from '../../../lib/meetings/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const json = (b, s = 200) => Response.json(b, { status: s })
const trim = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null)

export async function GET(request) {
  const projectId = new URL(request.url).searchParams.get('projectId')
  const gate = await requireProject(request, projectId)
  if (!gate.ok) return gate.res
  const { sb } = gate

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())

  const [meetingsRes, tasksRes] = await Promise.all([
    sb.from('marketing_meetings')
      // agenda נשלח כדי שכרטיס "הישיבה הקרובה" יציג את הנושאים המרכזיים (סקיצה 02).
      .select('id, title, start_at, end_at, timezone, status, organizer_email, join_url, agenda, created_at')
      .eq('project_id', projectId)
      .order('start_at', { ascending: false, nullsFirst: false })
      .limit(100),
    // משימות פתוחות בלבד. "proposed" אינה משימה חיה — היא הצעה שממתינה לאישור הסיכום,
    // ולכן אינה נספרת כאן ואינה מוצגת כמשהו לביצוע (UX-SPEC, מסך 02).
    sb.from('meeting_tasks')
      .select('id, meeting_id, title, assignee_email, assignee_label, due_at, review_at, status')
      .eq('project_id', projectId)
      .not('status', 'in', '("done","cancelled","proposed")')
      .order('review_at', { ascending: true, nullsFirst: false })
      .limit(200),
  ])
  if (meetingsRes.error) return json({ error: 'DB: ' + meetingsRes.error.message }, 500)
  if (tasksRes.error) return json({ error: 'DB: ' + tasksRes.error.message }, 500)

  const meetings = meetingsRes.data || []
  const openTasks = tasksRes.data || []
  // סיכום פתוח לכל ישיבה, כדי שהרשימה תוכל להציג "טיוטה לאישור" מול "אושר".
  const ids = meetings.map(m => m.id)
  let summaryByMeeting = {}
  if (ids.length) {
    const { data: sums } = await sb.from('meeting_summaries')
      .select('meeting_id, version, status').in('meeting_id', ids).order('version', { ascending: false })
    for (const s of (sums || [])) if (!summaryByMeeting[s.meeting_id]) summaryByMeeting[s.meeting_id] = s
  }
  // ספירת מוזמנים לכרטיס הישיבה הקרובה. "מוזמנים" ולא "משתתפים": אין לנו נוכחות אמיתית,
  // וה-UX-SPEC אוסר להציג invited כאילו היה attended.
  const inviteeByMeeting = {}
  if (ids.length) {
    const { data: invs } = await sb.from('meeting_invitees').select('meeting_id').in('meeting_id', ids)
    for (const i of (invs || [])) inviteeByMeeting[i.meeting_id] = (inviteeByMeeting[i.meeting_id] || 0) + 1
  }
  const openByMeeting = {}
  for (const t of openTasks) openByMeeting[t.meeting_id] = (openByMeeting[t.meeting_id] || 0) + 1

  return json({
    ok: true,
    meetings: meetings.map(m => ({
      ...m,
      summaryStatus: summaryByMeeting[m.id]?.status || null,
      summaryVersion: summaryByMeeting[m.id]?.version || null,
      openTasks: openByMeeting[m.id] || 0,
      inviteeCount: inviteeByMeeting[m.id] || 0,
    })),
    openTasks,
    // "הגיע מועד הבדיקה" — לא תזכורת שנשלחה, אלא מה שצריך לעלות בישיבה הבאה.
    dueForReview: openTasks.filter(t => t.review_at && t.review_at <= today),
  })
}

export async function POST(request) {
  let body
  try { body = await request.json() } catch { return json({ error: 'גוף הבקשה אינו JSON' }, 400) }

  const gate = await requireProject(request, body?.projectId)
  if (!gate.ok) return gate.res
  const { sb } = gate

  const title = trim(body.title, 300)
  if (!title) return json({ error: 'חסרה כותרת לישיבה' }, 400)

  const startAt = body.startAt ? new Date(body.startAt) : null
  const endAt = body.endAt ? new Date(body.endAt) : null
  if (startAt && isNaN(startAt)) return json({ error: 'תאריך התחלה לא תקין' }, 400)
  if (endAt && isNaN(endAt)) return json({ error: 'תאריך סיום לא תקין' }, 400)
  if (startAt && endAt && startAt >= endAt) return json({ error: 'שעת הסיום חייבת להיות אחרי שעת ההתחלה' }, 400)

  const organizer = trim(body.organizerEmail, 200) || actorOf(gate)

  const { data: meeting, error } = await sb.from('marketing_meetings').insert({
    project_id: body.projectId,
    title,
    start_at: startAt ? startAt.toISOString() : null,
    end_at: endAt ? endAt.toISOString() : null,
    timezone: trim(body.timezone, 60) || 'Asia/Jerusalem',
    organizer_email: organizer,
    status: 'draft',
    agenda: trim(body.agenda, 8000),
    join_url: trim(body.joinUrl, 1000),
    created_by: actorOf(gate),
  }).select('*').single()
  if (error) return json({ error: 'DB: ' + error.message }, 500)

  // מוזמנים. שם/תפקיד הוא תווית בלבד; בלי כתובת אמיתית אי אפשר לשלוח, וה-UI מסמן "להשלמה".
  const invitees = Array.isArray(body.invitees) ? body.invitees.slice(0, 50) : []
  if (invitees.length) {
    const rows = invitees.map(i => ({
      meeting_id: meeting.id,
      email: trim(i?.email, 200),
      display_name: trim(i?.displayName, 200),
      role_label: trim(i?.roleLabel, 200),
    })).filter(r => r.email || r.display_name || r.role_label)
    if (rows.length) {
      const { error: invErr } = await sb.from('meeting_invitees').insert(rows)
      if (invErr) return json({ error: 'DB (מוזמנים): ' + invErr.message, meeting }, 500)
    }
  }

  return json({ ok: true, meeting }, 201)
}
