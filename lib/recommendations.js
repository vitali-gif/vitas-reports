// Smart Recommendations Engine — Phase 3: Style C (decisive, shekel-quantified) + Geographic Waste.
// Each recommendation has a `role` field:
//   - 'agency'           → 🎨 משרד פרסום (creatives, copy, photo days)
//   - 'campaign_manager' → 📊 מנהל קמפיינים (budget, targeting, mix)
//   - 'marketing_manager'→ 🧭 מנהל שיווק (vendors, sales team oversight)
//   - 'salesperson'      → 📞 איש מכירות (lead handling, objections)
//
// Each rec also has:
//   - `dedupKey` — stable identifier for "is this the same recommendation we saw last week?"
//                  used by vitas_tasks.recommendation_key + impact verification (Stage 5).

const BUCKET_LABELS = {
  '0-15m': 'פחות מ-15 דקות',
  '15m-1h': '15 דקות עד שעה',
  '1h-4h': '1-4 שעות',
  '4h-8h': '4-8 שעות',
  '8h-1d': '8-24 שעות',
  '1d-3d': '1-3 ימים',
  '3d+': 'יותר מ-3 ימים',
}
const BUCKET_KEYS_ORDERED = Object.keys(BUCKET_LABELS)

export const ROLE_META = {
  agency:            { label: 'משרד הפרסום',  icon: '🎨', color: '#ec4899', desc: 'גרפיקות, קריאטיב, ימי צילום' },
  campaign_manager:  { label: 'מנהל קמפיינים', icon: '📊', color: '#3b82f6', desc: 'תקציבים, טירגוט, חלוקת מקורות' },
  marketing_manager: { label: 'מנהל שיווק',   icon: '🧭', color: '#10b981', desc: 'ספקים, אנשי מכירות, אסטרטגיה' },
  salesperson:       { label: 'איש מכירות',   icon: '📞', color: '#f59e0b', desc: 'טיפול בלידים, התנגדויות, פגישות' },
}
export const ROLE_ORDER = ['agency', 'campaign_manager', 'marketing_manager', 'salesperson']

// ---------- Helpers ----------

function percentDiff(better, baseline) {
  if (!baseline) return ''
  return Math.round(((better - baseline) / baseline) * 100)
}

function fmtMinutes(mn) {
  if (mn < 60) return `${Math.round(mn)} דקות`
  const h = Math.floor(mn / 60); const m = Math.round(mn % 60)
  if (h < 24) return m > 0 ? `${h}:${String(m).padStart(2,'0')} שעות` : `${h} שעות`
  const d = Math.floor(h / 24); const hr = h % 24
  return hr > 0 ? `${d} ימים ${hr} שעות` : `${d} ימים`
}

// Format shekels with thousands separator and ₪ sign. n=4250 → "4,250₪"
export function fmtShekels(n) {
  if (!Number.isFinite(n)) return '—'
  const rounded = Math.round(n)
  return rounded.toLocaleString('he-IL') + '₪'
}

// Build the canonical shekel-impact phrase used in Style C predictions.
// shekelImpactPhrase(5, 850) → "+5 פגישות, שווי ~4,250₪/חודש"
// shekelImpactPhrase(5, 0)   → "+5 פגישות" (no value when costPerMeeting unknown)
export function shekelImpactPhrase(extraMeetings, costPerMeeting) {
  if (!Number.isFinite(extraMeetings) || extraMeetings <= 0) return ''
  const sign = extraMeetings > 0 ? '+' : ''
  const meetingsPart = `${sign}${extraMeetings} פגישות`
  if (!Number.isFinite(costPerMeeting) || costPerMeeting <= 0) return meetingsPart
  const value = extraMeetings * costPerMeeting
  return `${meetingsPart}, שווי ~${fmtShekels(value)}/חודש`
}

// ---------- 📞 איש מכירות — Response time (Style C: "צוואר בקבוק") ----------

export function buildResponseTimeRec(bucketTotals, bucketWith, totalLids, costPerMeeting) {
  if (!totalLids || totalLids < 10) return null
  const buckets = BUCKET_KEYS_ORDERED.map(k => {
    const total = bucketTotals[k] || 0
    const wm = bucketWith[k] || 0
    return { key: k, label: BUCKET_LABELS[k], total, withMeeting: wm, conv: total > 0 ? (wm / total) * 100 : 0 }
  })
  const dominant = buckets.filter(b => b.total >= 8).sort((a, b) => b.total - a.total)[0]
  if (!dominant) return null
  const domIdx = BUCKET_KEYS_ORDERED.indexOf(dominant.key)
  const candidates = buckets
    .filter(b => b.total >= 4)
    .filter(b => BUCKET_KEYS_ORDERED.indexOf(b.key) < domIdx)
    .filter(b => b.conv >= dominant.conv * 1.25 && (b.conv - dominant.conv) >= 4)
    .sort((a, b) => b.conv - a.conv)
  const better = candidates[0]
  if (!better) return null
  const projectedMeetings = Math.round(dominant.total * (better.conv / 100))
  const lift = projectedMeetings - dominant.withMeeting
  if (lift < 2) return null
  const liftPct = percentDiff(better.conv, dominant.conv)
  const dominantShare = Math.round(dominant.total / totalLids * 100)
  const impactPhrase = shekelImpactPhrase(lift, costPerMeeting)
  return {
    role: 'salesperson',
    type: 'response_time',
    dedupKey: `bucket:${dominant.key}`,
    icon: '⏱️',
    title: 'זמן תגובה הוא הצוואר בקבוק',
    body: [
      `${dominantShare}% מהלידים שלך (${dominant.total} לידים) ממתינים ${dominant.label} — וההמרה שלהם לפגישה רק ${Math.round(dominant.conv)}%.`,
      `הלידים שטופלו ב-${better.label} המירו ב-${Math.round(better.conv)}% — גבוה ב-${liftPct}%. הפער ישיר וברור.`,
    ],
    suggestion: `קבע SLA פנימי של ${better.label} לכל ליד חדש. הוסף התראות נייד לאיש המכירות התורן.`,
    prediction: {
      label: 'תוספת צפויה לפגישות',
      value: impactPhrase || `+${lift} פגישות`,
      detail: `${projectedMeetings} פגישות במקום ${dominant.withMeeting} — אם תעבירו את הלידים מ-${dominant.label} ל-${better.label}`,
    },
    measure: [
      `זמן מענה ממוצע — האם ירד מ-"${dominant.label}" ל-"${better.label}"?`,
      `אחוז המרה לפגישה — האם עלה מ-${Math.round(dominant.conv)}% ל-${Math.round(better.conv)}%+?`,
    ],
    baseline: { metric: 'response_bucket', value: dominant.key, conv: dominant.conv, meetings: dominant.withMeeting, totalLids },
    target: { metric: 'response_bucket', value: better.key, conv: better.conv, meetings: projectedMeetings },
  }
}

