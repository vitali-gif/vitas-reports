// scripts/tests/ad-tags.smoke.mjs — "מה עובד במודעות" (lib/ad-tags.js) + הסעיף בדוח ובקלט הניתוח
import { creativeTests, adsFromRows, TAG_SCHEMA, tagCreative } from '../../lib/ad-tags.js'
import { buildReportModel, renderReportHtml } from '../../lib/report-pdf.js'
import { analysisInput } from '../../lib/ai-analysis.js'

const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log((ok ? '✓ ' : '✗ ') + name + (ok ? '' : `: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`))
  if (!ok) process.exitCode = 1
}
const T = (people, price, property = 'regular') => ({ tags: { people, visual: 'interior_render', property, price, color: 'light', angle: 'price_offer' }, is_video: false })
const rows = [{ source: 'facebook', summary: { activeAds: [{ id: '4', videoId: 'v1' }] }, data: [
  { adId: '1', adName: 'א', spend: 1000, impressions: 50000, clicks: 500, leads: 20 },
  { adId: '2', adName: 'ב', spend: 1000, impressions: 40000, clicks: 300, leads: 10 },
  { adId: '3', adName: 'ג', spend: 500, impressions: 20000, clicks: 200, leads: 5 },
  { adId: '4', adName: 'ד', spend: 500, impressions: 30000, clicks: 300, leads: 15 },
  { adId: '5', adName: 'ה', spend: 0, impressions: 0, clicks: 0, leads: 0 },
] }]
const ads = adsFromRows(rows)
eq('ads from report rows, video flag from activeAds', [ads.length, ads.find(a => a.adId === '4').isVideo], [5, true])
const tags = { 1: T('with', 'shown'), 2: T('without', 'shown'), 3: T('without', 'not_shown', 'none'), 4: T('with', 'not_shown', 'penthouse') }
const tests = creativeTests(ads, tags)
const people = tests.find(t => t.key === 'people')
eq('people: with (₪40/lead) beats without (₪100/lead), sorted by CPL', people.groups.map(g => [g.label, g.ads, Math.round(g.cpl)]), [['עם אנשים', 2, 43], ['בלי אנשים', 2, 100]])
eq('people: CTR and CPC per group', [people.groups[0].ctr.toFixed(2), Math.round(people.groups[0].cpc)], ['1.00', 2])
eq('property: "none" left out, penthouse vs regular', tests.find(t => t.key === 'property').groups.map(g => g.label).sort(), ['דירה רגילה', 'פנטהאוז'])
eq('format: video vs image from activeAds', tests.find(t => t.key === 'format').groups.map(g => g.label).sort(), ['סרטון', 'תמונה'])
eq('indicative when a group has under 10 leads', tests.find(t => t.key === 'price').indicative, false)
eq('one value only (all light, all interior) → not compared', [tests.some(t => t.key === 'color'), tests.some(t => t.key === 'visual')], [false, false])
eq('no tags → nothing', creativeTests(ads, {}), [])
const t2 = creativeTests(ads, { ...tags, 1: { tags: { ...tags[1].tags, fromTextOnly: true }, is_video: false }, 5: { tags: { unavailable: true }, is_video: false } })
eq('text-only ad left out of people, kept in price; unavailable ignored', [t2.find(t => t.key === 'people')?.groups.reduce((a, g) => a + g.ads, 0), t2.find(t => t.key === 'price').groups.reduce((a, g) => a + g.ads, 0)], [3, 4])

const m = buildReportModel({ project: 'x', key: '2026-10', prevKey: '2026-09', rows, prevRows: [], adTags: tags })
const h = renderReportHtml(m)
eq('pdf: section with best marked', [h.includes('מה עובד במודעות'), h.includes('עם אנשים'), h.includes('הכי טוב')], [true, true, true])
eq('pdf without tags: no section', renderReportHtml(buildReportModel({ project: 'x', key: '2026-10', prevKey: '2026-09', rows, prevRows: [] })).includes('מה עובד במודעות'), false)
const inp = analysisInput(m)
eq('ai input carries the groups', [inp.creativeTests.length > 0, inp.creativeTests[0].groups[0].value.length > 0], [true, true])

