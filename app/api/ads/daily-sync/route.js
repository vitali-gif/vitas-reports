/**
 * POST /api/ads/daily-sync — מילוי טבלת העובדות היומיות ad_daily (מיגרציה 007).
 * שלב 2 של docs/daily-ranges-plan.md.
 *
 * body:
 *   { mode: 'recent' }                       — 7 הימים האחרונים כולל היום, כל החשבונות, Meta+Google.
 *                                              Meta מעדכנת המרות באיחור, לכן מושכים מחדש שבוע אחורה בכל ריצה.
 *   { mode: 'backfill' }                     — צעד אחד של מילוי היסטורי: לכל (מקור, חשבון) חודש אחד לפני
 *                                              היום המוקדם שכבר שמור, עד AD_DAILY_BACKFILL_SINCE (ברירת מחדל 2026-01-01).
 *                                              נקרא מהקרון בכל ריצה → ההיסטוריה מתמלאת לבד תוך יום, בלי טריגר ידני.
 *   { mode: 'range', since, until, sources? } — טווח מפורש (אדמין), עד 62 ימים.
 *
 * לכל טווח: מוחקים את שורות היום/החשבון בטווח ואז כותבים מחדש — כדי שמודעה שנעלמה
 * מהתשובה לא תישאר כזומבי. הרשאה: אדמין או קריאה פנימית (קרון).
 */
import { requireAdmin, adminClient } from '../../../../lib/auth'
import { upsertDailyRows, deleteDailyRange, coverage } from '../../../../lib/ads/daily-store.js'
import { fetchMetaDaily } from '../../../../lib/ads/meta-daily.js'
import { fetchGoogleDaily } from '../../../../lib/ads/google-daily.js'
import { metaAccountIds } from '../../../../lib/ads/meta-api.js'
import { googleCustomerIds } from '../../../../lib/ads/google-api.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const BACKFILL_SINCE = () => process.env.AD_DAILY_BACKFILL_SINCE || '2026-01-01'
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const israelToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

async function syncOne(sb, source, account, since, until) {
  const t0 = Date.now()
  try {
    const { rows, diag } = source === 'facebook' ? await fetchMetaDaily(account, since, until) : await fetchGoogleDaily(account, since, until)
    await deleteDailyRange(sb, source, account, since, until)
    const { count } = await upsertDailyRows(sb, rows)
    return { source, account, since, until, ok: true, rows: count, ms: Date.now() - t0, diag }
  } catch (e) {
    return { source, account, since, until, ok: false, error: String(e?.message || e).slice(0, 300), ms: Date.now() - t0 }
  }
}

function accountsFor(sources) {
  const list = []
  if (sources.includes('facebook')) for (const a of metaAccountIds()) list.push({ source: 'facebook', account: a })
  if (sources.includes('google'))   for (const c of googleCustomerIds()) list.push({ source: 'google', account: c })
  return list
}

export async function POST(request) {
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.res
  let body = {}
  try { body = await request.json() } catch {}
  const mode = body.mode || 'recent'
  const sources = Array.isArray(body.sources) && body.sources.length ? body.sources.filter(s => s === 'facebook' || s === 'google') : ['facebook', 'google']
  const sb = adminClient()
  const today = israelToday()
  const startedAt = Date.now()
  const BUDGET_MS = 240000   // מתחת ל-maxDuration, כדי לחזור עם תשובה ולא ליפול על 504

  let jobs = []
  if (mode === 'recent') {
    jobs = accountsFor(sources).map(a => ({ ...a, since: addDays(today, -7), until: today }))
  } else if (mode === 'range') {
    if (!isDate(body.since) || !isDate(body.until) || body.since > body.until) return Response.json({ error: 'since/until required (YYYY-MM-DD, since <= until)' }, { status: 400 })
    const span = Math.round((new Date(body.until) - new Date(body.since)) / 86400000) + 1
    if (span > 62) return Response.json({ error: 'range too long (max 62 days per call)' }, { status: 400 })
    jobs = accountsFor(sources).map(a => ({ ...a, since: body.since, until: body.until }))
  } else if (mode === 'backfill') {
    const floor = BACKFILL_SINCE()
    const cov = await coverage(sb)
    for (const a of accountsFor(sources)) {
      const c = cov.find(x => x.source === a.source && x.account === a.account)
      // בלי כיסוי → מתחילים מהיום אחורה; עם כיסוי → מהיום שלפני היום המוקדם השמור.
      const end = c?.min_day ? addDays(String(c.min_day).slice(0, 10), -1) : today
      if (end < floor) continue   // הושלם
      const start = addDays(end, -30) < floor ? floor : addDays(end, -30)
      jobs.push({ ...a, since: start, until: end })
    }
    if (!jobs.length) return Response.json({ ok: true, mode, done: true, floor, note: 'backfill complete for all accounts' })
  } else {
    return Response.json({ error: 'unknown mode' }, { status: 400 })
  }

  // ריצה סדרתית לכל מקור, מקבילית בין המקורות — עדין ל-API של Meta ושומר על התקציב.
  const results = []
  const runSource = async (src) => {
    for (const j of jobs.filter(x => x.source === src)) {
      if (Date.now() - startedAt > BUDGET_MS) { results.push({ ...j, ok: false, deferred: true, error: 'time budget exhausted' }); continue }
      results.push(await syncOne(sb, j.source, j.account, j.since, j.until))
    }
  }
  await Promise.all(sources.map(runSource))

  const failed = results.filter(r => !r.ok && !r.deferred)
  return Response.json({ ok: failed.length === 0, mode, today, jobs: results.length, failed: failed.length, deferred: results.filter(r => r.deferred).length, ms: Date.now() - startedAt, results })
}

/** GET — כיסוי נוכחי (אדמין/קרון). נוח לבדיקה ולחיישן health. */
export async function GET(request) {
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.res
  try {
    const cov = await coverage(adminClient())
    return Response.json({ ok: true, floor: BACKFILL_SINCE(), coverage: cov })
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
