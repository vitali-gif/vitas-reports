/**
 * scripts/demo/verify-dataset.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * שני שוטרים על הדאטהסט לפני שהוא נכנס ל-DB:
 *
 *  1. סורק דליפות — מחפש כל שריד של נתון אמיתי (שם לקוח, שם פרויקט, מספרי
 *     טלפון ישראליים אמיתיים, כתובות CDN של Meta/Google, מזהי נכסים).
 *  2. בודק אילוצי שלמות — 11 האילוצים מ-§4.4 באפיון. כשל באחד מהם אומר
 *     שהדשבורד יציג מספרים שסותרים זה את זה (למשל כרטיס שמראה 143 ומודאל
 *     שפותח 138 שמות).
 *
 * שימוש:  node scripts/demo/verify-dataset.mjs
 * יציאה:  0 = תקין · 1 = נמצאו בעיות
 */

import { PROFILE } from './profile.mjs'
import { synthesize } from './synthesize.mjs'
import { DEMO, SALESPEOPLE, CITIES, OBJECTIONS, MEETING_NOTES, FIRST_NAMES, LAST_NAMES } from './dictionaries.mjs'

const errors = []
const warns  = []
const fail = (m) => errors.push(m)
const warn = (m) => warns.push(m)

// ═══════════════════════════════════════════════════════════════════════════
// 1. סורק דליפות
// ═══════════════════════════════════════════════════════════════════════════

/** מונחים שאסור שיופיעו בדאטהסט בשום צורה. */
const FORBIDDEN_TERMS = [
  // לקוחות ופרויקטים אמיתיים
  'ש.ברוך', 'ש. ברוך', 'שברוך', 'baruch', 'sbaruch',
  'once', 'hi park', 'hipark', 'rehavia', 'רחביה', 'הי פארק', 'הייפארק',
  'bcurelaser', 'בקיור', 'kloss', 'ismooth', 'אריקה כרמל',
  // מקורות אמיתיים שאסור שישרדו
  'yad2', 'יד2', 'madlan', 'מדלן',
]

/** דפוסים שמעידים על נתון אמיתי ששרד. */
const FORBIDDEN_PATTERNS = [
  { re: /https?:\/\/[^"'\s]*(fbcdn|cdninstagram|googleusercontent|ggpht|ytimg)[^"'\s]*/i,
    why: 'כתובת CDN של Meta/Google — נכס קריאייטיב אמיתי' },
  { re: /https?:\/\/(?!\/)[^"'\s]*\.(com|net|co\.il)[^"'\s]*/i,
    why: 'כתובת חיצונית — בדמו כל הנכסים חייבים להיות מקומיים (/demo/...)' },
  { re: /\b(act_)?\d{15,17}\b/,
    why: 'מזהה מספרי באורך של Meta ad/campaign/account id' },
  { re: /\b\d{3}-\d{3}-\d{4}\b/,
    why: 'פורמט customer id של Google Ads' },
]

/**
 * טלפון "אמיתי" = נייד ישראלי שאינו בתוך בלוק הדמו 05X-0000XXX.
 * זה הבדיקה הקריטית ביותר — שדה completedMeetings[].phone.
 */
const REAL_PHONE_RE = /\b0(5\d|7\d)-?(?!0000)\d{7}\b/

function scanForLeaks(node, path, out) {
  if (node == null) return
  if (typeof node === 'string') {
    const low = node.toLowerCase()
    for (const t of FORBIDDEN_TERMS) {
      if (low.includes(t.toLowerCase())) out.push({ path, why: `מונח אסור: "${t}"`, value: node.slice(0, 120) })
    }
    for (const { re, why } of FORBIDDEN_PATTERNS) {
      if (re.test(node)) out.push({ path, why, value: node.slice(0, 120) })
    }
    if (REAL_PHONE_RE.test(node)) {
      out.push({ path, why: 'מספר טלפון ישראלי מחוץ לבלוק הדמו', value: node.slice(0, 120) })
    }
    return
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => scanForLeaks(v, `${path}[${i}]`, out))
    return
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      scanForLeaks(k, `${path}.<key>`, out)          // גם מפתחות — sources/byUser ממופתחים בשמות
      scanForLeaks(v, `${path}.${k}`, out)
    }
  }
}

