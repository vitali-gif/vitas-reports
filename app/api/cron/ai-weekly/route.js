/**
 * /api/cron/ai-weekly — ניתוח AI שבועי לכל הפרויקטים (ויטלי, 27.10: "גם וגם" — בלחיצה וגם אוטומטי).
 *
 * פעם בשבוע (vercel.json, ראשון בבוקר): לכל פרויקט שאינו דמו — 7 הימים האחרונים (עד אתמול) מול
 * 7 הימים שלפניהם. הנתונים מ-/api/reports/range (אותן שורות שהדשבורד מקבל לטווח), המודל מ-
 * buildReportModel (כמו דוח ה-PDF), הניתוח מ-lib/ai-analysis.js. כל ניתוח נשמר ב-ai_analyses
 * (trigger='weekly'), ובסוף נשלח מייל אחד לויטלי עם כל הפרויקטים (lib/alert.js).
 *
 * הרשאה: קרון (CRON_SECRET — Vercel שולח אותו כ-Bearer) או אדמין. ?projectId=… מריץ פרויקט אחד
 * (לבדיקה), ?dry=1 מחזיר את הקלט בלי לקרוא ל-Claude ובלי לשמור.
 * פרויקט שכבר נותח לאותו שבוע — מדולג (קרון שרץ פעמיים לא משלם פעמיים).
 */
import { NextResponse } from 'next/server'
import { adminClient, requireAdmin, internalHeaders } from '../../../../lib/auth'
import { analysisInput, runAnalysis, weeklyEmailHtml, weekKeys } from '../../../../lib/ai-analysis.js'
import { buildReportModel } from '../../../../lib/report-pdf.js'
import { sendAlert } from '../../../../lib/alert.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })
async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

export async function GET(req) {
  const gate = await requireAdmin(req)   // קרון (CRON_SECRET) עובר כאן כ-internal
  if (!gate.ok) return gate.res
  const url = new URL(req.url)
  const only = url.searchParams.get('projectId')
  const dry = url.searchParams.get('dry') === '1'
  const origin = process.env.APP_ORIGIN || url.origin
  const { key, prevKey } = weekKeys()

  const sb = adminClient()
  let q = sb.from('projects').select('id, name, is_demo, clients(name)')
  if (only) q = q.eq('id', only)
  const { data: projects, error } = await q
  if (error) return J({ error: error.message }, 500)
  const list = (projects || []).filter(p => !p.is_demo)

  const { data: done } = dry ? { data: [] } : await sb.from('ai_analyses').select('project_id')
    .eq('trigger', 'weekly').eq('period_key', key)
  const doneIds = new Set((done || []).map(r => r.project_id))

  const rowsFor = async (projectId, k) => {
    const [since, until] = k.split('_')
    const res = await fetch(`${origin}/api/reports/range?projectId=${projectId}&since=${since}&until=${until}`, { headers: internalHeaders(), cache: 'no-store' })
    if (!res.ok) throw new Error(`range ${res.status}`)
    const body = await res.json()
    return Array.isArray(body?.rows) ? body.rows : []
  }

  const results = await pool(list, 3, async (p) => {
    const base = { projectId: p.id, project: p.name, client: p.clients?.name || '' }
    if (doneIds.has(p.id)) return { ...base, skipped: 'already analysed' }
    try {
      const [rows, prevRows] = await Promise.all([rowsFor(p.id, key), rowsFor(p.id, prevKey)])
      const model = buildReportModel({ project: p.name, client: base.client, key, prevKey, rows, prevRows })
      const input = analysisInput(model)
      if (!input.metrics.length && !input.funnel.length) return { ...base, skipped: 'no data' }
      if (dry) return { ...base, input }
      const out = await runAnalysis(input)
      await sb.from('ai_analyses').insert({
        project_id: p.id, period_key: key, compare_key: prevKey, trigger: 'weekly',
        model: out.model, input, result: out.result, usage: out.usage, created_by: 'cron',
      })
      return { ...base, period: model.label, comparedTo: model.prevLabel, result: out.result, costUsd: out.usage.costUsd }
    } catch (e) {
      return { ...base, error: e.message || String(e), code: e.code }
    }
  })

  // בלי מפתח — אין טעם לשלוח מייל עם 9 שגיאות זהות; התשובה עצמה אומרת מה חסר.
  if (results.some(r => r.code === 'NO_KEY')) return J({ key, prevKey, error: 'ANTHROPIC_API_KEY לא מוגדר', results })

  const mail = results.filter(r => r.result || r.error)
  let email = null
  if (!dry && mail.length) {
    email = await sendAlert({
      subject: `Cluzo - ניתוח שבועי (${mail.filter(r => r.result).length} פרויקטים)`,
      html: weeklyEmailHtml(mail, { dashboardUrl: `${origin}/admin` }),
    })
  }
  const cost = results.reduce((a, r) => a + (r.costUsd || 0), 0)
  return J({ key, prevKey, analysed: results.filter(r => r.result).length, costUsd: Math.round(cost * 1000) / 1000, emailed: email?.ok ?? false, results: results.map(({ result, input, ...r }) => (dry ? { ...r, input } : { ...r, headline: result?.headline })) })
}
