/**
 * /api/meeting-tasks/[id] — עדכון משימה שיצאה מישיבה.
 *
 * ⚠️ הבקשה נושאת מזהה משימה בלבד, ולכן קודם שולפים ממנה את project_id ורק אז בודקים
 * הרשאה. בלי הסדר הזה אפשר היה לעדכן משימה של לקוח אחר בניחוש מזהה. זו התבנית של
 * app/api/tasks/update/route.js.
 *
 * ═══ שני צירים נפרדים ═══
 * status הוא מצב ביצוע. review_at הוא מועד בדיקה. "נבדוק בחודש הבא" אינו אומר שהפעולה
 * בוצעה, ולכן אסור שעדכון של אחד ישנה את השני.
 * completed_at נרשם כשמסמנים done. implemented_at הוא היום שבו השינוי העסקי הוחל בפועל,
 * והוא יכול להיות שונה — שדה נפרד, לא נגזרת.
 */
import { meetingsClient, requireSignedIn } from '../../../../lib/meetings/store'
import { requireProjectPlan } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const json = (b, s = 200) => Response.json(b, { status: s })
const trim = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null)
const YMD = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const STATUSES = ['proposed', 'open', 'in_progress', 'done', 'blocked', 'cancelled', 'needs_details']

export async function PATCH(request, { params }) {
  const id = params?.id
  if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return json({ error: 'מזהה משימה לא תקין' }, 400)

  // שער זהות לפני כל נגיעה ב-DB: בלעדיו פנייה אנונימית הבדילה בתשובה בין מזהה משימה
  // שקיים לבין אחד שלא, וקיבלה גם תקלת תצורה מפורטת.
  const signed = await requireSignedIn(request)
  if (!signed.ok) return signed.res

  let sb
  try { sb = meetingsClient() } catch (e) { console.error('[meetings] config:', e?.message || e); return json({ error: 'שירות הישיבות אינו זמין' }, 500) }

  const { data: task, error: findErr } = await sb.from('meeting_tasks')
    .select('id, project_id, meeting_id, status, completed_at').eq('id', id).maybeSingle()
  if (findErr) return json({ error: 'DB: ' + findErr.message }, 500)
  if (!task) return json({ error: 'משימה לא נמצאה' }, 404)

  // גישה לפרויקט **וגם** מנוי PRO — ישיבות שיווק נמכר בנפרד (מיגרציה 020). אותו
  // שער בדיוק כמו ב-lib/meetings/store.js, כי משימה היא נגזרת של ישיבה.
  const gate = await requireProjectPlan(request, task.project_id, 'pro')
  if (!gate.ok) return gate.res

  let body
  try { body = await request.json() } catch { return json({ error: 'גוף הבקשה אינו JSON' }, 400) }

  const patch = {}
  if (body.title !== undefined) {
    const t = trim(body.title, 500)
    if (!t) return json({ error: 'כותרת לא יכולה להיות ריקה' }, 400)
    patch.title = t
  }
  if (body.description !== undefined) patch.description = trim(body.description, 4000)
  if (body.assigneeLabel !== undefined) patch.assignee_label = trim(body.assigneeLabel, 200)
  if (body.assigneeEmail !== undefined) {
    const e = trim(body.assigneeEmail, 200)
    if (e && !EMAIL_RE.test(e)) return json({ error: 'כתובת אימייל לא תקינה' }, 400)
    patch.assignee_email = e || null
  }
  for (const [key, col] of [['dueAt', 'due_at'], ['reviewAt', 'review_at'], ['implementedAt', 'implemented_at']]) {
    if (body[key] === undefined) continue
    if (body[key] === null) { patch[col] = null; continue }
    const v = trim(body[key], 10)
    if (!v || !YMD.test(v)) return json({ error: `תאריך לא תקין: ${key}` }, 400)
    patch[col] = v
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return json({ error: 'סטטוס לא מוכר' }, 400)
    // proposed הוא מצב שנוצר רק מטיוטת סיכום. אי אפשר להחזיר אליו משימה חיה, אחרת
    // היא תיעלם מהמשימות הפתוחות בלי שאיש ביטל אותה.
    if (body.status === 'proposed' && task.status !== 'proposed') {
      return json({ error: 'אי אפשר להחזיר משימה חיה למצב "מוצעת"' }, 400)
    }
    patch.status = body.status
    // סימון ביצוע רושם את רגע הביצוע; ביטול סימון מנקה אותו. שיפור במדד אינו מסמן done,
    // ואזכור "נטפל" בשיחה אינו ביצוע — רק עדכון מפורש כאן.
    if (body.status === 'done' && task.status !== 'done') patch.completed_at = new Date().toISOString()
    if (body.status !== 'done' && task.status === 'done') patch.completed_at = null
  }

  if (Object.keys(patch).length === 0) return json({ error: 'אין מה לעדכן' }, 400)

  const { data, error } = await sb.from('meeting_tasks').update(patch).eq('id', id).select('*').single()
  if (error) return json({ error: 'DB: ' + error.message }, 500)
  return json({ ok: true, task: data })
}