// ---------- 📞 איש מכירות — Top objection (Style C: "התנגדות שחוזרת — תשובה שחסרה") ----------

export function buildObjectionRec(crmRepRows, costPerMeeting) {
  if (!Array.isArray(crmRepRows) || crmRepRows.length < 15) return null
  const counts = {}
  let totalWithObj = 0
  for (const row of crmRepRows) {
    const obj = (row.objections || '').trim()
    if (!obj) continue
    totalWithObj++
    obj.split(/[,;|]/).map(s => s.trim()).filter(Boolean).forEach(o => {
      counts[o] = (counts[o] || 0) + 1
    })
  }
  if (totalWithObj < 8) return null
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]
  if (!top) return null
  const [topObj, topCount] = top
  if (topCount < 5) return null
  const pct = Math.round((topCount / totalWithObj) * 100)
  if (pct < 25) return null
  // Assume ~30% of objection-blocked leads convert if we have a good answer
  const potentialMeetings = Math.round(topCount * 0.3)
  const impactPhrase = shekelImpactPhrase(potentialMeetings, costPerMeeting)
  return {
    role: 'salesperson',
    type: 'top_objection',
    dedupKey: `obj:${topObj}`,
    icon: '💬',
    title: `"${topObj}" — ההתנגדות שמפסידה לך לידים`,
    body: [
      `"${topObj}" הופיעה ב-${topCount} מתוך ${totalWithObj} לידים עם התנגדות מתועדת — ${pct}% מכלל ההתנגדויות.`,
      `אין מענה מובנה לזה היום. כל איש מכירות מאלתר תשובה שונה, וההמרה משתנה בהתאם.`,
    ],
    suggestion: `כתוב תסריט מענה אחיד ל-"${topObj}". העבר לכל הצוות. בעוד חודש בחן שיעור המרה ללידים עם ההתנגדות הזאת.`,
    prediction: {
      label: 'פוטנציאל אם נשפר את המענה',
      value: impactPhrase || `+${potentialMeetings} פגישות`,
      detail: `~${potentialMeetings} לידים נוספים יומרו (30% מ-${topCount} המושפעים)`,
    },
    measure: [
      `שיעור ההמרה של לידים שהביעו את ההתנגדות — האם עלה?`,
      `כמות הופעות ההתנגדות — צריכה לרדת אם הקריאטיב מטפל בה מראש.`,
    ],
    baseline: { metric: 'top_objection', value: topObj, count: topCount, share: pct, totalWithObj },
    target: { metric: 'top_objection_addressed', value: topObj, expectedExtraMeetings: potentialMeetings },
  }
}

// ---------- 📊 מנהל קמפיינים — Day of week (Style C: "יום זהב") ----------

export function buildDayOfWeekRec(dowMerged, totalLids, costPerMeeting) {
  if (!totalLids || totalLids < 10) return null
  const days = Object.values(dowMerged || {})
    .filter(d => d.leads >= 4)
    .map(d => ({ ...d, conv: d.leads > 0 ? (d.scheduled / d.leads) * 100 : 0 }))
  if (days.length < 3) return null
  const sorted = [...days].sort((a, b) => b.conv - a.conv)
  const best = sorted[0]
  const others = days.filter(d => d.name !== best.name)
  const avgOthers = others.reduce((s, d) => s + d.conv, 0) / others.length
  if (avgOthers <= 0) return null
  if (best.conv < avgOthers * 1.3 || (best.conv - avgOthers) < 4) return null
  const liftPct = percentDiff(best.conv, avgOthers)
  const projectedExtraMeetings = Math.round(best.scheduled)
  const impactPhrase = shekelImpactPhrase(projectedExtraMeetings, costPerMeeting)
  return {
    role: 'campaign_manager',
    type: 'day_of_week',
    dedupKey: `dow:${best.name}`,
    icon: '📅',
    title: `יום ${best.name} — יום הזהב של הקמפיין`,
    body: [
      `ביום ${best.name}: ${best.leads} לידים, ${best.scheduled} פגישות, המרה ${Math.round(best.conv)}%.`,
      `שאר הימים בממוצע ${Math.round(avgOthers)}%. ${best.name} ב-${liftPct}% מעל הממוצע — לא רעש, דפוס.`,
    ],
    suggestion: `העבר 25-30% מהתקציב היומי הממוצע לתאריכים שכוללים ${best.name}. הימים האחרים יקבלו פחות — מקובל.`,
    prediction: {
      label: 'תוספת אם נכפיל לידים ביום ' + best.name,
      value: impactPhrase || `+${projectedExtraMeetings} פגישות`,
      detail: `שמירה על המרה ${Math.round(best.conv)}% × הכפלת לידי ${best.name}`,
    },
    measure: [
      `כמות הלידים ביום ${best.name} — האם עלתה?`,
      `מספר הפגישות הכולל — האם עלה?`,
      `אחוז ההמרה ביום ${best.name} — נשמר על ${Math.round(best.conv)}%+?`,
    ],
    baseline: { metric: 'day_' + best.name, leads: best.leads, scheduled: best.scheduled, conv: best.conv, avgOthers },
    target: { metric: 'day_' + best.name + '_with_extra_budget', conv: best.conv, scheduledTarget: best.scheduled * 2 },
  }
}

