/**
 * lib/ads/daily-sync.js — הליבה של מילוי העובדות היומיות (ad_daily), משותפת ל-
 * POST /api/ads/daily-sync (אדמין) ול-GET /api/cron/prefetch-daily (קרון).
 * שלב 2 של docs/daily-ranges-plan.md.
 *
 * modes:
 *   recent   — 7 הימים האחרונים כולל היום, כל החשבונות (Meta מעדכנת המרות באיחור).
 *   backfill — צעד אחד של מילוי היסטורי: לכל (מקור, חשבון) חודש אחד לפני היום המוקדם
 *              שכבר שמור, עד AD_DAILY_BACKFILL_SINCE (ברירת מחדל 2026-01-01).
 *   range    — טווח מפורש (עד 62 ימים).
 *
 * לכל טווח: מוחקים את שורות היום/החשבון בטווח ואז כותבים מחדש, כדי שמודעה שנעלמה
 * מהתשובה לא תישאר כזומבי. כל ריצה נרשמת ב-job_log.
 */
import { upsertDailyRows, deleteDailyRange, coverage } from './daily-store.js'
import { fetchMetaDaily } from './meta-daily.js'
import { fetchGoogleDaily } from './google-daily.js'
import { metaAccountIds } from './meta-api.js'
import { googleCustomerIds } from './google-api.js'
import { logJob } from '../job-log.js'

export const BACKFILL_SINCE = () => process.env.AD_DAILY_BACKFILL_SINCE || '2026-01-01'
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
export const israelToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
export const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/**
 * משיכה + כתיבה של (מקור, חשבון, טווח) אחד.
 * deadlineMs (זמן מוחלט, Date.now()): המשיכה נקטעת כשמגיעים אליו — עד 18.9 בדיקת התקציב נעשתה רק
 * *בין* משימות, ומשיכת חודש של Meta (level=ad × age,gender, ~18k שורות) לקחה 50–215 שניות; הפונקציה
 * של Vercel נהרגה ב-300s לפני שנרשם job_log / heartbeat, והשומר התריע "קרון נתקע" למרות ש-recent רץ.
 */
