// scripts/tests/reports-lite.smoke.mjs — T2: קיצוץ סיכומים ישנים באינדקס הקל של by-project.
// הרצה:  node scripts/tests/reports-lite.smoke.mjs
import { liteSummary, recentKeyTest } from '../../lib/reports-lite.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

// "עכשיו" = 1.10.2026 10:00 בישראל (07:00 UTC).
const recent = recentKeyTest(new Date('2026-10-01T07:00:00Z'))
eq('החודש הנוכחי מלא', recent('2026-10'), true)
eq('החודש הקודם מלא', recent('2026-09'), true)
eq('לפני חודשיים — מקוצץ', recent('2026-08'), false)
eq('טווח של היום מלא', recent('2026-10-01_2026-10-01'), true)
eq('טווח שמסתיים אתמול מלא (last7, yesterday)', recent('2026-09-24_2026-09-30'), true)
eq('רבעון שמסתיים אתמול מלא (q3)', recent('2026-07-01_2026-09-30'), true)
eq('ה"היום" של שלשום — מקוצץ', recent('2026-09-29_2026-09-29'), false)
eq('רבעון ישן — מקוצץ', recent('2026-01-01_2026-03-31'), false)
eq('רבעון עתידי מלא', recent('2026-10-01_2026-12-31'), true)
eq('מפתח לא מוכר — לא מקצצים', recent('weird-key'), true)
// מעבר שנה: בינואר החודש הקודם הוא דצמבר של השנה הקודמת.
eq('ינואר: דצמבר הקודם מלא', recentKeyTest(new Date('2027-01-05T07:00:00Z'))('2026-12'), true)
eq('ינואר: נובמבר הקודם מקוצץ', recentKeyTest(new Date('2027-01-05T07:00:00Z'))('2026-11'), false)
// חצות בישראל ולא ב-UTC: 30.9 בשעה 22:30 UTC = 1.10 01:30 בישראל.
eq('התאריך נמדד בשעון ישראל', recentKeyTest(new Date('2026-09-30T22:30:00Z'))('2026-09-29_2026-09-29'), false)

const full = { totalLeads: 12, spend: 3400, funnel: { a: 1 }, namedLeads: [{ name: 'x' }], activeAds: [1], crmRepRows: [1], adBreakdown: [1], otherUnqualNotes: ['n'], otherLossNotes: ['n'],
  assetGroups: [{ id: 7, status: 'PAUSED', name: 'g', assets: [{ imageUrl: 'u' }], spend: 5 }] }
const lite = liteSummary(full)
eq('השדות הכבדים יורדים', ['namedLeads', 'activeAds', 'crmRepRows', 'adBreakdown', 'otherUnqualNotes', 'otherLossNotes'].filter(k => k in lite), [])
eq('המספרים נשארים (גרפי מגמה)', [lite.totalLeads, lite.spend, lite.funnel], [12, 3400, { a: 1 }])
eq('קבוצות נכסים נשארות עם מזהה וסטטוס בלבד', lite.assetGroups, [{ id: 7, status: 'PAUSED' }])
eq('המקור לא משתנה', 'namedLeads' in full && full.assetGroups[0].assets.length === 1, true)
eq('סיכום ריק לא נשבר', liteSummary(null), null)

if (!process.exitCode) console.log('\n✓ קיצוץ האינדקס הקל תקין')

// ── onePeriodPerSource (4.10, הוצאה כפולה ב-API של HI PARK) ──
{
  const { onePeriodPerSource } = await import('../../lib/reports-period.js')
  const rows = [
    { source: 'facebook', month: '2026-09', spend: 20702 }, { source: 'facebook', month: '2026-09-01_2026-09-30', spend: 20703 },
    { source: 'google', month: '2026-09-01_2026-09-30', spend: 3946 },   // רק טווח — נשאר
    { source: 'crm', month: '2026-09', x: 1 }, { source: 'crm', month: '2026-09-01_2026-09-30', x: 2 },
  ]
  const out = onePeriodPerSource(rows, ['2026-09', '2026-09-01_2026-09-30'])
  const sum = out.filter(r => r.source === 'facebook').reduce((s, r) => s + r.spend, 0)
  const ok = sum === 20702 && out.length === 3 && out.find(r => r.source === 'google') && out.find(r => r.source === 'crm').x === 1
  console.log((ok ? '✓' : '✗') + ' one period per source — no double spend')
  if (!ok) process.exitCode = 1
}
