/**
 * lib/ads/tiktok-reports.js — כותב שורות reports (source = 'tiktok') לכל פרויקט שיש לו חשבון TikTok
 * (TIKTOK_ACCOUNTS), מתוך ad_daily בלבד — בלי קריאה ל-TikTok. רץ בסוף ה-recent של prefetch-daily.
 *
 * למה צריך שורות שמורות ולא רק /api/reports/range: לחודשים ולטווחים המוכנים (היום, אתמול, 7/14/30,
 * רבעונים) הדשבורד קורא את הדוחות השמורים, ופונה ל-range רק כשחסר משהו. בלי השורה הזאת טיקטוק
 * היה מופיע רק בטווח מותאם אישית.
 *
 * המפתחות זהים לאלה שכותב prefetch-ads (YYYY-MM לחודש, since_until לטווח). דורש מיגרציה 034
 * (reports_source_check מקבל 'tiktok'); לפניה הכתיבה נכשלת ונרשמת, בלי להפיל את הקרון.
 */
import { aggregateRange } from './daily-store.js'
import { projectRowFilter } from './routing.js'
import { tiktokRow } from './range-rows.js'
import { TIKTOK_ACCOUNTS, tiktokAccountsFor } from './tiktok-api.js'
import { israelToday, addDays } from './daily-sync.js'
import { tiktokInsights, tiktokAdMedia } from './tiktok-insights.js'

const ym = (d) => d.slice(0, 7)
const lastOfMonth = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}` }
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7) }

/** המפתחות שהדשבורד מחפש — אותה רשימה כמו ב-prefetch-ads (חודשים: הנוכחי והקודם). */
export function tiktokPeriodKeys(today = israelToday()) {
  const yr = today.slice(0, 4)
  const cur = ym(today), prev = prevMonth(cur)
  const out = [
    { key: cur, since: `${cur}-01`, until: today },
    { key: prev, since: `${prev}-01`, until: lastOfMonth(prev) },
  ]
  const r = (since, until) => out.push({ key: `${since}_${until}`, since, until })
  r(today, today)                                   // היום
  r(`${cur}-01`, today)                             // החודש הנוכחי
  r(addDays(today, -1), addDays(today, -1))         // אתמול
  for (const n of [7, 14, 30]) r(addDays(today, -n), addDays(today, -1))
  for (const [a, b] of [['01-01', '03-31'], ['04-01', '06-30'], ['07-01', '09-30'], ['10-01', '12-31']]) {
    const since = `${yr}-${a}`, until = `${yr}-${b}`
    if (since <= today) r(since, until)
  }
  return out
}

/**
 * @returns {Promise<{ok:boolean, written:number, errors:string[]}>}
 */
export async function writeTikTokReports(sb, { today = israelToday(), insights = false, deadlineMs = Infinity } = {}) {
  const errors = []
  let written = 0
  if (!TIKTOK_ACCOUNTS.length) return { ok: true, written, errors }
  const { data: projects, error } = await sb.from('projects').select('id, name')
  if (error) return { ok: false, written, errors: ['projects: ' + error.message] }
  const mine = (projects || []).filter(p => tiktokAccountsFor(p.name).length)
  if (!mine.length) return { ok: true, written, errors }

  // החשבון נפתח ב-TIKTOK_ACCOUNTS[].since — תקופה שמסתיימת לפני כן לא נכתבת (אין מה להראות).
  const firstDay = TIKTOK_ACCOUNTS.map(a => a.since).filter(Boolean).sort()[0] || '2026-01-01'

  // insights (צפיות, מעורבות, קהלים, תמונות) — קריאות חיות ל-TikTok, לחשבון הראשון של כל פרויקט.
  // כשל או חוסר זמן → נשארים ה-insights הקודמים שבשורה (לא מוחקים מה שכבר הוצג).
  const prevInsights = new Map()
  const media = new Map()
  let insightErrors = 0
  if (insights) {
    const { data: prev } = await sb.from('reports').select('project_id, month, summary').eq('source', 'tiktok').in('project_id', mine.map(p => p.id))
    for (const r of prev || []) if (r.summary?.insights) prevInsights.set(r.project_id + '|' + r.month, r.summary.insights)
    for (const acct of new Set(mine.map(p => tiktokAccountsFor(p.name)[0]?.advertiserId).filter(Boolean))) {
      try { media.set(acct, await tiktokAdMedia(acct, process.env.TIKTOK_ACCESS_TOKEN)) } catch (e) { insightErrors++; errors.push('media: ' + String(e?.message || e).slice(0, 120)) }
    }
  }

  for (const per of tiktokPeriodKeys(today)) {
    if (per.until < firstDay) continue
    let all
    try { all = await aggregateRange(sb, 'tiktok', per.since, per.until) }
    catch (e) { errors.push(`${per.key}: ${String(e?.message || e).slice(0, 120)}`); continue }
    for (const p of mine) {
      const filter = projectRowFilter(p, 'tiktok')
      const rows = filter ? all.filter(filter) : []
      const shaped = tiktokRow(p, rows)
      if (insights) {
        const acct = tiktokAccountsFor(p.name)[0]?.advertiserId
        let ins = null
        if (acct && Date.now() < deadlineMs) {
          const until = per.until > today ? today : per.until
          const since = per.since < firstDay ? firstDay : per.since
          try { ins = await tiktokInsights(acct, since, until) } catch (e) { insightErrors++ }
          if (ins?.errors?.adStats) { insightErrors++; ins = null }
        }
        const prevIns = prevInsights.get(p.id + '|' + per.key)
        const m = media.get(acct)
        if (ins) shaped.summary.insights = { ...ins, media: m || prevIns?.media || {} }
        else if (prevIns) shaped.summary.insights = prevIns
      }
      const { error: upErr } = await sb.from('reports').upsert({
        project_id: p.id, source: 'tiktok', month: per.key,
        data: shaped.data, summary: shaped.summary, row_count: shaped.row_count,
        file_name: 'TikTok daily facts',
      }, { onConflict: 'project_id,source,month' })
      if (upErr) { errors.push(`${p.name} ${per.key}: ${upErr.message.slice(0, 120)}`); if (/check constraint/i.test(upErr.message)) return { ok: false, written, errors, needsMigration: '034' } }
      else written++
    }
  }
  return { ok: errors.length === 0, written, ...(insights ? { insightErrors } : {}), errors: errors.slice(0, 5) }
}