// ---------- 📊 מנהל קמפיינים — City concentration (Style C: "עיר זהב") ----------

export function buildCityRec(crmRepRows, totalLids, costPerMeeting) {
  if (!Array.isArray(crmRepRows) || crmRepRows.length < 15) return null
  if (!totalLids || totalLids < 15) return null
  const cityCounts = {}
  for (const r of crmRepRows) {
    const c = (r.address || '').trim()
    if (!c) continue
    cityCounts[c] = (cityCounts[c] || 0) + 1
  }
  const sorted = Object.entries(cityCounts).sort((a,b)=>b[1]-a[1])
  if (sorted.length === 0) return null
  const [topCity, topCount] = sorted[0]
  const share = (topCount / crmRepRows.length) * 100
  if (share < 20 || topCount < 8) return null
  const avgRest = sorted.slice(1, 6).reduce((s, [,n]) => s+n, 0) / Math.min(5, Math.max(1, sorted.length - 1))
  // Projection: targeted campaign typically lifts city's volume ~30%, conversion stays the same
  const extraLeads = Math.round(topCount * 0.3)
  // No conv data per city in this branch; predict shekels via leads × project avg conv (~25% of all leads convert) — conservative
  const projectedExtraMeetings = Math.round(extraLeads * 0.25)
  const impactPhrase = shekelImpactPhrase(projectedExtraMeetings, costPerMeeting)
  return {
    role: 'campaign_manager',
    type: 'top_city',
    dedupKey: `city:${topCity}`,
    icon: '🏙️',
    title: `${topCity} — עיר הזהב של הפרויקט`,
    body: [
      `${topCount} מתוך ${crmRepRows.length} לידים מ-${topCity} — ${Math.round(share)}%. בשאר הערים ממוצע ${Math.round(avgRest)} לידים.`,
      `הקהל ב-${topCity} מצביע ברגליים. אין סיבה להמשיך לפזר תקציב לאזורים שלא מגיבים.`,
    ],
    suggestion: `פתח קמפיין/קבוצת מודעות נפרדת ל-${topCity}, עם קריאטיב גיאוגרפי (מרחק, יתרון לתושבי האזור). הקצה 20-30% מהתקציב אליה.`,
    prediction: {
      label: 'תוספת צפויה מ-' + topCity,
      value: impactPhrase || `+${projectedExtraMeetings} פגישות`,
      detail: `קמפיין גיאו-מטורגט בד"כ מוריד CPL ב-30%-50% ומעלה ווליום ב-30%`,
    },
    measure: [
      `כמות לידים מ-${topCity} — האם עלתה?`,
      `שיעור ההמרה מ-${topCity} — נשמר/עלה?`,
      `CPL בקמפיין המטורגט — נמוך יותר מהקמפיין הכללי?`,
    ],
    baseline: { metric: 'city_' + topCity, count: topCount, share, avgRest, totalLids: crmRepRows.length },
    target: { metric: 'city_' + topCity + '_with_targeted_campaign', share: share * 1.3, expectedExtraMeetings: projectedExtraMeetings },
  }
}

// ---------- 🌍 מנהל קמפיינים — Geographic Waste (Style C: "ערים ששורפות תקציב") ----------
// NEW: opposite of buildCityRec — finds cities with high lead volume but VERY low meeting conversion.

