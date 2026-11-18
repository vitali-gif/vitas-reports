// lib/tour-insights.js — "3 דברים שכדאי לראות" (14.11): כללים על מספרים אמיתיים (מנובמבר, בלי פרטי לידים)
import assert from 'node:assert/strict'
import { tourSteps } from '../../lib/tour-insights.js'

const expo = { crmType: 'fireberry', totalLeads: 197, leadsToHandle: 26, relevantLeads: 87, meetingsScheduled: 32, meetingsCancelled: 8,
  hourlyLeadStats: [5,3,1,3,2,4,14,11,8,10,8,6,6,6,11,12,10,9,6,9,15,16,10,12],
  responseTimeStats: { business: { buckets: { '0-15m': 1, '15m-1h': 22, '1h-4h': 58, '4h-8h': 15, '8h-1d': 6, '1d-3d': 1, '3d+': 0 } } } }
const e = tourSteps({ crm: expo })
assert.equal(e.length, 3)
assert.deepEqual(e.map(s => s.id), ['response', 'waiting', 'cancelled'])
assert.match(e[0].text, /רק 1 מתוך 103 .*-8 שעות עבודה/)
assert.deepEqual(e[1].go, { tab: 'all', card: 'ממתינים לטיפול ב-CRM' })

// BMBY בלי crmType בסיכום; לידים לא רלוונטיים
const reh = tourSteps({ crm: { totalLeads: 56, relevantLeads: 15, leadsToHandle: 2, meetingsScheduled: 3, meetingsCancelled: 1,
  responseTimeStats: { business: { buckets: { '0-15m': 2, '1h-4h': 9, '4h-8h': 1, '8h-1d': 2 } } } } })
assert.ok(reh.some(s => s.id === 'relevance' && s.text.includes('15 מתוך 56')))

// Zoho: שעות קלנדריות (לא "שעות עבודה"); מכשיר והתנגדות נוחתים על החלקים החדשים בטאב ה-CRM (18.11)
// Zoho (אריקה כרמל, 18.11): סיור מלא מהכסף ועד המכירה, עם הערות על שדות שלא מתמלאים
const zs = { crmType: 'zoho', totalLeads: 550, devices: { 'לא הוצע': 532, 'פרו': 13, 'פלוס': 3 },
  objections: { 'אחר': 1, 'יקר לי': 13, 'התייעצות עם רופא': 2 },
  responseTime: { noResponseCount: 357, buckets: { '0-15m': 12, '15m-1h': 18, '1h-4h': 33, '4h-8h': 17, '8h-24h': 52, '1d-3d': 44, '3d+': 17 } },
  funnel: { leads: 550, purchased: 168, netRevenue: 248152, leadsNotConverted: 240, byChannel: [
    { channel: 'google', leads: 282, purchased: 99, netRevenue: 150284, conversionRate: 35.1, campaigns: [{ campaign: 'Brand-Search', purchased: 58 }, { campaign: '123456', purchased: 70 }] },
    { channel: 'facebook', leads: 183, purchased: 44, netRevenue: 59998, conversionRate: 24, campaigns: [] },
    { channel: 'אתר חברה', leads: 58, purchased: 20, netRevenue: 29910, conversionRate: 34.5, campaigns: [] },
    { channel: 'וואטסאפ', leads: 27, purchased: 5, netRevenue: 7960, conversionRate: 18.5, campaigns: [] }] },
  agentPerformance: [{ agent: 'א', leads: 94, purchased: 44 }, { agent: 'ב', leads: 45, purchased: 4 }, { agent: 'ג', leads: 37, purchased: 0 }] }
