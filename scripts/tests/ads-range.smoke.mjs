// scripts/tests/ads-range.smoke.mjs — בדיקת עשן לניתוב ולצורת השורות היומיות (שלב 2).
// הרצה:  node scripts/tests/ads-range.smoke.mjs
import { projectRowFilter, klossAgencyOf, subProjectMatcher, computeTotals, isSlimProject } from '../../lib/ads/routing.js'
import { normalizeDailyRow, rowKey, aggregateRange } from '../../lib/ads/daily-store.js'
import { buildAdsRangeRows } from '../../lib/ads/range-rows.js'
import { focusFor, focusModesFor, isPaidLeadSource } from '../../lib/focus.js'

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


// aggregateRange (1.10, מיגרציה 023): קודם הפונקציה המהירה; חסרה → העמודים הישנים; שגיאה אחרת → זורק.
{
  const agg = { account: '111', campaign: 'C', ad: 'A', spend: '12.5', impressions: 100, leads: '1', days: 3, last_day: '2026-09-30', ad_status: 'ACTIVE' }
  const fakeSb = (fast) => {
    const calls = []
    return { calls, rpc(name) {
      calls.push(name)
      if (name === 'ad_daily_aggregate_all') return Promise.resolve(fast)
      const page = (from) => Promise.resolve({ data: from === 0 ? [agg] : [], error: null })
      return { range: (from) => page(from) }
    } }
  }
  const sb1 = fakeSb({ data: [agg], error: null })
  const r1 = await aggregateRange(sb1, 'facebook', '2026-07-01', '2026-09-30')
  eq('fast path: one call, same row shape', [sb1.calls, r1[0].spend, r1[0].adName, r1[0].adStatus, r1[0].lastDay], [['ad_daily_aggregate_all'], 12.5, 'A', 'ACTIVE', '2026-09-30'])
  const sb2 = fakeSb({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
  const r2 = await aggregateRange(sb2, 'facebook', '2026-07-01', '2026-09-30')
  eq('missing function → old paged RPC', [sb2.calls, r2.length, r2[0].spend], [['ad_daily_aggregate_all', 'ad_daily_aggregate'], 1, 12.5])
  const sb3 = fakeSb({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })
  let thrown = null
  try { await aggregateRange(sb3, 'facebook', '2026-07-01', '2026-09-30') } catch (e) { thrown = e.message }
  eq('other errors are not hidden by the fallback', /statement timeout/.test(thrown || ''), true)
}

// D14: מיקוד KLOSS "רק באר שבע" — מודעות של VITAS בלבד, בשני הערוצים; מזהי שורות עם סיומת.
{
  eq('focus modes: only KLOSS', [focusModesFor('KLOSS').map(m => m.id), focusModesFor('HI PARK').length], [['beersheva'], 0])
  eq('focusFor rejects other projects / unknown ids', [focusFor('kloss', 'beersheva')?.branch, focusFor('HI PARK', 'beersheva'), focusFor('KLOSS', 'x')], ['באר שבע', null, null])
  const fb = [
    { account: '143725504579407', campaign: 'Kloss-Beer Sheba | Ongoing LeadG', ad: 'A1', spend: '100', impressions: 1000, clicks: 10, leads: '5', days: 3 },
    { account: '295378394595304', campaign: 'Sigawi LeadG', ad: 'A2', spend: '300', impressions: 3000, clicks: 30, leads: '6', days: 3 },
  ]
  const gg = [
    { account: '4733225739', campaign: 'Kloss-6/2026-PMAX', ad: 'G1', spend: '50', impressions: 500, clicks: 5, leads: '1', days: 3 },
    { account: '9483793370', campaign: 'Kloss Search', ad: 'G2', spend: '70', impressions: 700, clicks: 7, leads: '2', days: 3 },
  ]
  const nothing = { data: null, error: null }
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: () => Promise.resolve(nothing), then: (res) => res(nothing) }
  const sb = { rpc: (name, a) => Promise.resolve({ data: a.p_source === 'facebook' ? fb : gg, error: null }), from: () => chain }
  const all = await buildAdsRangeRows(sb, kloss, '2026-09-01', '2026-09-30', { withReach: false })
  const foc = await buildAdsRangeRows(sb, kloss, '2026-09-01', '2026-09-30', { withReach: false, agency: 'VITAS', idSuffix: ':focus=beersheva' })
  const by = (res, src) => res.rows.find(r => r.source === src)
  eq('all: both agencies', [by(all, 'facebook').summary.spend, by(all, 'google').summary.spend], [400, 120])
  eq('focus: VITAS only (fb + google)', [by(foc, 'facebook').summary.spend, by(foc, 'facebook').summary.leads, by(foc, 'google').summary.spend], [100, 5, 50])
  eq('focus: byAgency has only VITAS', [Object.keys(by(foc, 'facebook').summary.byAgency), Object.keys(by(foc, 'google').summary.byAgency)], [['VITAS'], ['VITAS']])
  eq('paid lead sources (KLOSS values 7.10)', ['פייסבוק טופס לידים', 'גוגל חיפוש', 'עמוד נחיתה דגמים חדשים 25% הנחה', 'ig', 'fb', 'אתר החברה', 'מוקד טלפוני', 'המלצת חבר', 'Chat_GPT'].map(isPaidLeadSource), [true, true, true, true, true, false, false, false, false])
  eq('focus: row ids carry the suffix', by(foc, 'facebook').id, 'range:p3:facebook:2026-09-01_2026-09-30:focus=beersheva')
}

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