export function buildGeoWasteRec(crmRepRows, totalLids, totalSpend, costPerMeeting) {
  if (!Array.isArray(crmRepRows) || crmRepRows.length < 25) return null
  if (!totalLids || totalLids < 25) return null
  // Aggregate per city: leads + scheduled meetings (use row.scheduledAt presence as proxy)
  const byCity = {}
  for (const r of crmRepRows) {
    const c = (r.address || '').trim()
    if (!c) continue
    if (!byCity[c]) byCity[c] = { city: c, leads: 0, meetings: 0 }
    byCity[c].leads++
    if (r.scheduledAt || r.meetingScheduled || r.scheduled === true) byCity[c].meetings++
  }
  const cities = Object.values(byCity)
    .filter(c => c.leads >= 6)
    .map(c => ({ ...c, conv: c.leads > 0 ? (c.meetings / c.leads) * 100 : 0 }))
  if (cities.length < 3) return null
  const totalLeadsConsidered = cities.reduce((s, c) => s + c.leads, 0)
  const totalMeetingsConsidered = cities.reduce((s, c) => s + c.meetings, 0)
  const avgConv = totalLeadsConsidered > 0 ? (totalMeetingsConsidered / totalLeadsConsidered) * 100 : 0
  if (avgConv <= 0) return null
  // Worst city by conv with material volume
  const worst = [...cities].sort((a, b) => a.conv - b.conv)[0]
  if (!worst) return null
  // Qualify: worst must be meaningfully below average AND have enough volume to matter
  const convGap = avgConv - worst.conv
  if (worst.conv >= avgConv * 0.7 || convGap < 8) return null
  if (worst.leads < Math.max(6, totalLeadsConsidered * 0.08)) return null
  // Implied wasted spend: spend share proportional to lead share, but conversion only worst.conv vs avgConv
  // wastedSpend = (leadShare * totalSpend) * (1 - worst.conv/avgConv)
  const leadShare = worst.leads / totalLids
  const impliedSpend = (Number.isFinite(totalSpend) && totalSpend > 0) ? totalSpend * leadShare : 0
  const wastedSpend = impliedSpend > 0 ? impliedSpend * (1 - worst.conv / avgConv) : 0
  // If we redirect that wasted spend to cities at average conv:
  const recoveredMeetings = (Number.isFinite(costPerMeeting) && costPerMeeting > 0)
    ? Math.round(wastedSpend / costPerMeeting)
    : Math.max(1, Math.round(worst.leads * (avgConv - worst.conv) / 100))
  const impactPhrase = shekelImpactPhrase(recoveredMeetings, costPerMeeting)
  return {
    role: 'campaign_manager',
    type: 'geo_waste',
    dedupKey: `geo_waste:${worst.city}`,
    icon: '🚫',
    title: `${worst.city} שורפת תקציב — המרה ${Math.round(worst.conv)}% בלבד`,
    body: [
      `${worst.leads} לידים מ-${worst.city}, רק ${worst.meetings} פגישות — המרה ${Math.round(worst.conv)}%.`,
      `הממוצע בשאר הערים: ${Math.round(avgConv)}%. הפער: ${Math.round(convGap)} נקודות אחוז.`,
      impliedSpend > 0
        ? `מתוך התקציב, כ-${fmtShekels(impliedSpend)} מופנים ל-${worst.city}. כ-${fmtShekels(wastedSpend)} מהם לא מייצרים פגישות.`
        : `התקציב המוקצה לקהל הזה לא מייצר פגישות בשיעור סביר.`,
    ],
    suggestion: `הוצא את ${worst.city} מהטירגוט הכללי, או פתח קמפיין נפרד עם קריאטיב/מסר אחר. אם בעוד 30 יום הפער נשאר — הפסק לחלוטין.`,
    prediction: {
      label: 'תוספת אם נסיט את התקציב',
      value: impactPhrase || `+${recoveredMeetings} פגישות`,
      detail: impliedSpend > 0
        ? `~${fmtShekels(wastedSpend)} מופנים לערים בהמרה ממוצעת של ${Math.round(avgConv)}%`
        : `הסטת לידי ${worst.city} למקור בהמרה ממוצעת`,
    },
    measure: [
      `שיעור ההמרה מ-${worst.city} — האם השתפר אחרי שינוי הטירגוט/קריאטיב?`,
      `CPL ממוצע כולל — האם ירד אחרי הוצאת ${worst.city} מהטירגוט?`,
      `סך הפגישות באחוז ההמרה — האם עלה?`,
    ],
    baseline: { metric: 'geo_waste', city: worst.city, leads: worst.leads, meetings: worst.meetings, conv: worst.conv, avgConv, impliedSpend, wastedSpend },
    target: { metric: 'geo_waste_redirected', city: worst.city, targetConv: avgConv, expectedExtraMeetings: recoveredMeetings },
  }
}

// ---------- 🧭 מנהל שיווק — Salesperson speed gap (Style C: "פער שעולה לך פגישות") ----------

export function buildSalespersonSpeedRec(byUser, totalLids, costPerMeeting) {
  if (!byUser || typeof byUser !== 'object') return null
  const users = Object.entries(byUser)
    .map(([name, v]) => ({ name, count: v.count || 0, avgMinutes: v.avgMinutes || 0 }))
    .filter(u => u.count >= 5)
  if (users.length < 2) return null
  const sorted = [...users].sort((a,b) => a.avgMinutes - b.avgMinutes)
  const fastest = sorted[0]
  const slowest = sorted[sorted.length - 1]
  if (slowest.avgMinutes < 60) return null
  if (slowest.avgMinutes < fastest.avgMinutes * 3) return null
  if ((slowest.avgMinutes - fastest.avgMinutes) < 120) return null
  // Estimate: if slowest matched fastest, ~15% more leads would convert
  const projectedExtraMeetings = Math.max(1, Math.round(slowest.count * 0.15))
  const impactPhrase = shekelImpactPhrase(projectedExtraMeetings, costPerMeeting)
  const ratio = Math.round(slowest.avgMinutes / Math.max(1, fastest.avgMinutes))
  return {
    role: 'marketing_manager',
    type: 'salesperson_speed_gap',
    dedupKey: `salesperson_gap:${slowest.name}`,
    icon: '🧑‍💼',
    title: `פער זמן תגובה ש-${slowest.name} משלם עליו בפגישות`,
    body: [
      `${fastest.name}: ${fmtMinutes(fastest.avgMinutes)} בממוצע ל-${fastest.count} לידים.`,
      `${slowest.name}: ${fmtMinutes(slowest.avgMinutes)} ל-${slowest.count} לידים — פי ${ratio} יותר.`,
      `לידים ש"מתקררים" שעות אחרי הטופס מתפנים פחות לפגישה. זה לא בעיית מוטיבציה — זו בעיית תהליך.`,
    ],
    suggestion: `שיחה אישית עם ${slowest.name}. בדוק עומס לידים, התראות נייד, וחלוקת תורנויות. אם זה לא משתפר ב-30 יום — שקול חלוקה מחדש.`,
    prediction: {
      label: 'פוטנציאל אם הפער ייסגר',
      value: impactPhrase || `+${projectedExtraMeetings} פגישות`,
      detail: `~15% מ-${slowest.count} הלידים של ${slowest.name} צפויים להמיר אם זמן המענה ייסגר לרמת ${fastest.name}`,
    },
    measure: [
      `זמן התגובה הממוצע של ${slowest.name} — האם ירד?`,
      `שיעור ההמרה של לידים של ${slowest.name} — האם עלה?`,
      `הפער בין הצוות — הצטמצם?`,
    ],
    baseline: { metric: 'salesperson_gap', fastest: fastest.name, fastestMin: fastest.avgMinutes, slowest: slowest.name, slowestMin: slowest.avgMinutes, slowestCount: slowest.count },
    target: { metric: 'salesperson_gap_closed', maxAvg: fastest.avgMinutes * 2, expectedExtraMeetings: projectedExtraMeetings },
  }
}

