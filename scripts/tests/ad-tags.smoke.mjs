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

const m = buildReportModel({ project: 'x', key: '2026-10', prevKey: '2026-09', rows, prevRows: [], adTags: tags })
const h = renderReportHtml(m)
eq('pdf: section with best marked', [h.includes('מה עובד במודעות'), h.includes('עם אנשים'), h.includes('הכי טוב')], [true, true, true])
eq('pdf without tags: no section', renderReportHtml(buildReportModel({ project: 'x', key: '2026-10', prevKey: '2026-09', rows, prevRows: [] })).includes('מה עובד במודעות'), false)
const inp = analysisInput(m)
eq('ai input carries the groups', [inp.creativeTests.length > 0, inp.creativeTests[0].groups[0].value.length > 0], [true, true])

// הסיווג: הבקשה למודל
let sent = null
const mock = { beta: { messages: { create: async (req) => { sent = req; return { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ people: 'with', visual: 'lifestyle', property: 'garden', price: 'shown', color: 'warm', angle: 'lifestyle' }) }] } } } } }
const r = await tagCreative(mock, { imageUrl: 'https://x/y.jpg', title: 'דירות גן', body: 'החל מ-2.9 מיליון', adName: 'ad' })
eq('tag: image by URL + text, structured output, low effort', [sent.messages[0].content[0].source.url, sent.output_config.format.schema === TAG_SCHEMA, sent.output_config.effort, r.tags.property], ['https://x/y.jpg', true, 'low', 'garden'])

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
