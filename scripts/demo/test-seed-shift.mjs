/**
 * scripts/demo/test-seed-shift.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * בדיקת הטענה המרכזית של כל התכנון:
 * "הדמו לא יישבר לעולם, והמספרים לא יזוזו לעולם".
 *
 * מדמה את ה-seeder על פני 24 חודשים קדימה, ולכל חודש בודק:
 *   1. שכל 9 הדוחות נכתבים תחת המפתחות שהדשבורד יחפש באותו יום
 *   2. שכל מספר בדאטהסט נשאר זהה בדיוק (רק תאריכים זזים)
 *   3. שכל תאריך שהוזז נופל בתוך התקופה שאליה הוא שייך
 *
 * הרצה:  node scripts/demo/test-seed-shift.mjs
 */

import { PROFILE } from './profile.mjs'
import { synthesize } from './synthesize.mjs'

const pad = (n) => String(n).padStart(2, '0')

// ── שכפול מדויק של הלוגיקה ב-app/api/demo/route.js ──────────────────────────
function todayPeriodKeys(year, month) {
  const py = month === 1 ? year - 1 : year
  const pm = month === 1 ? 12 : month - 1
  return {
    current:  `${year}-${pad(month)}`,
    previous: `${py}-${pad(pm)}`,
    q2:       `${year}-04-01_${year}-06-30`,
  }
}