// ---------- 🧭 מנהל שיווק — Irrelevant source (Style C: "מקור ששורף תקציב") ----------

export function buildIrrelevantSourceRec(sources, totalSpend, costPerMeeting) {
  if (!sources || typeof sources !== 'object') return null
  const sourceList = Object.entries(sources)
    .map(([name, s]) => ({
      name,
      leads: s.totalLeads || 0,
      irrelevant: s.nonRelevantLeads || 0,
      rate: (s.totalLeads||0) > 0 ? ((s.nonRelevantLeads||0) / (s.totalLeads||0)) * 100 : 0,
    }))
    .filter(s => s.leads >= 10)
  if (sourceList.length < 2) return null
  const totalLeads = sourceList.reduce((sum, s) => sum + s.leads, 0)
  const totalIrr   = sourceList.reduce((sum, s) => sum + s.irrelevant, 0)
  const avgRate    = totalLeads > 0 ? (totalIrr / totalLeads) * 100 : 0
  if (avgRate <= 0) return null
  const worst = [...sourceList].sort((a,b) => b.rate - a.rate)[0]
  if (worst.rate < avgRate * 1.5 || (worst.rate - avgRate) < 10) return null
  // Implied wasted spend on this source's irrelevant leads
  const sourceLeadShare = worst.leads / totalLeads
  const impliedSpend = (Number.isFinite(totalSpend) && totalSpend > 0) ? totalSpend * sourceLeadShare : 0
  const irrelevantShare = worst.irrelevant / worst.leads
  const wastedSpend = impliedSpend * irrelevantShare
  const recoveredMeetings = (Number.isFinite(costPerMeeting) && costPerMeeting > 0)
    ? Math.round(wastedSpend / costPerMeeting)
    : Math.max(1, Math.round(worst.irrelevant * 0.2))
  const impactPhrase = shekelImpactPhrase(recoveredMeetings, costPerMeeting)
  return {
    role: 'marketing_manager',
    type: 'irrelevant_source',
    dedupKey: `source_irrelevant:${worst.name}`,
    icon: '⚠️',
    title: `"${worst.name}" — מקור ששורף תקציב`,
    body: [
      `${worst.irrelevant} מתוך ${worst.leads} לידים מ-"${worst.name}" סומנו לא רלוונטיים — ${Math.round(worst.rate)}%.`,
      `הממוצע במקורות האחרים: ${Math.round(avgRate)}%. הפער: ${Math.round(worst.rate - avgRate)} נקודות אחוז.`,
      impliedSpend > 0
        ? `מתוך התקציב, כ-${fmtShekels(impliedSpend)} מופנים ל-"${worst.name}". כ-${fmtShekels(wastedSpend)} מהם לא מייצרים לידים איכותיים.`
        : `התקציב על המקור הזה הולך ללידים לא איכותיים בקצב גבוה משמעותית מהאחרים.`,
    ],
    suggestion: `בדוק קריאטיב, טירגוט, ושאלות הטופס של "${worst.name}". אם 14 יום של חידוד לא משפר — הסט את התקציב למקור עם איכות סבירה.`,
    prediction: {
      label: 'תקציב משוחרר ללידים איכותיים',
      value: impactPhrase || `~${recoveredMeetings} פגישות`,
      detail: impliedSpend > 0
        ? `הסטת ${fmtShekels(wastedSpend)} למקור איכותי`
        : `הפסקת המקור או חידוד טירגוט`,
    },
    measure: [
      `שיעור הלא רלוונטיים ב-"${worst.name}" — האם ירד?`,
      `CPL מותאם (תקציב/לידים רלוונטיים) — האם השתפר?`,
      `אחוז הלידים שהמירו לפגישה ממקור זה — האם עלה?`,
    ],
    baseline: { metric: 'irrelevant_rate', source: worst.name, rate: worst.rate, avg: avgRate, leads: worst.leads, irrelevant: worst.irrelevant, impliedSpend, wastedSpend },
    target: { metric: 'irrelevant_rate_reduced', source: worst.name, targetRate: avgRate, expectedExtraMeetings: recoveredMeetings },
  }
}

