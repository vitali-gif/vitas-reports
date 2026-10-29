/**
 * lib/monthly-report.js — דוח PDF חודשי אוטומטי (ויטלי, 29.10: "כל ה-5 לחודש ישלח קובץ PDF, בהתחלה
 * רק אלי במייל ואז ללקוחות, ולשלב בו את הניתוח AI").
 *
 * לכל פרויקט: החודש הקודם מול החודש שלפניו. השורות — הדוחות השמורים (טבלת reports, כמו שהדשבורד
 * רואה), ומה שחסר מ-/api/reports/range. המודל — buildReportModel, אותו דוח כמו כפתור הייצוא.
 * הניתוח — ניתוח AI קיים לאותה תקופה (כפתור או ריצה קודמת), ואם אין: ניתוח חדש שנשמר ב-ai_analyses.
 * ה-PDF — Chromium בשרת (@sparticuz/chromium ב-Vercel, Chromium מקומי בפיתוח).
 *
 * בשלב הזה הדוח נשלח רק לויטלי (ALERT_EMAIL_TO). שליחה ללקוחות — אחרי שהוא מאשר את הדוחות.
 */
import { buildReportModel, renderReportHtml, periodLabel } from './report-pdf.js'
import { analysisInput, runAnalysis } from './ai-analysis.js'
import { analysisText, clientText } from './ai-analysis-text.js'
import { internalHeaders } from './auth.js'

const ilParts = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(d).split('-').map(Number)
const mk = (y, m) => `${y}-${String(m).padStart(2, '0')}`
const back = (y, m) => (m === 1 ? [y - 1, 12] : [y, m - 1])

/** החודש שהסתיים (שעון ישראל) והחודש שלפניו: 5.11 → '2026-10' מול '2026-09'. */
export function monthKeys(now = new Date()) {
  const [y, m] = ilParts(now)
  const [py, pm] = back(y, m), [qy, qm] = back(py, pm)
  return { key: mk(py, pm), prevKey: mk(qy, qm) }
}

