// scripts/tests/onboarding-form.smoke.mjs — שאלון הקליטה ללקוח (lib/onboarding-form.js, 7.11)
import { FORM, visible, cleanAnswers, progress, stepsFromAnswers } from '../../lib/onboarding-form.js'
import { STEP_KEYS } from '../../lib/onboarding-steps.js'

const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log((ok ? '✓ ' : '✗ ') + name + (ok ? '' : `: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`))
  if (!ok) process.exitCode = 1
}
const Q = Object.fromEntries(FORM.flatMap(s => s.questions).map(q => [q.key, q]))

eq('unique question keys', FORM.flatMap(s => s.questions).length, Object.keys(Q).length)
eq('real-estate questions only for real estate', [visible(Q.portals, { biz_type: 'נדל"ן' }), visible(Q.portals, { biz_type: 'רהיטים ועיצוב' }), visible(Q.property_types, {})], [true, false, false])
eq('meta access only when advertising on meta', [visible(Q.meta_done, { channels: ['גוגל'] }), visible(Q.meta_done, { channels: ['פייסבוק ואינסטגרם'] })], [false, true])

const dirty = cleanAnswers({ what: 'x'.repeat(500), hacker: 'drop', crm: 'לא קיים', channels: ['גוגל', 'בדוי'], contacts: [{ name: 'א', role: 'מנהל השיווק', evil: 1 }], meta_done: 'yes' })
eq('clean: unknown keys out, options only, lengths capped, table cols only', [dirty.hacker, dirty.what.length, dirty.crm, dirty.channels, dirty.contacts, dirty.meta_done], [undefined, 300, undefined, ['גוגל'], [{ name: 'א', role: 'מנהל השיווק' }], false])

const a = { biz_type: 'מכשיר רפואי / קוסמטי', what: 'מכשיר', audience: 'כולם', channels: ['פייסבוק ואינסטגרם', 'טיקטוק'], meta_done: true, crm: 'Zoho', crm_api: 'כלולה',
  crm_fields: ['סטטוס ליד'], other_agencies: 'לא', email_sms: 'לא', offline: ['אין'], lead_transfer: 'חיבור ישיר', contacts: [{ role: 'מנהל השיווק', name: 'דנה' }] }
const st = stepsFromAnswers(a)
eq('steps: every key is a real onboarding step', Object.keys(st).filter(k => !STEP_KEYS.has(k)), [])
eq('steps: statuses', [st.assets.status, st.meta_access.status, st.google_access.status, st.social_more.status, st.crm_which.status, st.crm_fields.status, st.portals.status, st.email_sms.status, st.offline.status, st.automation.status, st.other_agencies.status, st.contacts.status],
  ['done', 'doing', 'na', 'todo', 'done', 'doing', 'na', 'na', 'na', 'na', 'na', 'done'])
eq('steps: missing CRM fields listed in the note', /חסרים: .*מזהה מודעה/.test(st.crm_fields.note), true)
eq('steps: no CRM → all CRM steps n/a', ['crm_which', 'crm_api', 'crm_fields', 'crm_key', 'crm_statuses', 'crm_objections'].map(k => stepsFromAnswers({ crm: 'אין' })[k]?.status), Array(6).fill('na'))
eq('steps: empty answers → nothing marked', stepsFromAnswers({}), {})
const p0 = progress({}), p1 = progress(a)
eq('progress: counts visible questions only', [p0.done, p1.done > 5, p1.total !== p0.total], [0, true, true])

// חנות אונליין (WANZOO, 7.11)
const { ECOM_TYPE } = await import('../../lib/onboarding-form.js')
const e = { biz_type: ECOM_TYPE, store_platform: 'WooCommerce', store_key_done: true, crm: 'אין', pixel_events: ['הוספה לסל', 'רכישה'], target_roas: '4', budget: '20000' }
const se = stepsFromAnswers(e)
eq('ecom: store section shown, lead questions hidden', [visible(Q.store_platform, e), visible(Q.store_platform, { biz_type: 'נדל"ן' }), visible(Q.lead_sources, e), visible(Q.first_call, e), visible(Q.target_roas, e)], [true, false, false, false, true])
eq('ecom: steps', [se.crm_which.status, /WooCommerce/.test(se.crm_which.note), se.crm_key.status, se.lead_sources.status, se.meta_tracking.status, se.goals.status, /ROAS: 4/.test(se.goals.note), se.crm_api.status], ['done', true, 'doing', 'na', 'doing', 'done', true, 'na'])

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
