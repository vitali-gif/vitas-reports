// scripts/tests/raw-store.smoke.mjs — בדיקת עשן ל-extIdOf (המזהה היציב של רשומת CRM גולמית).
// הרצה:  node scripts/tests/raw-store.smoke.mjs
import { extIdOf } from '../../lib/crm/raw-store.js'
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

eq('clients keyed by client_id', extIdOf('clients', { client_id: '42', name: 'x' }), { id: '42', field: 'client_id' })
eq('tasks prefer task_id', extIdOf('tasks', { task_id: '7', id: '9' }), { id: '7', field: 'task_id' })
eq('tasks fall back to id', extIdOf('tasks', { id: '9' }), { id: '9', field: 'id' })
const t1 = { client_id: '1', type: 'appointment', create_date: '2026-09-11 12:00:00', start_date: '2026-09-14 17:00:00', subject: 'פגישה', status: 'open' }
const t2 = { ...t1, status: 'done', message: 'התקיימה' }   // אותה פגישה, סטטוס השתנה
const h1 = extIdOf('tasks', t1), h2 = extIdOf('tasks', t2)
eq('no id → stable hash, unaffected by mutable fields', [h1.field, h1.id === h2.id, h1.id.startsWith('h:')], [null, true, true])
eq('different task → different hash', extIdOf('tasks', { ...t1, create_date: '2026-09-12 08:00:00' }).id !== h1.id, true)
eq('empty id string is ignored', extIdOf('contracts', { contract_id: ' ', client_id: '3', agreement_date: '2026-09-13' }).field, null)
if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
