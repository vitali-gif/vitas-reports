/**
 * scripts/demo/extract-profile.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * שואב מ-ONCE האמיתי את **המספרים בלבד** ומייצר profile.mjs חדש.
 *
 * זהו הכלי היחיד בכל התהליך שנוגע בנתון אמיתי, והוא רץ פעם אחת, מקומית.
 * הפלט שלו הוא קובץ של יחסים והתפלגויות — אין בו ולו מחרוזת אחת שמקורה
 * בנתון אמיתי:
 *   · שמות מקורות עוברים דרך SOURCE_MAP; מקור לא מוכר → 'ללא מקור'
 *   · שמות אנשי מכירות מומרים לאינדקסים בלבד (נשמרות רק חלוקה ומהירות יחסית)
 *   · שמות ערים מומרים למשקלים לפי דירוג (העיר החזקה ביותר → CITIES[0])
 *   · התנגדויות מומרות למשקלים לפי דירוג
 *   · שמות לידים, טלפונים ותיאורי פגישות **לא נקראים בכלל**
 *
 * הרצה:
 *   SUPABASE_URL=https://xxx.supabase.co \\
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \\
 *   node scripts/demo/extract-profile.mjs > scripts/demo/profile.mjs.new
 *
 * ואז לבדוק את הפלט ולהחליף:  mv profile.mjs.new profile.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { SOURCE_MAP, SALESPEOPLE, CITIES, OBJECTIONS } from './dictionaries.mjs'

const URL_    = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY
const PROJECT = process.env.DEMO_SOURCE_PROJECT || 'ONCE'

if (!URL_ || !KEY) {
  console.error('חסר SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(URL_, KEY)

// ── איתור הפרויקט ───────────────────────────────────────────────────────────
const { data: projects, error: pErr } = await sb.from('projects').select('id, name')
if (pErr) { console.error('שגיאת קריאת projects: ' + pErr.message); process.exit(1) }
const project = (projects || []).find(p => (p.name || '').toLowerCase() === PROJECT.toLowerCase())
if (!project) {
  console.error(`הפרויקט "${PROJECT}" לא נמצא. פרויקטים קיימים: ${(projects || []).map(p => p.name).join(', ')}`)
  process.exit(1)
}

// ── בחירת התקופות ───────────────────────────────────────────────────────────
const now = new Date()
const yr  = now.getFullYear()
const pad = (n) => String(n).padStart(2, '0')
const curKey  = `${yr}-${pad(now.getMonth() + 1)}`
const prvKey  = now.getMonth() === 0 ? `${yr - 1}-12` : `${yr}-${pad(now.getMonth())}`
const q2Key   = `${yr}-04-01_${yr}-06-30`
const KEYS    = { current: curKey, previous: prvKey, q2: q2Key }

const { data: rows, error: rErr } = await sb
  .from('reports')
  .select('source, month, data, summary')
  .eq('project_id', project.id)
  .in('month', Object.values(KEYS))
if (rErr) { console.error('שגיאת קריאת reports: ' + rErr.message); process.exit(1) }

const get = (month, source) => (rows || []).find(r => r.month === month && r.source === source)

// ── עזרים ───────────────────────────────────────────────────────────────────
const r2 = (n) => Math.round(n * 1000) / 1000
const safeDiv = (a, b) => (b > 0 ? a / b : 0)

/** ממיר מפה של {שם → מספר} למערך משקלים לפי דירוג, מנותק משמות אמיתיים. */
function rankToWeights(map, targetLen) {
  const sorted = Object.entries(map || {}).sort((a, b) => b[1] - a[1])
  const out = new Array(targetLen).fill(0)
  sorted.slice(0, targetLen).forEach(([, v], i) => { out[i] = Math.max(1, Math.round(v)) })
  // מילוי זנב כדי שכל הערכים במאגר יופיעו בהתפלגות דועכת
  for (let i = sorted.length; i < targetLen; i++) out[i] = Math.max(1, Math.round((out[0] || 10) * 0.06))
  return out
}

function extractCrm(row, spanDays) {
  if (!row?.summary) return null
  const s  = row.summary
  const rt = s.responseTimeStats || {}
  const N  = s.totalLeads || 0

  return {
    spanDays,
    totalLeads: N,
    relevantShare:        r2(safeDiv(s.relevantLeads, N)),
    meetingScheduledRate: r2(safeDiv(s.meetingsScheduled, N)),
    meetingCompletedRate: r2(safeDiv(s.meetingsCompleted, s.meetingsScheduled)),
    meetingCancelledRate: r2(safeDiv(s.meetingsCancelled, s.meetingsScheduled)),
    registrationRate:     r2(safeDiv(s.registrations, N)),
    avgRegistrationValue: Math.round(safeDiv(s.registrationValue, s.registrations) / 5000) * 5000,
    contractRate:         r2(safeDiv(s.contracts, s.registrations)),
    avgContractValue:     Math.round(safeDiv(s.contractValue, s.contracts) / 5000) * 5000,
    noResponseRate:       r2(safeDiv(rt.noResponseCount, rt.totalLids || N)),
    respondedShare:       r2(safeDiv(rt.respondedCount, rt.totalLids || N)),
    avgResponseMinutes:   Math.round(rt.avgMinutes || 0),
    avgBusinessMinutes:   Math.round(rt.business?.avgMinutes || 0),
  }
}

