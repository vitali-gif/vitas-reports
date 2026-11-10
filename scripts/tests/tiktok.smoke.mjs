// TikTok (10.11): שורות יומיות, ניתוב לפרויקט, מפתחות התקופות ו-PDF
import assert from 'node:assert/strict'
import { fetchTikTokDaily } from '../../lib/ads/tiktok-daily.js'
import { tiktokPeriodKeys } from '../../lib/ads/tiktok-reports.js'
import { projectRowFilter } from '../../lib/ads/routing.js'
import { tiktokRow } from '../../lib/ads/range-rows.js'
import { periodFacts } from '../../lib/report-pdf.js'

// 1. מיפוי התשובה של TikTok + דפדוף; result = לידים; שורה ריקה לא נשמרת
const pages = [
  { list: [
    { dimensions: { ad_id: '11', stat_time_day: '2026-11-10 00:00:00' }, metrics: { campaign_name: 'Expo-Haifa-B-InstantForm', adgroup_name: 'G', ad_name: 'B - Video1', spend: '31.01', impressions: '9000', clicks: '30', result: '1' } },
    { dimensions: { ad_id: '12', stat_time_day: '2026-11-10 00:00:00' }, metrics: { campaign_name: 'x', adgroup_name: 'y', ad_name: 'z', spend: '0', impressions: '0', clicks: '0', result: '0' } },
  ], page_info: { total_page: 2 } },
  { list: [{ dimensions: { ad_id: '13', stat_time_day: '2026-11-11 00:00:00' }, metrics: { campaign_name: 'Expo-Haifa-A-LP', adgroup_name: 'G', ad_name: 'A - Video2', spend: '20', impressions: '5000', clicks: '10', result: '0' } }], page_info: { total_page: 2 } },
]
const meta = {
  'ad/get/': { list: [{ ad_id: '11', adgroup_id: '21', campaign_id: '31', operation_status: 'ENABLE' }] },
  'adgroup/get/': { list: [{ adgroup_id: '21', operation_status: 'ENABLE' }] },
  'campaign/get/': { list: [{ campaign_id: '31', operation_status: 'DISABLE' }] },
}
const urls = []
const fake = async (url, init) => {
  urls.push(url); assert.equal(init.headers['Access-Token'], 'T')
  const path = url.split('/open_api/v1.3/')[1].split('?')[0]
  const p = Number(new URL(url).searchParams.get('page'))
  return { status: 200, json: async () => ({ code: 0, data: meta[path] || pages[p - 1] }) }
}
const { rows } = await fetchTikTokDaily('7702455288577998900', '2026-11-10', '2026-11-11', { token: 'T', fetchImpl: fake })
assert.equal(urls.filter(u => u.includes('report/integrated')).length, 2)
assert.equal(rows.length, 2)
assert.deepEqual(rows[0], { source: 'tiktok', account: '7702455288577998900', day: '2026-11-10', campaign_id: '31', campaign: 'Expo-Haifa-B-InstantForm', adset_id: '21', adset: 'G', ad_id: '11', ad: 'B - Video1', spend: 31.01, impressions: 9000, clicks: 30, leads: 1, campaign_status: 'PAUSED', adset_status: 'ACTIVE', ad_status: 'ACTIVE' })
assert.equal(rows[1].campaign_status, '', 'מודעה בלי סטטוס — ריק, לא נופל')
// כשל בסטטוסים לא מפיל את המשיכה
const noMeta = async (url, init) => url.includes('report/integrated') ? fake(url, init) : { status: 200, json: async () => ({ code: 40100, message: 'no scope' }) }
const r2 = await fetchTikTokDaily('7702455288577998900', '2026-11-10', '2026-11-11', { token: 'T', fetchImpl: noMeta })
assert.equal(r2.rows.length, 2); assert.match(String(r2.diag.statuses), /no scope/)
await assert.rejects(() => fetchTikTokDaily('1', '2026-11-10', '2026-11-10', { token: 'T', fetchImpl: async () => ({ status: 200, json: async () => ({ code: 40001, message: 'bad' }) }) }), /TikTok: bad/)

// 2. ניתוב: רק אקספו חיפה, רק החשבון של אלפא
const f = projectRowFilter({ name: 'אקספו חיפה' }, 'tiktok')
assert.ok(f({ account: '7702455288577998900' }))
assert.ok(!f({ account: '7335437259849646081' }), 'בי-קיור לא נמשך לאקספו')
assert.equal(projectRowFilter({ name: 'KLOSS' }, 'tiktok'), null)

// 3. מפתחות: אותו פורמט כמו prefetch-ads; רבעון עתידי לא נכתב
const keys = tiktokPeriodKeys('2026-11-10').map(k => k.key)
for (const k of ['2026-11', '2026-10', '2026-11-10_2026-11-10', '2026-11-01_2026-11-10', '2026-11-09_2026-11-09', '2026-11-03_2026-11-09', '2026-10-27_2026-11-09', '2026-10-11_2026-11-09', '2026-10-01_2026-12-31']) assert.ok(keys.includes(k), k)
assert.ok(tiktokPeriodKeys('2026-05-01').every(k => k.since <= '2026-05-01'))

// 4. שורת דוח + PDF: TikTok נספר בסה"כ ומופיע כערוץ
const tt = tiktokRow({ name: 'אקספו חיפה' }, [{ campaign: 'A', adSet: 'g', adName: 'a', spend: 50, impressions: 1000, reach: 0, clicks: 10, leads: 2, days: 2 }])
assert.equal(tt.summary.spend, 50); assert.equal(tt.summary.cpl, 25); assert.equal(tt.data[0].days, undefined)
const facts = periodFacts([{ source: 'facebook', summary: { spend: 100, leads: 4 } }, { source: 'tiktok', summary: tt.summary, data: tt.data }])
assert.equal(facts.ads.spend, 150); assert.equal(facts.ads.leads, 6); assert.equal(facts.tiktok.spend, 50)
assert.ok(facts.campaigns.some(c => c.platform === 'TikTok'))

console.log('✓ tiktok smoke')