async function syncOne(sb, source, account, since, until, { deadlineMs } = {}) {
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = Number.isFinite(deadlineMs) ? setTimeout(() => ctrl.abort(), Math.max(1, deadlineMs - Date.now())) : null
  try {
    const { rows, diag } = source === 'facebook'
      ? await fetchMetaDaily(account, since, until, { signal: ctrl.signal })
      : await fetchGoogleDaily(account, since, until, { signal: ctrl.signal })
    await deleteDailyRange(sb, source, account, since, until)
    const { count } = await upsertDailyRows(sb, rows)
    return { source, account, since, until, ok: true, rows: count, ms: Date.now() - t0, diag }
  } catch (e) {
    // נקטע בגלל התקציב — לא כשל של המקור; יחזור בריצה הבאה (deferred, כמו "time budget exhausted").
    if (ctrl.signal.aborted) return { source, account, since, until, ok: false, deferred: true, error: 'time budget exhausted (fetch aborted)', ms: Date.now() - t0 }
    return { source, account, since, until, ok: false, error: String(e?.message || e).slice(0, 300), ms: Date.now() - t0 }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** משימה לא מתחילה כשנשאר פחות מזה מהתקציב — אין טעם לפתוח משיכה שתיקטע מיד. */
const MIN_JOB_MS = 15000

function accountsFor(sources) {
  const list = []
  if (sources.includes('facebook')) for (const a of metaAccountIds()) list.push({ source: 'facebook', account: a })
  if (sources.includes('google'))   for (const c of googleCustomerIds()) list.push({ source: 'google', account: c })
  return list
}

/**
 * @param sb לקוח service_role
 * @param {{mode?: string, sources?: string[], since?: string, until?: string, budgetMs?: number, job?: string}} opts
 * @returns {Promise<{status:number, body:object}>}
 */
export async function runDailySync(sb, opts = {}) {
  const startedAt = Date.now()
  const mode = opts.mode || 'recent'
  const sources = Array.isArray(opts.sources) && opts.sources.length ? opts.sources.filter(s => s === 'facebook' || s === 'google') : ['facebook', 'google']
  const budgetMs = opts.budgetMs || 240000
  const today = israelToday()
  const jobName = opts.job || `ad-daily-sync:${mode}`

  let jobs = []
  if (mode === 'recent') {
    jobs = accountsFor(sources).map(a => ({ ...a, since: addDays(today, -7), until: today }))
  } else if (mode === 'range') {
    if (!isDate(opts.since) || !isDate(opts.until) || opts.since > opts.until) return { status: 400, body: { error: 'since/until required (YYYY-MM-DD, since <= until)' } }
    const span = Math.round((new Date(opts.until) - new Date(opts.since)) / 86400000) + 1
    if (span > 62) return { status: 400, body: { error: 'range too long (max 62 days per call)' } }
    jobs = accountsFor(sources).map(a => ({ ...a, since: opts.since, until: opts.until }))
  } else if (mode === 'backfill') {
    const floor = BACKFILL_SINCE()
    let cov
    try { cov = await coverage(sb) } catch (e) {
      await logJob(sb, jobName, false, Date.now() - startedAt, { error: 'coverage: ' + String(e?.message || e) })
      return { status: 500, body: { ok: false, mode, error: 'coverage: ' + String(e?.message || e) } }
    }
    for (const a of accountsFor(sources)) {
      const c = cov.find(x => x.source === a.source && x.account === a.account)
      // בלי כיסוי → מהיום אחורה; עם כיסוי → מהיום שלפני היום המוקדם השמור.
      const end = c?.min_day ? addDays(String(c.min_day).slice(0, 10), -1) : today
      if (end < floor) continue   // הושלם
      const start = addDays(end, -30) < floor ? floor : addDays(end, -30)
      jobs.push({ ...a, since: start, until: end })
    }
    if (!jobs.length) {
      await logJob(sb, jobName, true, Date.now() - startedAt, { done: true, floor })
      return { status: 200, body: { ok: true, mode, done: true, floor, note: 'backfill complete for all accounts' } }
    }
    // הכי-מאחור קודם: החשבון שהכיסוי שלו מסתיים הכי מאוחר (until הגדול ביותר) עוד לא התקדם בכלל.
    // בסדר קבוע לפי ENV שני החשבונות האחרונים ברשימה קיבלו תמיד "time budget exhausted" ונשארו
    // ב-min_day של היום הראשון (נמדד 18.9: שניים מששת חשבונות Meta תקועים על 2026-09-10).
    jobs.sort((a, b) => (a.until < b.until ? 1 : a.until > b.until ? -1 : 0))
  } else {
    return { status: 400, body: { error: 'unknown mode' } }
  }

  if (!jobs.length) {
    await logJob(sb, jobName, false, Date.now() - startedAt, { error: 'no accounts configured', sources })
    return { status: 200, body: { ok: false, mode, jobs: 0, error: 'no accounts configured (META_AD_ACCOUNT_ID(S) / GOOGLE_ADS_CUSTOMER_ID(S))' } }
  }

  // ריצה סדרתית לכל מקור, מקבילית בין המקורות — עדין ל-API של Meta ושומר על התקציב.
  // התקציב נאכף גם בתוך משימה (deadline → abort), לא רק בין משימות — אחרת משימת Meta אחת
  // יכולה לחרוג בדקות ולהפיל את כל הפונקציה (ראו syncOne).
  const deadline = startedAt + budgetMs
  const results = []
  const runSource = async (src) => {
    for (const j of jobs.filter(x => x.source === src)) {
      if (deadline - Date.now() < MIN_JOB_MS) { results.push({ ...j, ok: false, deferred: true, error: 'time budget exhausted' }); continue }
      results.push(await syncOne(sb, j.source, j.account, j.since, j.until, { deadlineMs: deadline }))
    }
  }
  await Promise.all(sources.map(runSource))

  const failed = results.filter(r => !r.ok && !r.deferred)
  const deferred = results.filter(r => r.deferred)
  const ms = Date.now() - startedAt
  const body = { ok: failed.length === 0, mode, today, jobs: results.length, failed: failed.length, deferred: deferred.length, ms, results }
  await logJob(sb, jobName, failed.length === 0, ms, {
    jobs: results.length, failed: failed.length, deferred: deferred.length,
    rows: results.reduce((s, r) => s + (r.rows || 0), 0),
    perJob: results.map(r => ({ s: r.source, a: r.account, d: `${r.since}..${r.until}`, ok: r.ok, rows: r.rows, ms: r.ms, err: r.error })),
  })
  return { status: 200, body }
}
