// Smart Recommendations Engine — Phase 2: organized by role.
// Each recommendation has a `role` field:
//   - 'agency'           → 🎨 משרד פרסום (creatives, copy, photo days)
//   - 'campaign_manager' → 📊 מנהל קמפיינים (budget, targeting, mix)
//   - 'marketing_manager'→ 🧭 מנהל שיווק (vendors, sales team oversight)
//   - 'salesperson'      → 📞 איש מכירות (lead handling, objections)

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

// 📞 איש מכירות — Response time
export function buildResponseTimeRec(bucketTotals, bucketWith, totalLids) {
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
  return {
    role: 'salesperson',
    type: 'response_time',
    icon: '⏱️',
    title: 'כדאי לקצר את זמן התגובה',
    body: [
      `רוב הלידים (${dominant.total} לידים, ${Math.round(dominant.total/totalLids*100)}% מהכמות) מטופלים בטווח של ${dominant.label}, ההמרה לפגישה שם ${Math.round(dominant.conv)}%.`,
      `ב-${better.total} לידים שטופלו ב-${better.label}, ההמרה הייתה ${Math.round(better.conv)}% — גבוהה ב-${liftPct}%.`,
    ],
    suggestion: `מאמץ ממוקד להוריד את זמן המענה ל-${better.label} על כמה שיותר לידים.`,
    prediction: { label: 'תוספת צפויה לפגישות', value: `+${lift}`, detail: `${projectedMeetings} במקום ${dominant.withMeeting}` },
    measure: [
      `זמן מענה ממוצע - האם ירד מ"${dominant.label}" ל-"${better.label}"?`,
      `אחוז המרה לפגישה - האם עלה מ-${Math.round(dominant.conv)}% ל-${Math.round(better.conv)}%+?`,
    ],
    baseline: { metric: 'response_bucket', value: dominant.key, conv: dominant.conv, meetings: dominant.withMeeting },
    target: { metric: 'response_bucket', value: better.key, conv: better.conv, meetings: projectedMeetings },
  }
}

// 📞 איש מכירות — Top objection
export function buildObjectionRec(crmRepRows) {
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
  return {
    role: 'salesperson',
    type: 'top_objection',
    icon: '💬',
    title: `התנגדות מובילה: "${topObj}"`,
    body: [
      `מתוך ${totalWithObj} לידים עם התנגדות מתועדת, ההתנגדות "${topObj}" הופיעה ב-${topCount} מהם — ${pct}% מכלל ההתנגדויות.`,
      `זו ההתנגדות הכי שכיחה בתקופה הנבחרת, ולכן שווה לבנות תסריט מענה ייעודי שעוזר להמיר לידים שמגיעים איתה.`,
    ],
    suggestion: `כתוב/עדכן תשובה מובנית להתנגדות "${topObj}", שתף את הצוות, ועקוב אחר שיעור ההמרה של לידים עם ההתנגדות הזאת בחודש הבא.`,
    prediction: {
      label: 'פוטנציאל אם נשפר את המענה',
      value: `${topCount} לידים`,
      detail: `אלו הלידים שמושפעים ישירות מהמענה להתנגדות הזאת`,
    },
    measure: [
      `שיעור ההמרה של לידים שהביעו את ההתנגדות הזאת - האם עלה?`,
      `כמות הופעות ההתנגדות בחודש הבא - יכולה לרדת אם הקריאטיב מטפל בה מראש`,
    ],
    baseline: { metric: 'top_objection', value: topObj, count: topCount, share: pct },
    target: { metric: 'top_objection_addressed', value: topObj },
  }
}