// ---------- 🎨 משרד הפרסום — Creative performance (Style C: "מנצח לשבט, מבוזבז להפסיק") ----------

export function buildCreativeRec(fbRows, googRows, costPerMeeting, activeAdsByName) {
  const rows = [...(fbRows || []), ...(googRows || [])]
    .map(r => ({
      adName: (r.adName || '').trim() || (r.campaign || '').trim(),
      campaign: (r.campaign || '').trim(),
      spend: Number(r.spend) || 0,
      leads: Number(r.leads) || 0,
      clicks: Number(r.clicks) || 0,
    }))
    .filter(r => r.adName && r.spend >= 50)
    // Drop ads that aren't currently active. activeAdsByName is a lookup populated
    // from r.summary.activeAds (only effective_status=ACTIVE ads). If the lookup is
    // not provided (e.g. legacy call), we don't filter — fall back to old behavior.
    .filter(r => !activeAdsByName || Object.keys(activeAdsByName).length === 0 || !!activeAdsByName[r.adName])
  if (rows.length < 3) return null
  const byAd = {}
  for (const r of rows) {
    if (!byAd[r.adName]) byAd[r.adName] = { adName: r.adName, campaign: r.campaign, spend: 0, leads: 0, clicks: 0 }
    byAd[r.adName].spend += r.spend
    byAd[r.adName].leads += r.leads
    byAd[r.adName].clicks += r.clicks
  }
  const ads = Object.values(byAd).map(a => ({
    ...a,
    cpl: a.leads > 0 ? a.spend / a.leads : Infinity,
  })).filter(a => a.spend >= 100)
  if (ads.length < 3) return null
  const withLeads = ads.filter(a => a.leads > 0)
  if (withLeads.length < 2) return null
  const totalSpend = withLeads.reduce((s, a) => s + a.spend, 0)
  const totalLeads = withLeads.reduce((s, a) => s + a.leads, 0)
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0
  if (avgCpl <= 0) return null
  const best = [...withLeads].sort((a, b) => a.cpl - b.cpl)[0]
  const worst = [...ads].sort((a, b) => b.cpl - a.cpl)[0]
  const bestQualifies = best.cpl <= avgCpl * 0.6 && best.leads >= 3
  const worstQualifies = (worst.cpl >= avgCpl * 1.8 || worst.leads === 0) && worst.spend >= 200
  if (!bestQualifies && !worstQualifies) return null
  const lines = []
  if (bestQualifies) {
    lines.push(`✅ "${best.adName}" — ${best.leads} לידים ב-${fmtShekels(best.spend)}, CPL ${fmtShekels(best.cpl)} (טוב ב-${Math.round((1 - best.cpl/avgCpl) * 100)}% מהממוצע ${fmtShekels(avgCpl)}).`)
  }
  if (worstQualifies) {
    if (worst.leads === 0) {
      lines.push(`❌ "${worst.adName}" — ${fmtShekels(worst.spend)} הוצא, 0 לידים. מועמד מיידי להפסקה.`)
    } else {
      lines.push(`❌ "${worst.adName}" — ${worst.leads} לידים בלבד ב-${fmtShekels(worst.spend)}, CPL ${fmtShekels(worst.cpl)} (גרוע ב-${Math.round((worst.cpl/avgCpl - 1) * 100)}% מהממוצע).`)
    }
  }
  const suggestParts = []
  if (bestQualifies) suggestParts.push(`הפק 2-3 וריאציות A/B של "${best.adName}" — שמור על המסר/ויז'ואל המנצח, חידד לקהלים נוספים`)
  if (worstQualifies) suggestParts.push(`השהה את "${worst.adName}" השבוע. ייצר החלפה שמאמצת אלמנטים מהקריאטיב המנצח`)
  // Predicted extra leads from reallocating worst's budget at avg CPL
  let predExtraLeads = 0
  if (worstQualifies && worst.spend > 0 && avgCpl > 0) {
    predExtraLeads = Math.round(worst.spend / avgCpl) - worst.leads
  }
  // Assume ~25% lead→meeting overall
  const predExtraMeetings = Math.max(1, Math.round(predExtraLeads * 0.25))
  const impactPhrase = shekelImpactPhrase(predExtraMeetings, costPerMeeting)
  // dedup key: prefer the worst (the action), fall back to best
  const dedupTarget = worstQualifies ? worst.adName : best.adName
  // Resolve creative assets (image / video / permalink) for best+worst
  const _pickAsset = (adName) => {
    const a = activeAdsByName && activeAdsByName[adName]
    if (!a) return null
    return {
      adName,
      imageUrl: a.imageUrl || a.thumbnailUrl || '',
      videoUrl: a.videoUrl || '',
      permalink: a.postPermalink || a.videoPermalink || '',
      title: a.title || '',
      body: a.body || '',
    }
  }
  const assets = {
    best: bestQualifies ? _pickAsset(best.adName) : null,
    worst: worstQualifies ? _pickAsset(worst.adName) : null,
  }
  return {
    role: 'agency',
    type: 'creative_performance',
    dedupKey: `creative:${dedupTarget}`,
    assets,
    icon: '🎨',
    title: bestQualifies && worstQualifies
      ? 'יש מנצח ויש מבוזבז — פעולה כפולה'
      : (bestQualifies ? 'יש קריאטיב מנצח — לשבט' : 'יש קריאטיב שורף תקציב — להפסיק'),
    body: lines,
    suggestion: suggestParts.join('. '),
    prediction: {
      label: 'תוספת/חיסכון צפויים',
      value: impactPhrase || (predExtraLeads > 0 ? `+${predExtraLeads} לידים` : `+2-3 לידים`),
      detail: worstQualifies
        ? `הסטת תקציב "${worst.adName}" (${fmtShekels(worst.spend)}) לקריאטיב בעלות ממוצעת ${fmtShekels(avgCpl)}/ליד`
        : `שיבוט הקריאטיב המנצח לקהלים נוספים`,
    },
    measure: [
      bestQualifies ? `כמות לידים מהוריאציות החדשות של "${best.adName}"` : `כמות לידים מהקריאטיב החלופי`,
      worstQualifies ? `כמות לידים מהקריאטיב שהחליף את "${worst.adName}"` : `שיעור ההמרה הכללי`,
      `CPL ממוצע — האם ירד מתחת ל-${fmtShekels(avgCpl)}?`,
    ],
    baseline: { metric: 'creative_perf', avgCpl, bestAd: best.adName, bestCpl: best.cpl, worstAd: worst.adName, worstCpl: worst.cpl === Infinity ? null : worst.cpl, worstSpend: worst.spend },
    target: { metric: 'creative_perf_improved', avgCpl: avgCpl * 0.9, expectedExtraLeads: predExtraLeads, expectedExtraMeetings: predExtraMeetings },
  }
}