/**
 * בדיקת מקור חיובית: כל מחרוזת "זהותית" בדאטהסט חייבת להגיע מהמאגרים.
 * זו הבדיקה החזקה יותר — היא תופסת גם דליפה שלא חשבנו עליה מראש.
 */
function buildAllowedVocabulary() {
  const names = new Set()
  for (const f of FIRST_NAMES) for (const l of LAST_NAMES) names.add(`${f} ${l}`)
  return {
    leadNames: names,
    salespeople: new Set(SALESPEOPLE),
    cities: new Set(CITIES),
    objections: new Set(OBJECTIONS.concat([''])),
    notes: new Set(MEETING_NOTES),
  }
}

function checkVocabulary(dataset) {
  const vocab = buildAllowedVocabulary()
  for (const r of dataset.reports) {
    if (r.source !== 'crm') continue
    const s = r.summary
    const at = (what) => `[${r.month}] ${what}`

    for (const u of Object.keys(s.responseTimeStats.byUser || {})) {
      if (!vocab.salespeople.has(u)) fail(at(`איש מכירות לא מהמאגר: "${u}"`))
    }
    for (const row of s.crmRepRows) {
      if (!vocab.cities.has(row.address)) fail(at(`עיר לא מהמאגר: "${row.address}"`))
      if (!vocab.objections.has(row.objections)) fail(at(`התנגדות לא מהמאגר: "${row.objections}"`))
    }
    for (const m of s.completedMeetings) {
      if (!vocab.leadNames.has(m.name)) fail(at(`שם ליד לא מהמאגר: "${m.name}"`))
      if (!vocab.notes.has(m.description)) fail(at(`תיאור פגישה לא מהמאגר`))
      if (!/^05[024]-0000\d{3}$/.test(m.phone)) fail(at(`טלפון מחוץ לבלוק הדמו: "${m.phone}"`))
    }
    for (const g of Object.values(s.namedLeads)) {
      for (const n of g.allLeads) {
        if (!vocab.leadNames.has(n)) fail(at(`שם ליד לא מהמאגר: "${n}"`))
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. אילוצי שלמות (§4.4 באפיון)
// ═══════════════════════════════════════════════════════════════════════════

const sum = (arr) => arr.reduce((a, b) => a + b, 0)

function checkCrmIntegrity(r) {
  const s = r.summary
  const at = (m) => `[${r.month}/crm] ${m}`

  // 1. Σ data[] == totals
  const METRICS = ['totalLeads', 'meetingsScheduled', 'meetingsCompleted', 'meetingsCancelled',
                   'registrations', 'registrationValue', 'contracts', 'contractValue']
  for (const m of METRICS) {
    const rowSum = sum(r.data.map(d => d[m] || 0))
    if (rowSum !== (s[m] || 0)) fail(at(`אילוץ 1: Σ data[].${m}=${rowSum} ≠ summary.${m}=${s[m]}`))
  }
  const relSum = sum(r.data.map(d => d.relevantLeads))
  if (relSum !== s.relevantLeads) fail(at(`אילוץ 1: Σ relevantLeads=${relSum} ≠ ${s.relevantLeads}`))

  // 2. relevant + nonRelevant == total
  if (s.relevantLeads + s.nonRelevantLeads !== s.totalLeads) {
    fail(at(`אילוץ 2: ${s.relevantLeads}+${s.nonRelevantLeads} ≠ ${s.totalLeads}`))
  }
  if (s.irrelevantLeads !== s.nonRelevantLeads) fail(at('אילוץ 2: irrelevantLeads ≠ nonRelevantLeads'))

  // 3. completed ≤ scheduled ≤ totalLeads
  if (!(s.meetingsCompleted <= s.meetingsScheduled)) fail(at(`אילוץ 3: בוצעו(${s.meetingsCompleted}) > תואמו(${s.meetingsScheduled})`))
  if (!(s.meetingsScheduled <= s.totalLeads)) fail(at(`אילוץ 3: תואמו(${s.meetingsScheduled}) > לידים(${s.totalLeads})`))

  // 4. contracts ≤ registrations
  if (!(s.contracts <= s.registrations)) fail(at(`אילוץ 4: חוזים(${s.contracts}) > הרשמות(${s.registrations})`))

  // 5. התפלגויות מסתכמות ל-totalLeads
  const dowLeads = sum(Object.values(s.dayOfWeekStats).map(d => d.leads))
  if (dowLeads !== s.totalLeads) fail(at(`אילוץ 5: Σ dayOfWeek.leads=${dowLeads} ≠ ${s.totalLeads}`))
  const hourLeads = sum(Object.values(s.hourlyLeadStats))
  if (hourLeads !== s.totalLeads) fail(at(`אילוץ 5: Σ hourlyLeadStats=${hourLeads} ≠ ${s.totalLeads}`))
  const dowSched = sum(Object.values(s.dayOfWeekStats).map(d => d.scheduled))
  if (dowSched !== s.meetingsScheduled) fail(at(`אילוץ 5: Σ dayOfWeek.scheduled=${dowSched} ≠ ${s.meetingsScheduled}`))
  const hourAppt = sum(Object.values(s.hourlyApptStats))
  if (hourAppt !== s.meetingsScheduled) fail(at(`אילוץ 5: Σ hourlyApptStats=${hourAppt} ≠ ${s.meetingsScheduled}`))

  // 6. מודאל השמות תואם לכרטיס
  const na = s.namedLeads.all
  if (na.allLeads.length !== s.totalLeads) fail(at(`אילוץ 6: מודאל לידים=${na.allLeads.length} ≠ כרטיס=${s.totalLeads}`))
  if (na.meetingsScheduled.length !== s.meetingsScheduled) fail(at(`אילוץ 6: מודאל פגישות תואמו=${na.meetingsScheduled.length} ≠ ${s.meetingsScheduled}`))
  if (na.meetingsCompleted.length !== s.meetingsCompleted) fail(at(`אילוץ 6: מודאל פגישות בוצעו=${na.meetingsCompleted.length} ≠ ${s.meetingsCompleted}`))
  if (na.registrations.length !== s.registrations) fail(at(`אילוץ 6: מודאל הרשמות=${na.registrations.length} ≠ ${s.registrations}`))
  if (na.contracts.length !== s.contracts) fail(at(`אילוץ 6: מודאל חוזים=${na.contracts.length} ≠ ${s.contracts}`))

  // 7. תתי-קבוצות מוכלות ב-all
  const allSet = new Set(na.allLeads)
  for (const key of ['facebook', 'google']) {
    for (const n of s.namedLeads[key].allLeads) {
      if (!allSet.has(n)) { fail(at(`אילוץ 7: "${n}" ב-${key} אך לא ב-all`)); break }
    }
  }
  // ואין כפילות שמות (שובר את המודאל)
  if (allSet.size !== na.allLeads.length) fail(at(`אילוץ 7: שמות כפולים במודאל (${na.allLeads.length - allSet.size} כפילויות)`))

  // 8. completedMeetings תואם לכרטיס
  if (s.completedMeetings.length !== s.meetingsCompleted) {
    fail(at(`אילוץ 8: completedMeetings=${s.completedMeetings.length} ≠ ${s.meetingsCompleted}`))
  }

  // 9. Σ byUser.count == respondedCount
  const rt = s.responseTimeStats
  const byUserCount = sum(Object.values(rt.byUser).map(v => v.count))
  if (byUserCount !== rt.respondedCount) fail(at(`אילוץ 9: Σ byUser.count=${byUserCount} ≠ respondedCount=${rt.respondedCount}`))
  const bucketCount = sum(Object.values(rt.buckets))
  if (bucketCount !== rt.respondedCount) fail(at(`אילוץ 9: Σ buckets=${bucketCount} ≠ ${rt.respondedCount}`))
  if (rt.totalLids !== s.totalLeads) fail(at(`אילוץ 9: totalLids=${rt.totalLids} ≠ ${s.totalLeads}`))
  if (rt.respondedCount + rt.noResponseCount !== rt.totalLids) fail(at('אילוץ 9: responded+noResponse ≠ totalLids'))

  // 11 (חלקי). crmRepRows = שורה לכל ליד
  if (s.crmRepRows.length !== s.totalLeads) {
    warn(at(`crmRepRows=${s.crmRepRows.length} ≠ totalLeads=${s.totalLeads} (מותר אם יש שורות חוזה-בלבד)`))
  }
  const contractRows = s.crmRepRows.filter(x => x.hasContract).length
  if (contractRows !== s.contracts) fail(at(`crmRepRows.hasContract=${contractRows} ≠ contracts=${s.contracts}`))

  // v14
  if (!Array.isArray(s.hourlyContactStats) || s.hourlyContactStats.length !== 24) {
    fail(at('v14: hourlyContactStats חייב להיות מערך באורך 24 (admin/page.js בודק Array.isArray)'))
  }
  if (!Array.isArray(s.hourlyContactMeeting) || s.hourlyContactMeeting.length !== 24) {
    fail(at('v14: hourlyContactMeeting חייב להיות מערך באורך 24'))
  }
  if (Array.isArray(s.hourlyContactStats)) {
    const cSum = sum(s.hourlyContactStats)
    if (cSum !== rt.respondedCount) fail(at(`v14: Σ hourlyContactStats=${cSum} ≠ respondedCount=${rt.respondedCount}`))
    for (let h = 0; h < 24; h++) {
      if ((s.hourlyContactMeeting[h] || 0) > (s.hourlyContactStats[h] || 0)) {
        fail(at(`v14: בשעה ${h} יש יותר פגישות מיצירות קשר — "% הבשלה" יעבור 100%`)); break
      }
    }
  }

  if (s.schemaVersion !== 14) fail(at(`schemaVersion=${s.schemaVersion} — צפוי 14`))
}

function checkAdsIntegrity(r) {
  const s = r.summary
  const at = (m) => `[${r.month}/${r.source}] ${m}`
  for (const m of ['spend', 'impressions', 'clicks', 'leads']) {
    const rowSum = sum(r.data.map(d => d[m] || 0))
    const diff = Math.abs(rowSum - s[m])
    const tol = m === 'spend' ? 1 : 0
    if (diff > tol) fail(at(`אילוץ 1: Σ data[].${m}=${rowSum} ≠ summary.${m}=${s[m]}`))
  }
  // אילוץ 10: מדדים נגזרים מחושבים, לא מועתקים
  const exp = (a, b, label) => {
    if (Math.abs(a - b) > 0.01) fail(at(`אילוץ 10: ${label} לא עקבי (${a.toFixed(3)} מול ${b.toFixed(3)})`))
  }
  if (s.leads > 0) exp(s.cpl, s.spend / s.leads, 'cpl')
  if (s.clicks > 0) exp(s.cpc, s.spend / s.clicks, 'cpc')
  if (s.impressions > 0) exp(s.ctr, (s.clicks / s.impressions) * 100, 'ctr')
  if (s.clicks > 0) exp(s.convRate, (s.leads / s.clicks) * 100, 'convRate')

  if (s.leads === 0) fail(at('0 לידים — הדמו ייראה שבור'))
  if (s.spend <= 0) fail(at('0 הוצאה'))
}

function checkCrossPeriod(dataset) {
  const byMonth = {}
  for (const r of dataset.reports) (byMonth[r.month] = byMonth[r.month] || {})[r.source] = r
  const k = dataset.meta.periodKeys

  for (const [label, key] of Object.entries(k)) {
    const g = byMonth[key]
    if (!g) { fail(`חסרה תקופה "${label}" (${key})`); continue }
    for (const src of ['crm', 'facebook', 'google']) {
      if (!g[src]) fail(`חסר מקור "${src}" לתקופה ${key}`)
    }
  }

  // אילוץ 11: Q2 חייב להיות גדול מחודש בודד (אחרת הנתונים לא סבירים)
  const q2  = byMonth[k.q2]?.crm?.summary
  const cur = byMonth[k.current]?.crm?.summary
  const prv = byMonth[k.previous]?.crm?.summary
  if (q2 && cur && prv) {
    if (q2.totalLeads <= Math.max(cur.totalLeads, prv.totalLeads)) {
      fail(`אילוץ 11: Q2 (${q2.totalLeads} לידים) לא גדול מחודש בודד — לא סביר`)
    }
    if (q2.totalLeads > (cur.totalLeads + prv.totalLeads) * 3) {
      warn(`אילוץ 11: Q2 גדול פי >3 מסך שני החודשים — לבדוק סבירות`)
    }
  }
}

function checkNarrative(dataset) {
  // בדיקות "האם זה נראה טוב בפגישת מכירה" — אזהרות בלבד, לא כשלים.
  for (const r of dataset.reports) {
    if (r.source === 'crm') continue
    const s = r.summary
    const cpl = s.cpl
    if (cpl < 40)  warn(`[${r.month}/${r.source}] CPL ₪${cpl.toFixed(0)} — נמוך מדי, ייראה לא אמין`)
    if (cpl > 600) warn(`[${r.month}/${r.source}] CPL ₪${cpl.toFixed(0)} — גבוה מדי לפרויקט נדל״ן`)
    if (s.ctr < 0.4) warn(`[${r.month}/${r.source}] CTR ${s.ctr.toFixed(2)}% — נמוך`)
    if (s.ctr > 6)   warn(`[${r.month}/${r.source}] CTR ${s.ctr.toFixed(2)}% — גבוה באופן חשוד`)
  }
  // מגמה: החודש הנוכחי צריך להיראות טוב יותר מהקודם
  const k = dataset.meta.periodKeys
  const cur = dataset.reports.find(r => r.month === k.current && r.source === 'crm')?.summary
  const prv = dataset.reports.find(r => r.month === k.previous && r.source === 'crm')?.summary
  if (cur && prv) {
    const cr = (s) => s.totalLeads ? s.meetingsScheduled / s.totalLeads : 0
    if (cr(cur) < cr(prv)) {
      warn(`מגמה: יחס תיאום פגישות ירד מ-${(cr(prv) * 100).toFixed(1)}% ל-${(cr(cur) * 100).toFixed(1)}% — שקול לשפר לנרטיב מכירתי`)
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// הרצה
// ═══════════════════════════════════════════════════════════════════════════

const dataset = synthesize(PROFILE)

const leaks = []
scanForLeaks(dataset, '$', leaks)
for (const l of leaks) fail(`דליפה ב-${l.path}: ${l.why} → ${l.value}`)

checkVocabulary(dataset)
for (const r of dataset.reports) {
  if (r.source === 'crm') checkCrmIntegrity(r)
  else checkAdsIntegrity(r)
}
checkCrossPeriod(dataset)
checkNarrative(dataset)

// ── דוח ─────────────────────────────────────────────────────────────────────
console.log('\n═══ בדיקת דאטהסט הדמו ═══\n')
console.log(`לקוח:    ${dataset.meta.client}`)
console.log(`פרויקט:  ${dataset.meta.project}`)
console.log(`תקופות:  ${Object.values(dataset.meta.periodKeys).join(' · ')}`)
console.log(`רשומות:  ${dataset.reports.length}\n`)

const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)}ש׳ ${m % 60}ד׳` : `${m}ד׳`

for (const r of dataset.reports.filter(x => x.source === 'crm')) {
  const s = r.summary
  const rt = s.responseTimeStats
  console.log(`  CRM ${r.month.padEnd(24)} ${String(s.totalLeads).padStart(4)} לידים · ` +
              `${String(s.meetingsScheduled).padStart(3)} פגישות תואמו · ` +
              `${String(s.meetingsCompleted).padStart(3)} בוצעו · ` +
              `${String(s.registrations).padStart(2)} הרשמות · ${String(s.contracts).padStart(2)} חוזים ` +
              `(₪${(s.contractValue / 1e6).toFixed(1)}M)`)
  console.log(`      זמן מענה: רציף ${fmtMin(rt.avgMinutes)} · שעות עסקים ${fmtMin(rt.business.avgMinutes)} · חציון ${fmtMin(rt.medianMinutes)}`)
}
console.log()
for (const r of dataset.reports.filter(x => x.source !== 'crm')) {
  const s = r.summary
  console.log(`  ${r.source.padEnd(9)} ${r.month.padEnd(24)} ₪${String(Math.round(s.spend)).padStart(6)} · ` +
              `${String(s.leads).padStart(3)} לידים · CPL ₪${s.cpl.toFixed(0)} · CTR ${s.ctr.toFixed(2)}%`)
}

if (warns.length) {
  console.log(`\n⚠️  ${warns.length} אזהרות:`)
  warns.forEach(w => console.log('   · ' + w))
}

if (errors.length) {
  console.log(`\n❌ ${errors.length} כשלים:`)
  errors.forEach(e => console.log('   · ' + e))
  console.log()
  process.exit(1)
}

console.log('\n✅ כל הבדיקות עברו — אין דליפות, כל אילוצי השלמות מתקיימים.\n')
