// scripts/tests/raw-store.smoke.mjs — בדיקת עשן ל-extIdOf (המזהה היציב של רשומת CRM גולמית).
// הרצה:  node scripts/tests/raw-store.smoke.mjs
import { extIdOf, vanishedLids } from '../../lib/crm/raw-store.js'
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
// 3.11: LID שנמחק/מוזג ב-BMBY יוצא מהתמונה — רק בתוך הטווח, רק אחרי משיכה מלאה, ולא כשחסרים יותר מדי
{
  const lid = (id, d) => ({ task_id: String(id), type: 'LID', start_date: d + ' 10:00:00', create_date: d + ' 10:14:00' })
  const snap = (id, d) => ({ ext_id: String(id), payload: lid(id, d) })
  const day = { since: '2026-11-02', until: '2026-11-02' }
  const fetched = [1, 2, 3, 4, 5, 6, 7].map(i => lid(i, '2026-11-02'))
  const candidates = [1, 2, 3, 4, 5, 6, 7, 8].map(i => snap(i, '2026-11-02')).concat([snap(9, '2026-11-01')])
  eq('vanished: the LID BMBY no longer returns, only inside the range', vanishedLids(candidates, fetched, day), { ids: ['8'], skipped: null })
  eq('vanished: truncated fetch → nothing', vanishedLids(candidates, fetched, { ...day, truncated: true }).ids, [])
  eq('vanished: empty fetch → nothing', vanishedLids(candidates, [], day).ids, [])
  const many = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => snap(i, '2026-11-02'))
  eq('vanished: too many missing → nothing (suspicious fetch)', [vanishedLids(many, fetched.slice(0, 2), day).ids, !!vanishedLids(many, fetched.slice(0, 2), day).skipped], [[], true])
  eq('vanished: other task types are never pruned', vanishedLids([{ ext_id: '50', payload: { task_id: '50', type: 'appointment', start_date: '2026-11-02 12:00:00' } }], fetched, day).ids, [])
}
if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
