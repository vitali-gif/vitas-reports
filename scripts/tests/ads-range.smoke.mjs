// scripts/tests/ads-range.smoke.mjs — בדיקת עשן לניתוב ולצורת השורות היומיות (שלב 2).
// הרצה:  node scripts/tests/ads-range.smoke.mjs
import { projectRowFilter, klossAgencyOf, subProjectMatcher, computeTotals, isSlimProject } from '../../lib/ads/routing.js'
import { normalizeDailyRow, rowKey } from '../../lib/ads/daily-store.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

// routing
const hiPark = { id: 'p1', name: 'HI PARK', meta_account_id: null, sub_projects: null }
const shami  = { id: 'p2', name: 'כלל הפרויקטים', meta_account_id: '999', sub_projects: ['שם טוב', 'שמי כללי'] }
const kloss  = { id: 'p3', name: 'KLOSS' }
const rows = [
  { account: '111', campaign: 'Hi Park-Scaling-7/2026-LeadG', adName: 'AD 1', spend: 10, impressions: 100, reach: 50, clicks: 5, leads: 1, age: '25-34', gender: 'female' },
  { account: '999', campaign: 'Shami all buildings', adName: 'AD 2 | שמי כללי | x', spend: 20, impressions: 200, reach: 80, clicks: 8, leads: 2, age: '', gender: '' },
  { account: '295378394595304', campaign: 'Sigawi LeadG', adName: 'k', spend: 5, impressions: 50, reach: 20, clicks: 2, leads: 0, age: '', gender: '' },
]
eq('HI PARK by campaign name', rows.filter(projectRowFilter(hiPark, 'facebook')).map(r => r.account), ['111'])
eq('dedicated account routes everything from that account', rows.filter(projectRowFilter(shami, 'facebook')).map(r => r.account), ['999'])
eq('KLOSS by agency account + keyword', rows.filter(projectRowFilter(kloss, 'facebook')).map(r => klossAgencyOf(r)), ['סיגאווי'])
eq('sub-project matcher prefers the longer name', subProjectMatcher(shami.sub_projects)('AD 2 | שמי כללי | x'), 'שמי כללי')
eq('slim projects', [isSlimProject(hiPark), isSlimProject(kloss)], [true, false])
const t = computeTotals(rows)
eq('computeTotals sums + ratios', [t.spend, t.leads, t.cpl, Math.round(t.ctr * 100) / 100], [35, 3, 35 / 3, 4.29])   // CTR = 15 קליקים / 350 חשיפות

// daily-store
const d1 = normalizeDailyRow({ source: 'facebook', account: '111', day: '2026-09-15', campaign_id: 'c', campaign: 'C', adset_id: 's', adset: 'S', ad_id: 'a', ad: 'A', age: '25-34', gender: 'female', spend: '12.5', impressions: '100', reach: '50', clicks: '4', leads: 1 })
eq('normalizeDailyRow types', [typeof d1.spend, d1.impressions, d1.row_key.length], ['number', 100, 32])
eq('rowKey ignores metrics, depends on identity', rowKey({ ...d1, spend: 999 }) === d1.row_key && rowKey({ ...d1, gender: 'male' }) !== d1.row_key, true)
eq('missing fields become empty strings', normalizeDailyRow({ source: 'google', account: '1', day: '2026-09-15' }).age, '')

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
