/**
 * /api/cron/monthly-report — דוח PDF חודשי לכל פרויקט, עם סיכום מניתוח AI (lib/monthly-report.js).
 *
 * ב-5 לכל חודש (vercel.json): החודש הקודם מול החודש שלפניו. כל פרויקט רץ בקריאה נפרדת לעצמו
 * (?projectId=…) — Chromium וניתוח AI לפרויקט אחד לוקחים עד דקה-שתיים, וכל קריאה מקבלת את 300
 * השניות שלה. כל פרויקט נשלח במייל נפרד, עם ה-PDF מצורף. בשלב הזה — רק לויטלי (ALERT_EMAIL_TO).
 *
 * הרשאה: קרון (CRON_SECRET) או אדמין.
 *   ?projectId=…      פרויקט אחד (כך הקרון קורא לעצמו)
 *   ?key=2026-10      חודש אחר מהחודש הקודם
 *   ?format=pdf|html  מחזיר את הדוח עצמו לתצוגה, בלי מייל (תצוגה מקדימה לאדמין)
 *   ?force=1          שולח שוב גם אם כבר נשלח (הניתוח הקיים לאותו חודש נשאר)
 *   ?reanalyze=1      ניתוח AI חדש במקום הקיים (עולה כסף)
 * פרויקט שכבר נשלח לאותו חודש — מדולג (קרון שרץ פעמיים לא שולח פעמיים). הרישום ב-job_log.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireAdmin, internalHeaders } from '../../../../lib/auth'
import { monthKeys, KEY_RE, buildMonthlyReport, ownerEmailHtml, pdfFileName } from '../../../../lib/monthly-report.js'
import { periodLabel } from '../../../../lib/report-pdf.js'
import { sendAlert } from '../../../../lib/alert.js'
import { logJob } from '../../../../lib/job-log.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

const JOB = 'monthly-report'
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
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const url = new URL(req.url)
  const sp = url.searchParams
  const origin = process.env.APP_ORIGIN || url.origin
  const def = monthKeys()
  const key = sp.get('key') || def.key
  if (!KEY_RE.test(key)) return J({ error: 'key must be YYYY-MM' }, 400)
  const [y, m] = key.split('-').map(Number)
  const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const force = sp.get('force') === '1'
  const reanalyze = sp.get('reanalyze') === '1'
  const format = sp.get('format')
  const projectId = sp.get('projectId')
  const sb = adminClient()

  // ── כל הפרויקטים: קריאה נפרדת לכל אחד ──
  if (!projectId) {
    if (format) return J({ error: 'format needs projectId' }, 400)
    const { data: projects, error } = await sb.from('projects').select('id, name, is_demo')
    if (error) return J({ error: error.message }, 500)
    const list = (projects || []).filter(p => !p.is_demo)
    const t0 = Date.now()
    const results = await pool(list, 4, async (p) => {
      const q = new URLSearchParams({ projectId: p.id, key, ...(force ? { force: '1' } : {}) })
      try {
        const res = await fetch(`${url.origin}${url.pathname}?${q}`, { headers: internalHeaders(), cache: 'no-store' })
        const body = await res.json().catch(() => ({}))
        return { project: p.name, status: res.status, ...body }
      } catch (e) {
        return { project: p.name, error: e.message || String(e) }
      }
    })
    const failed = results.filter(r => r.error)
    await logJob(sb, JOB + '-all', !failed.length, Date.now() - t0, { key, results: results.map(({ project, emailed, skipped, error }) => ({ project, emailed, skipped, error })) })
    if (failed.length) {
      await sendAlert({
        subject: `Cluzo - דוח חודשי: ${failed.length} פרויקטים נכשלו (${periodLabel(key)})`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif">${failed.map(r => `<p><b>${r.project}</b>: ${String(r.error).replace(/</g, '&lt;')}</p>`).join('')}</div>`,
      })
    }
    return J({ key, prevKey, results })
  }

  // ── פרויקט אחד ──
  const { data: project } = await sb.from('projects').select('id, name, is_demo, clients(name)').eq('id', projectId).maybeSingle()
  if (!project) return J({ error: 'project not found' }, 404)
  const base = { projectId, project: project.name, key }

  if (!format && !force) {
    const { data: sent } = await sb.from('job_log').select('ran_at').eq('job', JOB).eq('ok', true)
      .eq('detail->>projectId', projectId).eq('detail->>key', key).limit(1)
    if (sent?.length) return J({ ...base, skipped: 'already sent', sentAt: sent[0].ran_at })
  }

  const t0 = Date.now()
  try {
    const r = await buildMonthlyReport(sb, project, { key, prevKey, origin, withPdf: format !== 'html', force: reanalyze })
    if (r.skipped) return J({ ...base, skipped: r.skipped })
    const fileName = pdfFileName(project.name, key)
    if (format === 'html') return new NextResponse(r.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
    if (format === 'pdf') {
      return new NextResponse(r.pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`, 'Cache-Control': 'no-store' } })
    }
    const client = project.clients?.name || ''
    const email = await sendAlert({
      subject: `Cluzo - דוח חודשי: ${project.name} - ${periodLabel(key)}`,
      html: ownerEmailHtml({ project: project.name, client, key, prevKey, ai: r.ai, dashboardUrl: `${origin}/admin` }),
      attachments: [{ filename: fileName, content: r.pdf.toString('base64') }],
    })
    const out = { ...base, emailed: !!email.ok, aiReused: !!r.ai.reused, aiError: r.ai.error, costUsd: r.ai.costUsd || 0, pdfKb: Math.round(r.pdf.length / 1024) }
    await logJob(sb, JOB, !!email.ok, Date.now() - t0, { projectId, key, emailed: !!email.ok, aiReused: out.aiReused, aiError: out.aiError || null, emailStatus: email.status || email.error || null })
    return J(email.ok ? out : { ...out, error: 'שליחת המייל נכשלה: ' + (email.error || email.status) })
  } catch (e) {
    await logJob(sb, JOB, false, Date.now() - t0, { projectId, key, error: e.message || String(e) })
    return J({ ...base, error: e.message || String(e) }, 500)
  }
}
