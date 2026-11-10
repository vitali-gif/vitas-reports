// TikTok (10.11): שורות יומיות, ניתוב לפרויקט, מפתחות התקופות ו-PDF
import assert from 'node:assert/strict'
import { fetchTikTokDaily } from '../../lib/ads/tiktok-daily.js'
import { tiktokPeriodKeys } from '../../lib/ads/tiktok-reports.js'
import { projectRowFilter } from '../../lib/ads/routing.js'
import { tiktokRow } from '../../lib/ads/range-rows.js'
import { periodFacts } from '../../lib/report-pdf.js'
import { tiktokInsights, tiktokAdMedia } from '../../lib/ads/tiktok-insights.js'

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

// 5. insights: מדד לא נתמך → נפילה לרשימה מצומצמת; קהל; כשל בחלק אחד לא מפיל את השאר
const insFetch = async (url) => {
  const u = new URL(url), q = u.searchParams, metrics = JSON.parse(q.get('metrics') || '[]'), dims = JSON.parse(q.get('dimensions') || '[]')
  const ok = (data) => ({ status: 200, json: async () => ({ code: 0, data }) })
  if (q.get('report_type') === 'AUDIENCE') {
    if (dims.includes('province_id')) return { status: 200, json: async () => ({ code: 40002, message: 'bad dim' }) }
    return ok({ list: [{ dimensions: { [dims[0]]: dims[0] === 'gender' ? 'FEMALE' : 'AGE_25_34' }, metrics: { spend: '10', impressions: '100', clicks: '3', conversion: '1' } }] })
  }
  if (q.get('data_level') === 'AUCTION_ADVERTISER') return ok({ list: [{ metrics: { reach: '900', frequency: '1.5', impressions: '1350' } }] })
  if (metrics.includes('likes')) return { status: 200, json: async () => ({ code: 40002, message: 'invalid metric likes' }) }
  return ok({ list: [{ dimensions: { ad_id: '11' }, metrics: { ad_name: 'B - Video1', campaign_name: 'C', adgroup_name: 'G', spend: '30', impressions: '1000', clicks: '5', result: '1', reach: '800', video_play_actions: '900', video_watched_2s: '400', video_watched_6s: '200', video_views_p25: '300', video_views_p50: '150', video_views_p75: '90', video_views_p100: '40', average_video_play: '4.2' } }] })
}
const ins = await tiktokInsights('1', '2026-11-01', '2026-11-10', { token: 'T', fetchImpl: insFetch })
assert.equal(ins.adStats.length, 1); assert.equal(ins.adStats[0].leads, 1); assert.equal(ins.adStats[0].video_watched_2s, 400); assert.equal(ins.adStats[0].likes, undefined)
assert.equal(ins.account.reach, 900)
assert.equal(ins.audience.gender[0].key, 'FEMALE'); assert.equal(ins.audience.age[0].key, 'AGE_25_34')
assert.deepEqual(ins.audience.region, []); assert.ok(ins.errors.region)
const med = await tiktokAdMedia('1', 'T', async (url) => ({ status: 200, json: async () => ({ code: 0, data: url.includes('ad/get') ? { list: [{ ad_id: '11', video_id: 'v1' }, { ad_id: '12', tiktok_item_id: '777' }] } : { list: [{ video_id: 'v1', video_cover_url: 'https://c/1.jpg', preview_url: 'https://p/1.mp4' }] } }) }))
assert.equal(med['11'].cover, 'https://c/1.jpg'); assert.equal(med['12'].itemId, '777')

console.log('✓ tiktok smoke')
