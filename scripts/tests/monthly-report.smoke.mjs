// scripts/tests/monthly-report.smoke.mjs — הדוח החודשי האוטומטי (29.10): התקופה, "סיכום החודש" בדוח,
// שימוש חוזר בניתוח קיים, והמייל לויטלי. בלי רשת, בלי Claude ובלי Chromium.
// הרצה:  node scripts/tests/monthly-report.smoke.mjs
import { monthKeys, insightsFor, ownerEmailHtml, pdfFileName } from '../../lib/monthly-report.js'
import { buildReportModel, renderReportHtml } from '../../lib/report-pdf.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

eq('5.11 → October vs September', monthKeys(new Date('2026-11-05T05:40:00Z')), { key: '2026-10', prevKey: '2026-09' })
eq('January → December vs November', monthKeys(new Date('2027-01-05T05:40:00Z')), { key: '2026-12', prevKey: '2026-11' })
eq('Israel time: 31.10 23:30 UTC is already November', monthKeys(new Date('2026-10-31T23:30:00Z')), { key: '2026-10', prevKey: '2026-09' })
eq('file name', pdfFileName('HI/PARK', '2026-10'), 'HI PARK - אוקטובר 2026.pdf')

const crm = (leads, meetings) => ({ source: 'crm', summary: { totalLeads: leads, relevantLeads: Math.round(leads * 0.7), meetingsScheduled: meetings, meetingsCompleted: meetings - 2, registrations: 2, contracts: 1 } })
const fb = (spend, leads) => ({ source: 'facebook', summary: { spend, leads, impressions: 1000, clicks: 50 } })
const model = buildReportModel({ project: 'HI PARK', client: 'ש.ברוך', key: '2026-10', prevKey: '2026-09', rows: [crm(140, 30), fb(20000, 120)], prevRows: [crm(160, 26), fb(18000, 130)] })
const result = { headline: 'כותרת פנימית', changes: [], reasons: [{ title: 'השערה פנימית', detail: 'ד', confidence: 'low' }], actions: [], watch: [],
  clientMessage: { whatHappened: 'החודש נכנסו 140 לידים <b>', meaning: 'משמעות', nextStep: 'צעד הבא', onUs: ['נרענן מודעות'], onYou: ['לחזור ללידים'] } }

const plain = renderReportHtml(model)
const withAi = renderReportHtml(model, { insights: result })
const at = (s) => withAi.indexOf(s)
eq('no analysis → no summary section', plain.includes('<section class="ins">'), false)
eq('summary: after the cards, before the funnel', [at('<section class="ins">') > at('עלות לליד'), at('<section class="ins">') < at('משפך לידים')], [true, true])
eq('summary: client message only, escaped', [withAi.includes('נכנסו 140 לידים &lt;b&gt;'), withAi.includes('מה נדרש מכם'), withAi.includes('לחזור ללידים'), withAi.includes('השערה פנימית'), withAi.includes('כותרת פנימית')], [true, true, true, false, false])
eq('old analysis without clientMessage → no section', renderReportHtml(model, { insights: { headline: 'x' } }).includes('<section class="ins">'), false)
eq('full months: no "same days" note', withAi.includes('אותם ימים בחודש הקודם'), false)

// sb מדומה: שאילתה שרשרתית שמחזירה את מה שהוגדר
const fakeSb = (rows) => ({ from: () => { const q = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: rows }), insert: async () => ({ error: null }) }; return q } })
const reused = await insightsFor(fakeSb([{ id: 'old', result: { headline: 'בלי הודעה' } }, { id: 'a1', result }]), 'p1', model)
eq('reuses the latest saved analysis that has a client message', [reused.reused, reused.analysis.id, reused.costUsd], [true, 'a1', 0])
const keep = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY
const noKey = await insightsFor(fakeSb([]), 'p1', model)
eq('no saved analysis and no key → error, not a crash', [!!noKey.error, noKey.code], [true, 'NO_KEY'])
if (keep) process.env.ANTHROPIC_API_KEY = keep

const mail = ownerEmailHtml({ project: 'HI PARK', client: 'ש.ברוך', key: '2026-10', prevKey: '2026-09', ai: reused, dashboardUrl: 'https://reports.vitas.co.il/admin' })
eq('owner email: client message + internal analysis, says the client did not get it', [mail.includes('לחזור ללידים'), mail.includes('השערה פנימית'), mail.includes('הלקוח עוד לא קיבל')], [true, true, true])
eq('owner email: AI failure is stated', ownerEmailHtml({ project: 'X', key: '2026-10', prevKey: '2026-09', ai: { error: 'NO_KEY' } }).includes('ניתוח ה-AI נכשל'), true)

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