// ---------- Main entry point ----------

export function buildRecommendations(input) {
  const {
    bucketTotals, bucketWith, dowMerged, totalLids,
    crmRepRows,
    byUser,
    sources,
    fbRows, googRows,
    costPerMeeting,   // NEW: ₪ per completed meeting (or scheduled meeting — see Stage 2 caller decision)
    totalSpend,       // NEW: aggregate Meta + Google spend for the window
  } = input || {}
  const recs = []
  const r1 = buildResponseTimeRec(bucketTotals, bucketWith, totalLids, costPerMeeting); if (r1) recs.push(r1)
  const r2 = buildObjectionRec(crmRepRows, costPerMeeting); if (r2) recs.push(r2)
  const r3 = buildDayOfWeekRec(dowMerged, totalLids, costPerMeeting); if (r3) recs.push(r3)
  const r4 = buildCityRec(crmRepRows, totalLids, costPerMeeting); if (r4) recs.push(r4)
  const r4b = buildGeoWasteRec(crmRepRows, totalLids, totalSpend, costPerMeeting); if (r4b) recs.push(r4b)
  const r5 = buildSalespersonSpeedRec(byUser, totalLids, costPerMeeting); if (r5) recs.push(r5)
  const r6 = buildIrrelevantSourceRec(sources, totalSpend, costPerMeeting); if (r6) recs.push(r6)
  const r7 = buildCreativeRec(fbRows, googRows, costPerMeeting, input?.activeAdsByName); if (r7) recs.push(r7)
  return recs
}

export function groupByRole(recs) {
  const groups = {}
  for (const role of ROLE_ORDER) groups[role] = []
  for (const r of recs || []) {
    if (groups[r.role]) groups[r.role].push(r)
    else groups.salesperson.push(r)
  }
  return groups
}

// ============================================================
// Stage 5: Impact verification
// ============================================================
// compareImpact(task, currentInput) — given a locked task from vitas_tasks,
// and the current dashboard data (same shape as buildRecommendations input),
// returns an impact verdict.
//
// Status values:
//   'pending'   — <28 days since lock, too early to measure (countdown)
//   'green'     — significant improvement in the right direction
//   'red'       — significant regression
//   'gray'      — measured but change is not significant (-5%..+5%)
//   'unknown'   — couldn't compute (data missing, metric type unrecognized)
//
// Returns: { status, daysSinceLock, daysRemaining, baselineValue, currentValue, pctChange, direction, label }

const IMPACT_THRESHOLD_PCT = 5      // changes smaller than this → gray
const MEASURE_AFTER_DAYS = 28       // wait this many days before showing verdict