export const KEY_RE = /^\d{4}-\d{2}$/
const lastDay = (key) => { const [y, m] = key.split('-').map(Number); return `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }

/** השורות של חודש: הדוחות השמורים, ומה שחסר (CRM או מודעות) — מהעובדות היומיות. */
export async function monthRows(sb, projectId, key, origin) {
  const { data, error } = await sb.from('reports').select('id, project_id, source, month, summary, data').eq('project_id', projectId).eq('month', key)
  if (error) throw new Error('reports: ' + error.message)
  let rows = data || []
  const hasCrm = rows.some(r => r.source === 'crm')
  const hasAds = rows.some(r => r.source === 'facebook' || (r.source || '').startsWith('google'))
  if (!(hasCrm && hasAds) && origin) {
    const res = await fetch(`${origin}/api/reports/range?projectId=${projectId}&since=${key}-01&until=${lastDay(key)}`, { headers: internalHeaders(), cache: 'no-store' }).catch(() => null)
    const body = res && res.ok ? await res.json().catch(() => null) : null
    const have = new Set(rows.map(r => r.source))
    if (Array.isArray(body?.rows)) rows = [...rows, ...body.rows.filter(r => !have.has(r.source))]
  }
  return rows
}

/**
 * ניתוח AI לתקופה: הקיים האחרון לאותה תקופה ואותה השוואה (שיש בו הודעה ללקוח), או ניתוח חדש.
 * מחזיר { analysis, reused, costUsd } או { error }. ניתוח שלא נשמר לא מבוזבז — הוא מוחזר בכל זאת.
 */
export async function insightsFor(sb, projectId, model, { force = false } = {}) {
  const { key, prevKey } = model
  if (!force) {
    const { data } = await sb.from('ai_analyses').select('id, period_key, compare_key, trigger, result, created_at')
      .eq('project_id', projectId).eq('period_key', key).eq('compare_key', prevKey)
      .order('created_at', { ascending: false }).limit(5)
    const hit = (data || []).find(a => a.result?.clientMessage)
    if (hit) return { analysis: hit, reused: true, costUsd: 0 }
  }
  const input = analysisInput(model)
  if (!input || (!input.metrics.length && !input.funnel.length)) return { error: 'אין נתונים לתקופה' }
  try {
    const out = await runAnalysis(input)
    const row = { project_id: projectId, period_key: key, compare_key: prevKey, trigger: 'monthly', model: out.model, input, result: out.result, usage: out.usage, created_by: 'cron-monthly' }
    let { error } = await sb.from('ai_analyses').insert(row)
    // עד שמיגרציה 026 רצה, 'monthly' נדחה על ידי ה-CHECK — נשמר כ-'manual' כדי לא לשלם שוב בריצה הבאה.
    if (error?.code === '23514') ({ error } = await sb.from('ai_analyses').insert({ ...row, trigger: 'manual' }))
    if (error) console.warn('[monthly-report] save analysis failed:', error.message)
    return { analysis: { period_key: key, compare_key: prevKey, result: out.result }, reused: false, costUsd: out.usage.costUsd }
  } catch (e) {
    return { error: e.message || String(e), code: e.code }
  }
}

/** HTML → PDF. ב-Vercel: @sparticuz/chromium; מקומית: CHROME_PATH או ה-Chromium של Playwright. */
export async function htmlToPdf(html) {
  const puppeteer = (await import('puppeteer-core')).default
  let launch
  if (process.env.VERCEL) {
    const chromium = (await import('@sparticuz/chromium')).default
    launch = { args: chromium.args, executablePath: await chromium.executablePath(), headless: true }
  } else {
    launch = { executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox'] }
  }
  const browser = await puppeteer.launch(launch)
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45_000 }).catch(() => {})   // תמונת מודעה שלא נטענת לא עוצרת את הדוח
    await page.evaluate(() => document.fonts?.ready).catch(() => {})
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    return Buffer.from(pdf)
  } finally {
    await browser.close().catch(() => {})
  }
}

/** הדוח של פרויקט אחד: מודל, ניתוח, HTML ו-PDF. */
export async function buildMonthlyReport(sb, project, { key, prevKey, origin, withPdf = true, force = false }) {
  const client = project.clients?.name || ''
  const [rows, prevRows] = await Promise.all([monthRows(sb, project.id, key, origin), monthRows(sb, project.id, prevKey, origin)])
  if (!rows.length) return { skipped: 'אין נתונים לחודש' }
  const model = buildReportModel({ project: project.name, client, key, prevKey, rows, prevRows })
  const ai = await insightsFor(sb, project.id, model, { force })
  const html = renderReportHtml(model, { assetBase: origin, insights: ai.analysis?.result || null })
  const pdf = withPdf ? await htmlToPdf(html) : null
  return { model, ai, html, pdf }
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const pre = (t) => `<div style="white-space:pre-wrap;background:#f5f7fc;border:1px solid #dce3ef;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.6">${esc(t)}</div>`

/** המייל לויטלי: מה מצורף, ההודעה ללקוח (להעתקה) והניתוח הפנימי המלא — הוא לא נכנס ל-PDF. */
export function ownerEmailHtml({ project, client, key, prevKey, ai, dashboardUrl }) {
  const a = ai?.analysis
  const ct = a ? clientText(a, { project }) : null
  const it = a ? analysisText(a, { project, client }) : null
  return `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#14243c;max-width:680px">
    <div style="font-size:12px;color:#52627a">${esc(client ? client + ' · ' : '')}${esc(periodLabel(key))} מול ${esc(periodLabel(prevKey))}</div>
    <h2 style="margin:2px 0 8px">דוח חודשי - ${esc(project)}</h2>
    <p style="margin:0 0 14px">הדוח מצורף כ-PDF. בשלב הזה הוא נשלח רק אליך - הלקוח עוד לא קיבל אותו.</p>
    ${ai?.error ? `<p style="color:#b3261e">ניתוח ה-AI נכשל (${esc(ai.error)}), ולכן בדוח אין "סיכום החודש".</p>` : ''}
    ${ct ? `<h3 style="margin:16px 0 6px">ההודעה ללקוח (מופיעה בדוח כ"סיכום החודש")</h3>${pre(ct)}` : ''}
    ${it ? `<h3 style="margin:16px 0 6px">הניתוח הפנימי (לא בדוח)</h3>${pre(it)}` : ''}
    ${dashboardUrl ? `<p style="margin-top:16px"><a href="${esc(dashboardUrl)}">לדשבורד</a></p>` : ''}
    <p style="font-size:11px;color:#8a93a8">ההסברים בניתוח הם השערות על בסיס הנתונים, לא הוכחה לסיבה.</p>
  </div>`
}

/** שם הקובץ: "HI PARK - אוקטובר 2026.pdf" (בלי תווים שמערכות קבצים לא אוהבות). */
export const pdfFileName = (project, key) => `${String(project).replace(/[\\/:*?"<>|]+/g, ' ').trim()} - ${periodLabel(key)}.pdf`
