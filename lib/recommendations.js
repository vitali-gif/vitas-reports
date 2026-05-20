// Smart Recommendations Engine — Phase 1 (no persistence yet).
// Pattern-detection functions that produce natural-Hebrew recommendation objects.
// Each function takes merged stats from the dashboard and returns a recommendation
// object (or null if no actionable pattern detected).

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

// Hebrew percentage diff phrasing
function percentDiff(better, baseline) {
  if (!baseline) return ''
  const pct = Math.round(((better - baseline) / baseline) * 100)
  return pct
}

// ----------------------------------------------------------------
// REC 1: Response-time bucket
// If the dominant response-time bucket has notably lower conversion than
// an EARLIER (faster) bucket with enough volume, suggest tightening.
// ----------------------------------------------------------------
export function buildResponseTimeRec(bucketTotals, bucketWith, totalLids) {
  if (!totalLids || totalLids < 10) return null

  const buckets = BUCKET_KEYS_ORDERED.map(k => {
    const total = bucketTotals[k] || 0
    const wm = bucketWith[k] || 0
    return {
      key: k,
      label: BUCKET_LABELS[k],
      total,
      withMeeting: wm,
      conv: total > 0 ? (wm / total) * 100 : 0,
    }
  })

  // Find dominant bucket — most leads, must have at least 8
  const dominant = buckets.filter(b => b.total >= 8).sort((a, b) => b.total - a.total)[0]
  if (!dominant) return null

  // Find an EARLIER (faster) bucket that converts noticeably better, with at least 4 leads
  const domIdx = BUCKET_KEYS_ORDERED.indexOf(dominant.key)
  const candidates = buckets
    .filter(b => b.total >= 4)
    .filter(b => BUCKET_KEYS_ORDERED.indexOf(b.key) < domIdx)
    .filter(b => b.conv >= dominant.conv * 1.25 && (b.conv - dominant.conv) >= 4)
    .sort((a, b) => b.conv - a.conv)
  const better = candidates[0]
  if (!better) return null

  // Predict the lift
  const projectedMeetings = Math.round(dominant.total * (better.conv / 100))
  const lift = projectedMeetings - dominant.withMeeting
  if (lift < 2) return null

  const liftPct = percentDiff(better.conv, dominant.conv)

  return {
    type: 'response_time',
    icon: '⏱️',
    title: 'כדאי לקצר את זמן התגובה',
    body: [
      `רוב הלידים החודש (${dominant.total} לידים, ${Math.round(dominant.total / totalLids * 100)}% מהכמות) מטופלים בטווח של ${dominant.label}, וההמרה לפגישה שם היא ${Math.round(dominant.conv)}%.`,
      `לעומתם, ב-${better.total} לידים שטופלו ב-${better.label}, ההמרה הייתה ${Math.round(better.conv)}% - גבוהה ב-${liftPct}%.`,
    ],
    suggestion: `מאמץ ממוקד החודש הבא להוריד את זמן המענה ל-${better.label} על כמה שיותר לידים.`,
    prediction: {
      label: 'תוספת צפויה לפגישות',
      value: `+${lift}`,
      detail: `${projectedMeetings} במקום ${dominant.withMeeting}`,
    },
    measure: [
      `זמן מענה ממוצע - האם ירד מטווח "${dominant.label}" ל"${better.label}"?`,
      `אחוז המרה לפגישה - האם עלה מ-${Math.round(dominant.conv)}% ל-${Math.round(better.conv)}%+?`,
    ],
    baseline: { metric: 'response_bucket', value: dominant.key, conv: dominant.conv, meetings: dominant.withMeeting },
    target: { metric: 'response_bucket', value: better.key, conv: better.conv, meetings: projectedMeetings },
  }
}

// ----------------------------------------------------------------
// REC 2: Day-of-week boost
// If a particular weekday converts noticeably better than the average,
// suggest boosting budget that day.
// ----------------------------------------------------------------
export function buildDayOfWeekRec(dowMerged, totalLids) {
  if (!totalLids || totalLids < 10) return null

  // dowMerged keyed by day index (0=Sunday in JS, but our data may store Hebrew name + leads + scheduled)
  const days = Object.values(dowMerged || {})
    .filter(d => d.leads >= 4)
    .map(d => ({ ...d, conv: d.leads > 0 ? (d.scheduled / d.leads) * 100 : 0 }))
  if (days.length < 3) return null

  const sorted = [...days].sort((a, b) => b.conv - a.conv)
  const best = sorted[0]
  const others = days.filter(d => d.name !== best.name)
  const avgOthers = others.reduce((s, d) => s + d.conv, 0) / others.length
  if (avgOthers <= 0) return null

  // Significance: best at least 30% above the average of other days, and at least 4pp gap
  if (best.conv < avgOthers * 1.3 || (best.conv - avgOthers) < 4) return null

  const liftPct = percentDiff(best.conv, avgOthers)
  // If best.leads stay same but conversion holds, vs adding more leads at best.conv:
  // simplest prediction = double the leads on best day → double the scheduled
  const projectedExtraMeetings = Math.round(best.scheduled * 1)  // ~doubled

  return {
    type: 'day_of_week',
    icon: '📅',
    title: `יום ${best.name} מצליח יותר מהאחרים`,
    body: [
      `ביום ${best.name} נכנסו ${best.leads} לידים, ו-${best.scheduled} מהם המירו לפגישה - ${Math.round(best.conv)}% המרה.`,
      `הממוצע שאר הימים בשבוע: ${Math.round(avgOthers)}%. זה גבוה ב-${liftPct}% מהממוצע - דפוס משמעותי.`,
    ],
    suggestion: `הוסף תקציב מודעות נוסף ליום ${best.name} בחודש הבא, כדי לנצל את כוח ההמרה של היום הזה.`,
    prediction: {
      label: 'תוספת פגישות אם נכפיל את כמות הלידים ביום ' + best.name,
      value: `+${projectedExtraMeetings}`,
      detail: `אם תכפיל את כמות הלידים ביום ${best.name} ותשמור על ההמרה (${Math.round(best.conv)}%)`,
    },
    measure: [
      `כמות הלידים ביום ${best.name} - האם עלתה?`,
      `מספר הפגישות הכולל - האם עלה?`,
      `אחוז ההמרה ביום ${best.name} - האם נשמר על ${Math.round(best.conv)}%+? (אם הוא צנח אולי הוספנו לידים פחות איכותיים)`,
    ],
    baseline: { metric: 'day_' + best.name, leads: best.leads, scheduled: best.scheduled, conv: best.conv },
    target: { metric: 'day_' + best.name + '_with_extra_budget', conv: best.conv },
  }
}

// ----------------------------------------------------------------
// Main: take all required stats, return array of recommendations.
// ----------------------------------------------------------------
export function buildRecommendations({ bucketTotals, bucketWith, dowMerged, totalLids }) {
  const recs = []
  const r1 = buildResponseTimeRec(bucketTotals, bucketWith, totalLids)
  if (r1) recs.push(r1)
  const r2 = buildDayOfWeekRec(dowMerged, totalLids)
  if (r2) recs.push(r2)
  return recs
}