export function compareImpact(task, currentInput) {
  if (!task || !task.meeting_date || !task.baseline_metadata) {
    return { status: 'unknown', reason: 'missing task data' }
  }
  const meetingDate = new Date(task.meeting_date)
  const daysSinceLock = Math.floor((Date.now() - meetingDate.getTime()) / 86400000)
  if (daysSinceLock < MEASURE_AFTER_DAYS) {
    return {
      status: 'pending',
      daysSinceLock,
      daysRemaining: MEASURE_AFTER_DAYS - daysSinceLock,
      label: `ממתין למדידה · עוד ${MEASURE_AFTER_DAYS - daysSinceLock} ימים`,
    }
  }

  // Extract baseline + current values per metric type
  const type = task.baseline_metadata.type || task.metric_type || ''
  const baseline = task.baseline_metadata.baseline || {}
  let baselineVal, currentVal, betterIsHigher, label
  try {
    switch (type) {
      case 'response_time': {
        // The slow bucket should have HIGHER conv (people in that bucket converting more) OR less volume
        const bucketKey = baseline.value
        const total = (currentInput.bucketTotals || {})[bucketKey] || 0
        const wm = (currentInput.bucketWith || {})[bucketKey] || 0
        baselineVal = baseline.conv || 0
        currentVal = total > 0 ? (wm / total) * 100 : 0
        betterIsHigher = true
        label = `המרה ב-${bucketKey}`
        break
      }
      case 'top_objection': {
        // The objection share should DECREASE (we addressed it, fewer leads should object)
        const obj = baseline.value
        const rows = currentInput.crmRepRows || []
        const counts = {}; let totalWithObj = 0
        for (const r of rows) {
          const o = (r.objections || '').trim()
          if (!o) continue
          totalWithObj++
          o.split(/[,;|]/).map(s => s.trim()).filter(Boolean).forEach(x => counts[x] = (counts[x] || 0) + 1)
        }
        const currentCount = counts[obj] || 0
        baselineVal = baseline.share || 0
        currentVal = totalWithObj > 0 ? (currentCount / totalWithObj) * 100 : 0
        betterIsHigher = false
        label = `שיעור התנגדות "${obj}"`
        break
      }
      case 'day_of_week': {
        // The golden day should have HIGHER conv OR more volume
        const dayName = (task.baseline_metadata.baseline && task.baseline_metadata.baseline.metric || '').replace(/^day_/, '') || (baseline.metric || '').replace(/^day_/, '')
        const days = Object.values(currentInput.dowMerged || {})
        const day = days.find(d => d.name === dayName)
        baselineVal = baseline.conv || 0
        currentVal = day && day.leads > 0 ? (day.scheduled / day.leads) * 100 : 0
        betterIsHigher = true
        label = `המרה ביום ${dayName}`
        break
      }
      case 'top_city': {
        // Volume from the city should INCREASE (targeted campaign helped)
        const city = (baseline.metric || '').replace(/^city_/, '') || ''
        const rows = currentInput.crmRepRows || []
        const count = rows.filter(r => (r.address || '').trim() === city).length
        baselineVal = baseline.count || 0
        currentVal = count
        betterIsHigher = true
        label = `לידים מ-${city}`
        break
      }
      case 'geo_waste': {
        // City conv should INCREASE (fix worked) OR city volume should DECREASE (excluded from targeting)
        const city = baseline.city
        const rows = (currentInput.crmRepRows || []).filter(r => (r.address || '').trim() === city)
        const total = rows.length
        const withMeeting = rows.filter(r => r.scheduledAt || r.meetingScheduled || r.scheduled === true).length
        baselineVal = baseline.conv || 0
        currentVal = total > 0 ? (withMeeting / total) * 100 : 0
        // We prefer the conv-improvement measure here; if conv went down BUT volume also down, that's also fine
        // but we report on conv as primary indicator
        betterIsHigher = true
        label = `המרה מ-${city}`
        break
      }
      case 'salesperson_speed_gap': {
        // The slow user's avg minutes should DECREASE
        const slowestName = baseline.slowest
        const u = (currentInput.byUser || {})[slowestName]
        baselineVal = baseline.slowestMin || 0
        currentVal = (u && u.avgMinutes) || 0
        betterIsHigher = false
        label = `זמן תגובה של ${slowestName}`
        break
      }
      case 'irrelevant_source': {
        // The bad source's irrelevant rate should DECREASE
        const sourceName = baseline.source
        const s = (currentInput.sources || {})[sourceName]
        baselineVal = baseline.rate || 0
        currentVal = s && s.totalLeads > 0 ? ((s.nonRelevantLeads || 0) / s.totalLeads) * 100 : 0
        betterIsHigher = false
        label = `% לא רלוונטיים מ-${sourceName}`
        break
      }
      case 'creative_performance': {
        // Find the worst ad — its CPL should be lower (replaced) OR ad doesn't exist anymore (paused)
        const worstName = baseline.worstAd
        const rows = [...(currentInput.fbRows || []), ...(currentInput.googRows || [])]
        const matching = rows.filter(r => (r.adName || '').trim() === worstName || (r.campaign || '').trim() === worstName)
        const spend = matching.reduce((s, r) => s + (Number(r.spend) || 0), 0)
        const leads = matching.reduce((s, r) => s + (Number(r.leads) || 0), 0)
        baselineVal = baseline.worstCpl || 0
        if (matching.length === 0 || spend === 0) {
          // Ad was paused — full win
          return {
            status: 'green',
            daysSinceLock,
            daysRemaining: 0,
            baselineValue: baseline.worstCpl,
            currentValue: 0,
            pctChange: 100,
            direction: 'better',
            label: `"${worstName}" הופסק/לא רץ`,
          }
        }
        currentVal = leads > 0 ? spend / leads : Infinity
        betterIsHigher = false
        label = `CPL של "${worstName}"`
        break
      }
      default:
        return { status: 'unknown', reason: `unknown metric type: ${type}`, daysSinceLock }
    }
  } catch (err) {
    return { status: 'unknown', reason: 'error: ' + (err.message || err), daysSinceLock }
  }

  // Compute pct change with direction
  if (!Number.isFinite(baselineVal) || baselineVal === 0) {
    // Edge case: can't compute %. Use absolute direction.
    return { status: 'unknown', reason: 'baseline is zero or non-finite', daysSinceLock, baselineValue: baselineVal, currentValue: currentVal, label }
  }
  const rawPct = ((currentVal - baselineVal) / baselineVal) * 100
  // If higher is better → positive pct = improvement
  // If lower is better → negative pct = improvement
  const improvementPct = betterIsHigher ? rawPct : -rawPct
  let status
  if (Math.abs(improvementPct) < IMPACT_THRESHOLD_PCT) status = 'gray'
  else if (improvementPct > 0) status = 'green'
  else status = 'red'
  return {
    status,
    daysSinceLock,
    daysRemaining: 0,
    baselineValue: baselineVal,
    currentValue: currentVal,
    pctChange: Math.round(improvementPct),
    direction: improvementPct > 0 ? 'better' : 'worse',
    label,
  }
}