// 📊 מנהל קמפיינים — Day of week
export function buildDayOfWeekRec(dowMerged, totalLids) {
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
  return {
    role: 'campaign_manager',
    type: 'day_of_week',
    icon: '📅',
    title: `יום ${best.name} מצליח יותר מהאחרים`,
    body: [
      `ביום ${best.name} נכנסו ${best.leads} לידים, ו-${best.scheduled} מהם המירו לפגישה — ${Math.round(best.conv)}% המרה.`,
      `הממוצע שאר הימים: ${Math.round(avgOthers)}%. זה גבוה ב-${liftPct}% מהממוצע — דפוס משמעותי.`,
    ],
    suggestion: `הוסף תקציב מודעות נוסף ליום ${best.name} בחודש הבא, כדי לנצל את כוח ההמרה של היום.`,
    prediction: {
      label: 'תוספת פגישות אם נכפיל את כמות הלידים ביום ' + best.name,
      value: `+${projectedExtraMeetings}`,
      detail: `אם תכפיל את הלידים ביום ${best.name} ותשמור על ההמרה (${Math.round(best.conv)}%)`,
    },
    measure: [
      `כמות הלידים ביום ${best.name} - האם עלתה?`,
      `מספר הפגישות הכולל - האם עלה?`,
      `אחוז ההמרה ביום ${best.name} - האם נשמר על ${Math.round(best.conv)}%+?`,
    ],
    baseline: { metric: 'day_' + best.name, leads: best.leads, scheduled: best.scheduled, conv: best.conv },
    target: { metric: 'day_' + best.name + '_with_extra_budget', conv: best.conv },
  }
}

// 📊 מנהל קמפיינים — City concentration
export function buildCityRec(crmRepRows, totalLids) {
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
  return {
    role: 'campaign_manager',
    type: 'top_city',
    icon: '🏙️',
    title: `ריכוז גבוה של לידים מ-${topCity}`,
    body: [
      `מתוך ${crmRepRows.length} לידים, ${topCount} מהם (${Math.round(share)}%) מגיעים מ-${topCity}. זה הרבה יותר מהממוצע (${Math.round(avgRest)} לידים לעיר אחרת).`,
      `קהל היעד "מצביע" שהעיר הזאת אוהבת את הפרויקט — שווה לבנות עליה קמפיין ייעודי.`,
    ],
    suggestion: `צור קמפיין/קבוצת מודעות מטורגטת ל-${topCity} בלבד, עם קריאטיב שמדבר על האזור (מרחק, יתרונות לתושבי האזור). הקצה ~20-30% מהתקציב אליה.`,
    prediction: {
      label: 'פוטנציאל ב-' + topCity,
      value: `+30-50%`,
      detail: `קמפיין מטורגט לקהל ספציפי בד"כ מוריד CPL ב-30%-50% מול קמפיין כללי`,
    },
    measure: [
      `כמות לידים מ-${topCity} - האם עלתה?`,
      `שיעור ההמרה מ-${topCity} - האם נשמר/עלה?`,
      `CPL בקמפיין המטורגט - האם נמוך יותר מהקמפיין הכללי?`,
    ],
    baseline: { metric: 'city_' + topCity, count: topCount, share },
    target: { metric: 'city_' + topCity + '_with_targeted_campaign', share: share * 1.3 },
  }
}