// פגישות מה-CRM (adBreakdown לפי מזהה מודעה): עמודות פגישות ועלות לפגישה, ודירוג לפי עלות לפגישה כשיש מספיק
const crm = (list) => ({ source: 'crm', summary: { adBreakdown: list } })
const rowsM = [...rows, crm([{ adId: '\u200f1', meetings: 2 }, { adId: '2', meetings: 6 }, { adId: '2', meetings: 2 }, { adId: '3', meetings: 1 }, { adId: '4', meetings: 3 }])]
const adsM = adsFromRows(rowsM)
eq('meetings joined by ad id (RTL marks stripped, nodes summed)', ['1', '2', '3', '4', '5'].map(id => adsM.find(a => a.adId === id).meetings), [2, 8, 1, 3, 0])
eq('no CRM ad ids → meetings null', adsFromRows([...rows, crm([{ ad: 'x', meetings: 4 }])])[0].meetings, null)
const pm = creativeTests(adsM, tags).find(t => t.key === 'people')
// עם אנשים: 1500₪, 35 לידים, 5 פגישות (300₪) · בלי אנשים: 1500₪, 15 לידים, 9 פגישות (167₪)
eq('people ranked by cost per meeting: without wins despite pricier leads', [pm.rankBy, pm.groups.map(g => [g.label, g.meetings, Math.round(g.cpm)])], ['meeting', [['בלי אנשים', 9, 167], ['עם אנשים', 5, 300]]])
eq('few meetings in a dimension → ranked by lead', creativeTests(adsFromRows([...rows, crm([{ adId: '1', meetings: 1 }, { adId: '2', meetings: 1 }])]), tags).find(t => t.key === 'people').rankBy, 'lead')
eq('no CRM → hasMeetings false, meetings null', [people.hasMeetings, people.groups[0].meetings], [false, null])
const hM = renderReportHtml(buildReportModel({ project: 'x', key: '2026-10', prevKey: '2026-09', rows: rowsM, prevRows: [], adTags: tags }))
eq('pdf: leads + meetings columns', [hM.includes('עלות לפגישה'), hM.includes('>לידים<'), h.includes('עלות לפגישה'), h.includes('>לידים<')], [true, true, false, true])
eq('ai input: meetings when present', [analysisInput(buildReportModel({ project: 'x', key: '2026-10', prevKey: '2026-09', rows: rowsM, prevRows: [], adTags: tags })).creativeTests.find(t => t.attribute === 'אנשים בתמונה').groups[0].meetings, inp.creativeTests[0].groups[0].meetings], [9, undefined])

// הסיווג: הבקשה למודל
let sent = null
const mock = { beta: { messages: { create: async (req) => { sent = req; return { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ people: 'with', visual: 'lifestyle', property: 'garden', price: 'shown', color: 'warm', angle: 'lifestyle' }) }] } } } } }
const r = await tagCreative(mock, { imageUrl: 'https://x/y.jpg', title: 'דירות גן', body: 'החל מ-2.9 מיליון', adName: 'ad' })
eq('tag: image by URL + text, structured output, low effort', [sent.messages[0].content[0].source.url, sent.output_config.format.schema === TAG_SCHEMA, sent.output_config.effort, r.tags.property], ['https://x/y.jpg', true, 'low', 'garden'])

// תמונה כקובץ (קישורים של פייסבוק חסומים לשליפה של Anthropic)
const { fetchImage } = await import('../../lib/ad-tags.js')
const fakeFetch = (type, bytes = 10) => async () => ({ ok: true, headers: { get: () => type }, arrayBuffer: async () => new Uint8Array(bytes).buffer })
eq('fetchImage: jpeg → base64, html → null, bad url → null', [(await fetchImage('https://x/a.jpg', { fetchImpl: fakeFetch('image/jpeg') }))?.media_type, await fetchImage('https://x/a', { fetchImpl: fakeFetch('text/html') }), await fetchImage('ftp://x')], ['image/jpeg', null, null])
await tagCreative(mock, { image: { media_type: 'image/png', data: 'AAAA' }, title: 't' })
eq('tag: image sent as base64 when downloaded', [sent.messages[0].content[0].source.type, sent.messages[0].content[0].source.media_type], ['base64', 'image/png'])

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