function extractAds(row) {
  const s = row?.summary
  if (!s) return null
  return {
    spend:       Math.round(s.spend || 0),
    impressions: Math.round(s.impressions || 0),
    reach:       Math.round(s.reach || 0),
    clicks:      Math.round(s.clicks || 0),
    leads:       Math.round(s.leads || 0),
  }
}

// ── חילוץ התפלגויות מהתקופה הארוכה ביותר (Q2) — הכי מייצגת ─────────────────
const q2crm = get(q2Key, 'crm')
const S = q2crm?.summary || {}

// מקורות: שם BMBY → תווית דמו
const sourceMix = {}
for (const [raw, v] of Object.entries(S.sources || {})) {
  const low = String(raw).toLowerCase().trim()
  let label = 'ללא מקור'
  for (const [needle, mapped] of Object.entries(SOURCE_MAP)) {
    if (low.includes(needle.toLowerCase())) { label = mapped; break }
  }
  sourceMix[label] = (sourceMix[label] || 0) + (v.totalLeads || 0)
}

// אנשי מכירות: חלוקה ומהירות יחסית — ללא שמות
const byUser = Object.entries(S.responseTimeStats?.byUser || {})
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, SALESPEOPLE.length)
const userTotal = byUser.reduce((a, [, v]) => a + v.count, 0) || 1
const avgAll    = S.responseTimeStats?.avgMinutes || 1
const salespeopleShare       = SALESPEOPLE.map((_, i) => r2(safeDiv(byUser[i]?.[1].count || 0, userTotal)))
const salespeopleSpeedFactor = SALESPEOPLE.map((_, i) => r2(safeDiv(byUser[i]?.[1].avgMinutes || avgAll, avgAll)))

// ימים ושעות
const dayOfWeekWeights = Array.from({ length: 7 }, (_, i) => S.dayOfWeekStats?.[i]?.leads || 0)
const dayOfWeekConvFactor = Array.from({ length: 7 }, (_, i) => {
  const d = S.dayOfWeekStats?.[i] || {}
  const rate = safeDiv(d.scheduled, d.leads)
  const base = safeDiv(S.meetingsScheduled, S.totalLeads)
  return r2(base > 0 ? rate / base : 1)
})
const hourlyLeadWeights = Array.from({ length: 24 }, (_, h) => S.hourlyLeadStats?.[h] || 0)
const hourlyApptWeights = Array.from({ length: 24 }, (_, h) => S.hourlyApptStats?.[h] || 0)

// דלי זמן תגובה
const BUCKET_KEYS = ['0-15m', '15m-1h', '1h-4h', '4h-8h', '8h-1d', '1d-3d', '3d+']
const responseBucketWeights = BUCKET_KEYS.map(k => S.responseTimeStats?.buckets?.[k] || 0)

// ערים והתנגדויות: דירוג → משקלים (השמות האמיתיים נזרקים)
const cityCounts = {}
const objCounts  = {}
for (const row of S.crmRepRows || []) {
  if (row.address) cityCounts[row.address] = (cityCounts[row.address] || 0) + 1
  if (row.objections) objCounts[row.objections] = (objCounts[row.objections] || 0) + 1
}
const cityWeights      = rankToWeights(cityCounts, CITIES.length)
const objectionWeights = rankToWeights(objCounts, OBJECTIONS.length)

// ── הרכבת הפרופיל ───────────────────────────────────────────────────────────
const periods = {}
const SPANS = { current: now.getDate(), previous: 30, q2: 91 }
for (const [name, key] of Object.entries(KEYS)) {
  const crm = extractCrm(get(key, 'crm'), SPANS[name])
  if (!crm) { console.error(`⚠ אין דוח CRM לתקופה ${name} (${key})`); continue }
  const { spanDays, ...crmRest } = crm
  periods[name] = {
    key: name === 'q2' ? 'q2' : name === 'current' ? 'currentMonth' : 'lastMonth',
    spanDays,
    crm: crmRest,
    facebook: extractAds(get(key, 'facebook')) || { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 },
    google:   extractAds(get(key, 'google'))   || { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 },
  }
}

const out = {
  _source: 'ONCE (anonymized aggregates only)',
  _extractedAt: new Date().toISOString().slice(0, 10),
  baseMonth: curKey,
  seed: 20260726,
  periods,
  sourceMix,
  salespeopleShare,
  salespeopleSpeedFactor,
  dayOfWeekWeights,
  dayOfWeekConvFactor,
  hourlyLeadWeights,
  hourlyApptWeights,
  responseBucketWeights,
  cityWeights,
  objectionWeights,
  fbCampaignWeights: [38, 27, 21, 14],
  googleCampaignWeights: [22, 31, 33, 14],
  ageBuckets: ['25-34', '35-44', '45-54', '55-64', '65+'],
  ageWeights: [18, 31, 26, 17, 8],
  genderBuckets: ['male', 'female'],
  genderWeights: [54, 46],
  monthlyBudget: 36_000,
}

process.stdout.write(`/**
 * scripts/demo/profile.mjs — נוצר אוטומטית ע"י extract-profile.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * מספרים בלבד. אין כאן שום מחרוזת שמקורה בנתון אמיתי.
 * לכוונון הנרטיב המכירתי — ערוך ידנית והרץ מחדש את build-demo-dataset.
 */

export const PROFILE = ${JSON.stringify(out, null, 2)}

export default PROFILE
`)

console.error('\n✓ הפרופיל חולץ. בדוק את הפלט לפני החלפת profile.mjs.')
console.error(`  מקורות שזוהו: ${Object.keys(sourceMix).join(', ')}`)
console.error(`  תקופות: ${Object.keys(periods).join(', ')}`)