const creative = { dim: 'אנשים בתמונה', best: { label: 'עם אנשים', cpp: 800 }, other: { label: 'בלי אנשים', cpp: 1874 }, cost: 'cpp', costLabel: 'עלות לרכישה', gap: 57 }
const z = tourSteps({ crm: zs, spend: { facebook: 30623, google: 43455 }, creative })
assert.deepEqual(z.map(s => s.id), ['z-bottom', 'z-channels', 'z-drill', 'z-creative', 'z-agents', 'z-response', 'z-devices', 'z-objection', 'z-tools'])
assert.match(z[1].text, /Google עלות לרכישה ₪439/); assert.match(z[1].text, /Facebook עלות לרכישה ₪696/)
assert.match(z[2].text, /Google/); assert.match(z[2].text, /Brand-Search/); assert.ok(!/123456/.test(z[2].text)); assert.ok(z[2].go.interact)
assert.match(z[4].stat, /47%↔9%/); assert.ok(!/\bא\b|\bב\b/.test(z[4].text))
assert.ok(z[5].note && /357/.test(z[5].note.text)); assert.ok(z[6].note && z[6].note.loss)
assert.ok(z[7].note && /16 מתוך 240/.test(z[7].note.text)); assert.match(z[7].text, /יקר לי.*התייעצות עם רופא/)
assert.ok(!z[0].note && !z[1].note)
// ISMOOTH: Google מוציא יותר ממה שמכר — הממצא נכנס (ויטלי אישר)
const zi = tourSteps({ crm: { crmType: 'zoho', totalLeads: 70, funnel: { leads: 70, purchased: 11, netRevenue: 12400, byChannel: [
  { channel: 'google', leads: 39, purchased: 3, netRevenue: 3798, conversionRate: 7.7, campaigns: [] },
  { channel: 'facebook', leads: 17, purchased: 5, netRevenue: 4997, conversionRate: 29, campaigns: [] }] } }, spend: { facebook: 6144, google: 18638 } })
assert.match(zi.find(s => s.id === 'z-channels').text, /ב-Google ההוצאה \(₪18\.6 אלף\) עדיין גבוהה/)
assert.equal(zi.at(-1).id, 'z-tools')

// Salesforce: מענה תוך שעה + סיבת הפסד
const k = tourSteps({ crm: { crmType: 'salesforce', totalLeads: 472, relevantLeads: 472, responseTime: { measured: 420, within1h: 17 }, lossReasons: [{ reason: 'מחיר', count: 20 }], lossTotal: 33 } })
assert.deepEqual(k.slice(0, 2).map(s => s.id), ['response', 'objection'])
assert.equal(k[0].go.sfTab, 'timing'); assert.equal(k[1].go.sfTab, 'branches')
// KLOSS: הצעות מחיר שלא נסגרו + פער סניפים (סניף מעל 100% לא בהשוואה)
const k2 = tourSteps({ crm: { crmType: 'salesforce', totalLeads: 600, funnelCohort: { quotes: 80, paid: 22 },
  byBranch: { 'נתניה': { leads: 69, opportunities: 62 }, 'באר שבע': { leads: 91, opportunities: 33 }, 'רדיזיין': { leads: 100, opportunities: 128 }, 'לא ידוע': { leads: 2, opportunities: 0 } } } })
assert.deepEqual(k2.map(s => s.id).sort(), ['branches', 'compare', 'quotes'])
assert.match(k2.find(s => s.id === 'branches').text, /נתניה 90%.*באר שבע 36%/)
// BMBY: המקור עם הכי הרבה פגישות
const b = tourSteps({ crm: { crmType: 'bmby', totalLeads: 10, relevantLeads: 9, sources: { 'yad2': { totalLeads: 13, meetingsScheduled: 4 }, 'אתר': { totalLeads: 35, meetingsScheduled: 0 } } }, max: 3 })
assert.ok(b.some(s => s.id === 'bestsource' && s.text.includes('"yad2" (4 מתוך 4 פגישות, מ-13 לידים)')))
// TikTok: צעד נוסף בסוף, לא במקום ממצא
assert.deepEqual(tourSteps({ crm: expo, hasTikTok: true }).map(s => s.id), ['response', 'waiting', 'cancelled', 'tiktok'])
assert.match(k[1].text, /"מחיר" \(20 מתוך 33\)/)

// בלי CRM — רק ההשוואה; שום צעד לא מזכיר שם של אדם
assert.deepEqual(tourSteps({ crm: null }).map(s => s.id), ['compare'])
for (const s of [...e, ...reh, ...z, ...k]) assert.ok(s.text && s.todo && s.go && s.stat)

console.log('✓ tour smoke')
