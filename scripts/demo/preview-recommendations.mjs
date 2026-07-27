/**
 * scripts/demo/preview-recommendations.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * מריץ את מנוע ההמלצות האמיתי (lib/recommendations.js) על דאטהסט הדמו,
 * בדיוק באותה צורה שבה `app/admin/page.js` קורא לו (שורות ~2300-2406).
 *
 * למה זה קריטי: טאב "💡 המלצות חכמות" הוא הפיצ'ר שהכי מרשים בפגישת מכירה,
 * אבל כל המלצה נדלקת רק אם הנתונים חוצים סף מסוים. פרופיל "שטוח" מדי מייצר
 * דשבורד שנראה מצוין — ועם טאב המלצות ריק. הכלי הזה מודד כמה המלצות נדלקות,
 * כדי שנוכל לכוונן את profile.mjs עד שהטאב מלא.
 *
 * הרצה:  node scripts/demo/preview-recommendations.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROFILE } from './profile.mjs'
import { synthesize } from './synthesize.mjs'

// lib/recommendations.js הוא ESM בתוך פרויקט CJS — מעתיקים ל-.mjs כדי לייבא.
const srcUrl = new URL('../../lib/recommendations.js', import.meta.url)
const tmp = join(mkdtempSync(join(tmpdir(), 'vitas-recs-')), 'recommendations.mjs')
writeFileSync(tmp, readFileSync(srcUrl, 'utf8'), 'utf8')
const R = await import('file://' + tmp)

const dataset = synthesize(PROFILE)

/** משחזר בדיוק את הרכבת הקלט ב-app/admin/page.js. */
function buildInput(periodKey) {
  const crm = dataset.reports.find(r => r.month === periodKey && r.source === 'crm')
  const fb  = dataset.reports.find(r => r.month === periodKey && r.source === 'facebook')
  const gg  = dataset.reports.find(r => r.month === periodKey && r.source === 'google')
  const s   = crm.summary
  const rt  = s.responseTimeStats

  const bucketTotals = { ...(rt.business?.buckets || {}) }
  const bucketWith = {}
  for (const [k, v] of Object.entries(rt.business?.bucketsWithMeeting || {})) {
    bucketWith[k] = v.withMeeting || 0
  }

  const hourlyLeadStats = Array.from({ length: 24 }, (_, h) => s.hourlyLeadStats[h] || 0)

  const activeAdsByName = {}
  for (const a of fb.summary.activeAds || []) {
    const nm = (a.adName || '').trim()
    if (nm && !activeAdsByName[nm]) activeAdsByName[nm] = { ...a, adName: nm }
  }

  const totalSpend = fb.summary.spend + gg.summary.spend
  const costPerMeeting = s.meetingsScheduled > 0 ? totalSpend / s.meetingsScheduled : 0

  return {
    bucketTotals, bucketWith,
    dowMerged: s.dayOfWeekStats,
    totalLids: rt.totalLids,
    hourlyLeadStats,
    crmRepRows: s.crmRepRows,
    byUser: rt.byUser,
    sources: s.sources,
    fbRows: fb.data, googRows: gg.data,
    costPerMeeting, totalSpend,
    activeAdsByName,
  }
}

const EXPECTED = [
  'זמן תגובה', 'התנגדות', 'יום', 'תזמון תקציב',
  'עיר הזהב', 'שורפת תקציב', 'פער זמן תגובה', 'מקור ששורף', 'קריאייטיב',
]

let totalFired = 0
for (const [label, key] of Object.entries(dataset.meta.periodKeys)) {
  const recs = R.buildRecommendations(buildInput(key))
  totalFired += recs.length
  console.log(`\n━━━ ${label}  (${key}) — ${recs.length}/9 המלצות ━━━\n`)
  for (const rec of recs) {
    console.log(`  ▸ [${R.ROLE_META[rec.role]?.label || rec.role}] ${rec.title}`)
    for (const l of (rec.lines || []).slice(0, 2)) console.log(`      ${String(l).slice(0, 160)}`)
  }
  if (!recs.length) console.log('  (אין המלצות — הטאב ייראה ריק)')
}

console.log(`\n\nסה״כ ${totalFired} המלצות על פני 3 תקופות (מקסימום 27).`)
if (totalFired < 15) {
  console.log('⚠ מעט מדי — כוונן את profile.mjs (ראה ההערות ליד המשקלים) והרץ שוב.')
  process.exitCode = 1
} else {
  console.log('✅ טאב ההמלצות יהיה מלא בכל שלוש התקופות.')
}
console.log()
