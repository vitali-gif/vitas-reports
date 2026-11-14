// lib/tour-insights.js — "3 דברים שכדאי לראות" (14.11): כללים על מספרים אמיתיים (מנובמבר, בלי פרטי לידים)
import assert from 'node:assert/strict'
import { tourSteps } from '../../lib/tour-insights.js'

const expo = { crmType: 'fireberry', totalLeads: 197, leadsToHandle: 26, relevantLeads: 87, meetingsScheduled: 32, meetingsCancelled: 8,
  hourlyLeadStats: [5,3,1,3,2,4,14,11,8,10,8,6,6,6,11,12,10,9,6,9,15,16,10,12],
  responseTimeStats: { business: { buckets: { '0-15m': 1, '15m-1h': 22, '1h-4h': 58, '4h-8h': 15, '8h-1d': 6, '1d-3d': 1, '3d+': 0 } } } }
const e = tourSteps({ crm: expo, hasTikTok: true })
assert.equal(e.length, 3)
assert.deepEqual(e.map(s => s.id), ['response', 'waiting', 'cancelled'])
assert.match(e[0].text, /רק 1 מתוך 103 .*-8 שעות עבודה/)
assert.deepEqual(e[1].go, { tab: 'all', card: 'ממתינים לטיפול ב-CRM' })

// BMBY בלי crmType בסיכום; לידים לא רלוונטיים
const reh = tourSteps({ crm: { totalLeads: 56, relevantLeads: 15, leadsToHandle: 2, meetingsScheduled: 3, meetingsCancelled: 1,
  responseTimeStats: { business: { buckets: { '0-15m': 2, '1h-4h': 9, '4h-8h': 1, '8h-1d': 2 } } } } })
assert.ok(reh.some(s => s.id === 'relevance' && s.text.includes('15 מתוך 56')))

// Zoho: שעות קלנדריות (לא "שעות עבודה"), ובלי צעדים שאין להם מקום במסך (מכשיר / התנגדויות)
const z = tourSteps({ crm: { crmType: 'zoho', totalLeads: 378, relevantLeads: 366, devices: { 'לא הוצע': 365, 'פרו': 9 }, objections: { 'יקר לי': 9 },
  responseTime: { buckets: { '0-15m': 9, '15m-1h': 13, '1h-4h': 23, '4h-8h': 11, '8h-24h': 29, '1d-3d': 23, '3d+': 10 } } } })
assert.equal(z[0].id, 'response'); assert.ok(!/עבודה/.test(z[0].text))
assert.ok(!z.some(s => ['devices', 'objection'].includes(s.id)))

// Salesforce: מענה תוך שעה + סיבת הפסד
const k = tourSteps({ crm: { crmType: 'salesforce', totalLeads: 472, relevantLeads: 472, responseTime: { measured: 420, within1h: 17 }, lossReasons: [{ reason: 'מחיר', count: 20 }], lossTotal: 33 } })
assert.deepEqual(k.slice(0, 2).map(s => s.id), ['response', 'objection'])
assert.match(k[1].text, /"מחיר" \(20 מתוך 33\)/)

// בלי CRM — רק ההשוואה; שום צעד לא מזכיר שם של אדם
assert.deepEqual(tourSteps({ crm: null }).map(s => s.id), ['compare'])
for (const s of [...e, ...reh, ...z, ...k]) assert.ok(s.text && s.todo && s.go && s.stat)

console.log('✓ tour smoke')
