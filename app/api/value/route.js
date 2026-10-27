/**
 * GET /api/value?projectId=… — הנתונים שמחוץ לדוחות לטאב "ערך הדשבורד" (D8). אדמין בלבד.
 *
 *   project      — תאריך ההקמה בדשבורד (projects.created_at).
 *   usage        — מתי הלקוח נכנס לראשונה, כמה כניסות ב-30 הימים האחרונים. בלי משתמש ה-QA ובלי
 *                  אדמינים (2,100 מתוך 2,600 הכניסות בטבלה הן של הבדיקות האוטומטיות). רק מספרים
 *                  ותאריכים — בלי מיילים.
 *   tasks / meetingTasks — פעולות שבוצעו: משימות שנסגרו (vitas_tasks: done) ומשימות מישיבות שבוצעו
 *                  (meeting_tasks: done).
 *   analyses     — ניתוחי ה-AI של הפרויקט (D20), אם מיגרציה 024 רצה. בלעדיה — רשימה ריקה.
 * המדדים עצמם (עלויות, כמויות, המרות) מחושבים בדפדפן מהדוחות שכבר טעונים (lib/dashboard-value.js).
 */
import { NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../../../lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })

export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) return J({ error: 'projectId required' }, 400)
  const sb = adminClient()

  const { data: project } = await sb.from('projects').select('id, name, created_at').eq('id', projectId).maybeSingle()
  if (!project) return J({ error: 'project not found' }, 404)

  const [{ data: admins }, { data: sessions }, { data: tasks }, { data: meetingTasks }, analysesRes] = await Promise.all([
    sb.from('admins').select('email'),
    sb.from('client_sessions').select('email, logged_in_at').contains('project_ids', [projectId]).order('logged_in_at', { ascending: true }).limit(5000),
    sb.from('vitas_tasks').select('task_title, metric_type, closed_at, updated_at').eq('project_id', projectId).eq('status', 'done').order('closed_at', { ascending: false }).limit(50),
    sb.from('meeting_tasks').select('title, assignee_label, completed_at, implemented_at').eq('project_id', projectId).eq('status', 'done').order('completed_at', { ascending: false }).limit(50),
    sb.from('ai_analyses').select('period_key, trigger, result, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(20),
  ])

  const staff = new Set((admins || []).map(a => String(a.email || '').toLowerCase()))
  const clientSessions = (sessions || []).filter(s => {
    const e = String(s.email || '').toLowerCase()
    return e && !staff.has(e) && !e.startsWith('qa@')
  })
  const since30 = Date.now() - 30 * 864e5
  const usage = {
    firstLogin: clientSessions[0]?.logged_in_at || null,
    logins30d: clientSessions.filter(s => new Date(s.logged_in_at).getTime() >= since30).length,
    users: new Set(clientSessions.map(s => String(s.email).toLowerCase())).size,
  }

  return J({
    project: { id: project.id, name: project.name, createdAt: project.created_at },
    usage,
    tasks: tasks || [],
    meetingTasks: meetingTasks || [],
    analyses: analysesRes.error ? [] : (analysesRes.data || []),
  })
}