function shiftDateString(str, months) {
  if (!str || months === 0) return str
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})([ T].*)?$/)
  if (!m) return str
  const [, y, mo, d, tail] = m
  const targetDay = Number(d)
  const dt = new Date(Number(y), Number(mo) - 1, 1)
  dt.setMonth(dt.getMonth() + months)
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()
  dt.setDate(Math.min(targetDay, lastDay))
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}${tail || ''}`
}

const DATE_FIELDS = new Set(['date', 'lastMeeting', 'created_at', 'meetingDate', 'scheduledAt'])

function shiftDates(node, months, post) {
  if (node == null) return node
  if (Array.isArray(node)) return node.map(v => shiftDates(v, months, post))
  if (typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (DATE_FIELDS.has(k) && typeof v === 'string' && v) {
        let x = shiftDateString(v, months)
        if (post) x = post(x)
        out[k] = x
      } else {
        out[k] = shiftDates(v, months, post)
      }
    }
    return out
  }
  return node
}

/** אופסטים לכל תקופה — q2 זז בשנים שלמות בלבד. */
function periodOffsets(baseYear, baseMonth, year, month) {
  return {
    current:  (year - baseYear) * 12 + (month - baseMonth),
    previous: (year - baseYear) * 12 + (month - baseMonth),
    q2:       (year - baseYear) * 12,
  }
}

function remapCurrentDay(str, spanDays, today) {
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})([ T].*)?$/)
  if (!m) return str
  const [, y, mo, d, tail] = m
  const mapped = Math.max(1, Math.min(today, Math.round((Number(d) * today) / Math.max(1, spanDays))))
  return `${y}-${mo}-${pad(mapped)}${tail || ''}`
}

// ── עזרי בדיקה ──────────────────────────────────────────────────────────────

/** אוסף כל המספרים במבנה, לפי סדר עקבי — לצורך השוואת "המספרים לא זזו". */
function collectNumbers(node, out = []) {
  if (typeof node === 'number') { out.push(node); return out }
  if (Array.isArray(node)) { for (const v of node) collectNumbers(v, out); return out }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node).sort()) collectNumbers(node[k], out)
  }
  return out
}

/** אוסף כל מחרוזות התאריך שהוזזו. */
function collectDates(node, out = []) {
  if (Array.isArray(node)) { for (const v of node) collectDates(v, out); return out }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (DATE_FIELDS.has(k) && typeof v === 'string' && v) out.push(v)
      else collectDates(v, out)
    }
  }
  return out
}

const errors = []
const fail = (m) => errors.push(m)

// ── ההרצה ───────────────────────────────────────────────────────────────────

const dataset = synthesize(PROFILE)
const [baseYear, baseMonth] = dataset.meta.baseMonth.split('-').map(Number)
const baseNumbers = collectNumbers(dataset.reports)

console.log('\n═══ סימולציית seed על פני 24 חודשים ═══\n')
console.log(`חודש בסיס של הדאטהסט: ${dataset.meta.baseMonth}`)
console.log(`מפתחות בדאטהסט:       ${Object.values(dataset.meta.periodKeys).join(' · ')}\n`)

let simYear = baseYear, simMonth = baseMonth

for (let step = 0; step < 24; step++) {
  const todayKeys = todayPeriodKeys(simYear, simMonth)
  const offsets = periodOffsets(baseYear, baseMonth, simYear, simMonth)

  const keyMap = {
    [dataset.meta.periodKeys.current]:  { month: todayKeys.current,  period: 'current'  },
    [dataset.meta.periodKeys.previous]: { month: todayKeys.previous, period: 'previous' },
    [dataset.meta.periodKeys.q2]:       { month: todayKeys.q2,       period: 'q2'       },
  }

  // כתיבה מדומה — היום בחודש נבחר כדי לכסות גם תחילת חודש וגם סופו
  const simDay = [3, 11, 26, 28][step % 4]
  const writtenKeys = new Set()
  const shiftedReports = []
  for (const r of dataset.reports) {
    const target = keyMap[r.month]
    if (!target) { fail(`[${simYear}-${pad(simMonth)}] אין מיפוי למפתח ${r.month}`); continue }
    const off = offsets[target.period]
    const post = target.period === 'current'
      ? (x) => remapCurrentDay(x, dataset.meta.currentSpanDays, simDay)
      : null
    writtenKeys.add(`${target.month}|${r.source}`)
    shiftedReports.push({ ...r, month: target.month, data: shiftDates(r.data, off, post), summary: shiftDates(r.summary, off, post) })
  }

  // 1. כל 9 הצירופים שהדשבורד יחפש קיימים
  for (const key of Object.values(todayKeys)) {
    for (const src of ['crm', 'facebook', 'google']) {
      if (!writtenKeys.has(`${key}|${src}`)) fail(`[${simYear}-${pad(simMonth)}] חסר ${key}/${src}`)
    }
  }

  // 2. המספרים לא זזו
  const nums = collectNumbers(shiftedReports)
  if (nums.length !== baseNumbers.length) {
    fail(`[${simYear}-${pad(simMonth)}] מספר הערכים המספריים השתנה (${nums.length} מול ${baseNumbers.length})`)
  } else {
    for (let i = 0; i < nums.length; i++) {
      if (nums[i] !== baseNumbers[i]) {
        fail(`[${simYear}-${pad(simMonth)}] מספר השתנה באינדקס ${i}: ${baseNumbers[i]} → ${nums[i]}`)
        break
      }
    }
  }

  // 3. תאריכים נופלים בתוך התקופה שלהם
  for (const r of shiftedReports) {
    if (r.source !== 'crm') continue
    const dates = collectDates(r.summary).map(d => d.slice(0, 10)).filter(Boolean)
    if (!dates.length) continue
    let lo, hi
    if (r.month.includes('_')) {
      ;[lo, hi] = r.month.split('_')
    } else {
      lo = `${r.month}-01`
      const [yy, mm] = r.month.split('-').map(Number)
      // התקופה הנוכחית לא יכולה להכיל תאריך עתידי — הגבול העליון הוא היום
      const isCurrent = r.month === todayKeys.current
      hi = isCurrent ? `${r.month}-${pad(simDay)}` : `${r.month}-${pad(new Date(yy, mm, 0).getDate())}`
    }
    const out = dates.filter(d => d < lo || d > hi)
    if (out.length) {
      fail(`[${simYear}-${pad(simMonth)}] ${r.month}: ${out.length} תאריכים מחוץ לתקופה (למשל ${out[0]}, טווח ${lo}..${hi})`)
    }
  }

  if (step < 3 || step === 12 || step === 23) {
    console.log(`  ${simYear}-${pad(simMonth)}-${pad(simDay)}  offsets(cur/q2)=${offsets.current}/${offsets.q2}  →  ${Object.values(todayKeys).join(' · ')}`)
  } else if (step === 3) {
    console.log('  …')
  }

  simMonth++
  if (simMonth > 12) { simMonth = 1; simYear++ }
}

if (errors.length) {
  console.log(`\n❌ ${errors.length} כשלים:`)
  errors.slice(0, 25).forEach(e => console.log('   · ' + e))
  if (errors.length > 25) console.log(`   … ועוד ${errors.length - 25}`)
  console.log()
  process.exit(1)
}

console.log('\n✅ 24/24 חודשים: כל 9 הדוחות נכתבים תחת המפתחות הנכונים,')
console.log('   כל המספרים זהים בדיוק, וכל התאריכים נופלים בתוך התקופה שלהם.\n')