// 🧭 מנהל שיווק — Salesperson speed gap
export function buildSalespersonSpeedRec(byUser, totalLids) {
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
  return {
    role: 'marketing_manager',
    type: 'salesperson_speed_gap',
    icon: '🧑‍💼',
    title: `פער זמן תגובה גדול בין אנשי המכירות`,
    body: [
      `${fastest.name} עונה ב-${fmtMinutes(fastest.avgMinutes)} בממוצע (${fastest.count} לידים).`,
      `${slowest.name} עונה ב-${fmtMinutes(slowest.avgMinutes)} בממוצע (${slowest.count} לידים) — פי ${Math.round(slowest.avgMinutes/Math.max(1,fastest.avgMinutes))} יותר זמן.`,
      `הפער הזה ישירות פוגע בהמרה — לידים ש"מתקררים" שעות אחרי שמילאו טופס מתפנים פחות לפגישה.`,
    ],
    suggestion: `שיחה אישית עם ${slowest.name} על זמני התגובה. בדוק אם זה עומס לידים, חוסר התראות בנייד, או צורך בחלוקה מחדש של תורנויות.`,
    prediction: {
      label: 'פוטנציאל שיפור',
      value: `${slowest.count} לידים`,
      detail: `אם ${slowest.name} יוריד את הזמן ל-${fmtMinutes(fastest.avgMinutes)}, ההמרה צפויה לעלות באופן דומה לזו של ${fastest.name}`,
    },
    measure: [
      `זמן התגובה הממוצע של ${slowest.name} - האם ירד?`,
      `שיעור ההמרה של לידים של ${slowest.name} - האם עלה?`,
      `הפער בין הצוות - האם הצטמצם?`,
    ],
    baseline: { metric: 'salesperson_gap', fastest: fastest.name, fastestMin: fastest.avgMinutes, slowest: slowest.name, slowestMin: slowest.avgMinutes },
    target: { metric: 'salesperson_gap_closed', maxAvg: fastest.avgMinutes * 2 },
  }
}

// 🧭 מנהל שיווק — Irrelevant source
export function buildIrrelevantSourceRec(sources) {
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
  return {
    role: 'marketing_manager',
    type: 'irrelevant_source',
    icon: '⚠️',
    title: `מקור "${worst.name}" מביא הרבה לידים לא רלוונטיים`,
    body: [
      `${worst.irrelevant} מתוך ${worst.leads} לידים מ-"${worst.name}" סומנו לא רלוונטיים — ${Math.round(worst.rate)}%.`,
      `הממוצע במקורות האחרים: ${Math.round(avgRate)}%. זה ${Math.round(worst.rate - avgRate)} נקודות אחוז מעל הממוצע.`,
      `כשמקור מביא הרבה לידים לא איכותיים, התקציב נשרף לידים שלא יומרו לפגישה ובסוף לעסקה.`,
    ],
    suggestion: `דבר עם משרד הפרסום או עם מנהל הקמפיינים: בדקו את הקריאטיב, הטירגוט, ושאלות הטופס של "${worst.name}". יכול להיות שצריך לחדד טירגוט (גיל/הכנסה), לשנות מסר, או להוסיף שאלת מסננת בטופס.`,
    prediction: {
      label: 'תקציב משוחרר ללידים איכותיים',
      value: `~${worst.irrelevant} לידים`,
      detail: `אם תוריד את שיעור הלידים הלא רלוונטיים של "${worst.name}" לרמת הממוצע, תקבל פחות לידים אבל יותר איכותיים — או תוכל להזיז תקציב למקור יעיל יותר`,
    },
    measure: [
      `שיעור הלא רלוונטיים ב-"${worst.name}" - האם ירד?`,
      `CPL מותאם (תקציב/לידים רלוונטיים) - האם השתפר?`,
      `אחוז הלידים שהמירו לפגישה ממקור זה - האם עלה?`,
    ],
    baseline: { metric: 'irrelevant_rate', source: worst.name, rate: worst.rate, avg: avgRate },
    target: { metric: 'irrelevant_rate_reduced', source: worst.name, targetRate: avgRate },
  }
}

