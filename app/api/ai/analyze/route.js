/**
 * /api/ai/analyze — ניתוח AI לפרויקט (אדמין בלבד). lib/ai-analysis.js
 *
 * GET  ?projectId=…               — הניתוחים האחרונים של הפרויקט (12), מהחדש לישן.
 * POST { projectId, key, prevKey, model, force } — ניתוח לתקופה שעל המסך.
 *   model: מודל הדוח שהדפדפן כבר בונה לדוח ה-PDF (buildReportModel). השרת לא סומך עליו כמו שהוא:
 *   analysisInput מעתיק ממנו רק שדות מוכרים, מספרים כמספרים וטקסט מקוצר.
 *   force=false ויש ניתוח לאותה תקופה מהשעה האחרונה — מוחזר הקיים, בלי קריאה נוספת ל-Claude
 *   (לחיצה כפולה לא עולה כסף פעמיים). "נתח מחדש" שולח force=true.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../../../../lib/auth'
import { analysisInput, runAnalysis, checkKey } from '../../../../lib/ai-analysis.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300   // ניתוח עם חשיבה יכול לקחת דקה ויותר

const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })
const KEY_RE = /^\d{4}-\d{2}(-\d{2}_\d{4}-\d{2}-\d{2})?$/
const COLS = 'id, project_id, period_key, compare_key, trigger, model, result, usage, created_by, created_at'

export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  // ?status=1 — בדיקת המפתח (קיים? Claude מקבל אותו? באיזו פריסה?), בלי הערך עצמו.
  if (sp.get('status') === '1') return J({ key: await checkKey() })
  const projectId = sp.get('projectId')
  if (!projectId) return J({ error: 'projectId required' }, 400)
  const { data, error } = await adminClient().from('ai_analyses').select(COLS)
    .eq('project_id', projectId).order('created_at', { ascending: false }).limit(12)
  if (error) return J({ error: error.message, code: error.code === '42P01' ? 'NO_TABLE' : undefined }, 500)
  return J({ analyses: data || [] })
}

export async function POST(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => null)
  const { projectId, key, prevKey, model, force } = body || {}
  if (!projectId || !KEY_RE.test(key || '')) return J({ error: 'projectId and key required' }, 400)
  if (prevKey && !KEY_RE.test(prevKey)) return J({ error: 'bad prevKey' }, 400)

  const sb = adminClient()
  const { data: project } = await sb.from('projects').select('id').eq('id', projectId).maybeSingle()
  if (!project) return J({ error: 'project not found' }, 404)

  if (!force) {
    const since = new Date(Date.now() - 3600e3).toISOString()
    const { data: recent } = await sb.from('ai_analyses').select(COLS)
      .eq('project_id', projectId).eq('period_key', key).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1)
    if (recent && recent[0]) return J({ analysis: recent[0], cached: true })
  }

  const input = analysisInput(model)
  if (!input || (!input.metrics.length && !input.funnel.length)) return J({ error: 'אין נתונים לתקופה הזו' }, 400)

  let out
  try {
    out = await runAnalysis(input)
  } catch (e) {
    const status = e.code === 'NO_KEY' ? 503 : 502
    return J({ error: e.message || 'הניתוח נכשל', code: e.code || 'API_ERROR', diag: e.diag }, status)
  }

  const row = {
    project_id: projectId, period_key: key, compare_key: prevKey || null, trigger: 'manual',
    model: out.model, input, result: out.result, usage: out.usage, created_by: gate.user?.email || null,
  }
  const { data: saved, error } = await sb.from('ai_analyses').insert(row).select(COLS).single()
  // שמירה שנכשלה (למשל הטבלה עוד לא נוצרה) לא מבזבזת את הניתוח: הוא מוחזר בכל זאת.
  if (error) return J({ analysis: { ...row, input: undefined, created_at: new Date().toISOString() }, saved: false, saveError: error.message })
  return J({ analysis: saved, saved: true })
}
