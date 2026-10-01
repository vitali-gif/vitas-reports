// scripts/tests/fireberry-notes-plan.smoke.mjs — סדר בדיקת ההערות בפיירברי (T9).
// הרצה:  node scripts/tests/fireberry-notes-plan.smoke.mjs
import { planNoteChecks, tierFor } from '../../lib/crm/fireberry-notes-plan.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

const now = Date.parse('2026-10-01T12:00:00Z')
const H = 3600000, D = 24 * H
const iso = (t) => new Date(t).toISOString()
const fb = (t) => iso(t).replace('T', ' ').slice(0, 19)   // הפורמט של Fireberry: "YYYY-MM-DD HH:MM:SS"

eq('tiers by age', [tierFor(fb(now - 2 * H), now).key, tierFor(fb(now - 3 * D), now).key, tierFor(fb(now - 20 * D), now).key, tierFor(fb(now - 90 * D), now).key, tierFor('', now).key], ['day', 'week', 'month', 'old', 'old'])

const leads = [
  { accountid: 'new-never',   createdon: fb(now - 1 * H) },
  { accountid: 'old-never',   createdon: fb(now - 40 * D) },
  { accountid: 'day-fresh',   createdon: fb(now - 5 * H) },    // נבדק לפני שעה — לא בתור
  { accountid: 'day-due',     createdon: fb(now - 10 * H) },   // נבדק לפני 6 ש' (תדירות 4) → 1.5
  { accountid: 'week-due',    createdon: fb(now - 4 * D) },    // נבדק לפני 30 ש' (24) → 1.25
  { accountid: 'month-due',   createdon: fb(now - 20 * D) },   // נבדק לפני 10 ימים (7) → 1.43
  { accountid: 'month-fresh', createdon: fb(now - 20 * D) },   // נבדק לפני 3 ימים — לא בתור
  { accountid: 'old-due',     createdon: fb(now - 200 * D) },  // נבדק לפני 60 ימים (30) → 2
  { accountid: 'old-fresh',   createdon: fb(now - 200 * D) },  // נבדק לפני 10 ימים — לא בתור
  { accountid: '',            createdon: fb(now) },             // בלי מזהה — מדולג
]
const index = new Map([
  ['day-fresh',   { checkedAt: iso(now - 1 * H) }],
  ['day-due',     { checkedAt: iso(now - 6 * H) }],
  ['week-due',    { checkedAt: iso(now - 30 * H) }],
  ['month-due',   { checkedAt: iso(now - 10 * D) }],
  ['month-fresh', { checkedAt: iso(now - 3 * D) }],
  ['old-due',     { checkedAt: iso(now - 60 * D) }],
  ['old-fresh',   { checkedAt: iso(now - 10 * D) }],
])
const { todo, stats } = planNoteChecks(leads, index, now)
// ציון = איחור יחסי × משקל: day-due 1.5×4=6, week-due 1.25×2=2.5, old-due 2×1=2, month-due 1.43×1
eq('never-checked first (newest first), then by weighted overdue',
  todo.map(l => l.accountid), ['new-never', 'old-never', 'day-due', 'week-due', 'old-due', 'month-due'])
eq('stats per tier', stats, { neverChecked: 2, due: { day: 1, week: 1, month: 1, old: 1 } })
eq('old leads are rechecked at all (the T9 gap)', todo.some(l => l.accountid === 'old-due'), true)

// לפני T9 הליד הישן נשאר מחוץ לתור לתמיד; ליד עם checkedAt פגום לא נתקע.
const broken = planNoteChecks([{ accountid: 'x', createdon: fb(now - 2 * D) }], new Map([['x', { checkedAt: 'garbage' }]]), now)
eq('bad checkedAt → due', broken.todo.length, 1)

if (process.exitCode) console.error('\nבדיקת העשן נכשלה'); else console.log('\n✓ בדיקת העשן עברה')