// 🎨 משרד הפרסום — Creative performance
export function buildCreativeRec(fbRows, googRows) {
  const rows = [...(fbRows || []), ...(googRows || [])]
    .map(r => ({
      adName: (r.adName || '').trim() || (r.campaign || '').trim(),
      campaign: (r.campaign || '').trim(),
      spend: Number(r.spend) || 0,
      leads: Number(r.leads) || 0,
      clicks: Number(r.clicks) || 0,
    }))
    .filter(r => r.adName && r.spend >= 50)
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
    lines.push(`✅ "${best.adName}" — ${best.leads} לידים ב-${Math.round(best.spend)}₪, CPL של ${Math.round(best.cpl)}₪ (טוב יותר ב-${Math.round((1 - best.cpl/avgCpl) * 100)}% מהממוצע ${Math.round(avgCpl)}₪).`)
  }
  if (worstQualifies) {
    if (worst.leads === 0) {
      lines.push(`❌ "${worst.adName}" — ${Math.round(worst.spend)}₪ הוצא, 0 לידים. מועמד להפסקה.`)
    } else {
      lines.push(`❌ "${worst.adName}" — ${worst.leads} לידים בלבד ב-${Math.round(worst.spend)}₪, CPL ${Math.round(worst.cpl)}₪ (גרוע ב-${Math.round((worst.cpl/avgCpl - 1) * 100)}% מהממוצע).`)
    }
  }
  const suggestParts = []
  if (bestQualifies) suggestParts.push(`הפיק וריאציות (A/B) של "${best.adName}" — שמור על המסר/ויז'ואל המנצח ובדוק עוד 2-3 אדפטציות לקהלים נוספים`)
  if (worstQualifies) suggestParts.push(`השהה את "${worst.adName}" וצור החלפה — בדוק מה ב-"${best.adName || 'הקריאטיב המנצח'}" עובד ונסה לאמץ`)
  return {
    role: 'agency',
    type: 'creative_performance',
    icon: '🎨',
    title: bestQualifies && worstQualifies ? 'קריאטיב מנצח לעומת קריאטיב מבוזבז' : (bestQualifies ? 'יש קריאטיב מנצח — שווה לשבט' : 'יש קריאטיב מבוזבז — שווה להחליף'),
    body: lines,
    suggestion: suggestParts.join('. '),
    prediction: {
      label: 'פוטנציאל חיסכון/תוספת לידים',
      value: worstQualifies && worst.spend > 0 ? `~${Math.round(worst.spend / avgCpl)} לידים` : `+2-3 לידים`,
      detail: worstQualifies ? `אם תפנה את התקציב של "${worst.adName}" לקריאטיב בעלות ממוצעת — תקבל ~${Math.round(worst.spend / avgCpl)} לידים נוספים` : `שיבוט הקריאטיב המנצח לקהלים נוספים`,
    },
    measure: [
      bestQualifies ? `כמות לידים מהוריאציות החדשות של "${best.adName}"` : `כמות לידים מהקריאטיב החלופי`,
      worstQualifies ? `כמות לידים מהקריאטיב החדש שהחליף את "${worst.adName}"` : `שיעור ההמרה הכללי בקמפיינים`,
      `CPL הממוצע - האם ירד מתחת ל-${Math.round(avgCpl)}₪?`,
    ],
    baseline: { metric: 'creative_perf', avgCpl, bestAd: best.adName, bestCpl: best.cpl, worstAd: worst.adName, worstCpl: worst.cpl === Infinity ? null : worst.cpl },
    target: { metric: 'creative_perf_improved', avgCpl: avgCpl * 0.9 },
  }
}

// Main
export function buildRecommendations(input) {
  const {
    bucketTotals, bucketWith, dowMerged, totalLids,
    crmRepRows,
    byUser,
    sources,
    fbRows, googRows,
  } = input || {}
  const recs = []
  const r1 = buildResponseTimeRec(bucketTotals, bucketWith, totalLids); if (r1) recs.push(r1)
  const r2 = buildObjectionRec(crmRepRows); if (r2) recs.push(r2)
  const r3 = buildDayOfWeekRec(dowMerged, totalLids); if (r3) recs.push(r3)
  const r4 = buildCityRec(crmRepRows, totalLids); if (r4) recs.push(r4)
  const r5 = buildSalespersonSpeedRec(byUser, totalLids); if (r5) recs.push(r5)
  const r6 = buildIrrelevantSourceRec(sources); if (r6) recs.push(r6)
  const r7 = buildCreativeRec(fbRows, googRows); if (r7) recs.push(r7)
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
