// scripts/tests/fireberry-health.smoke.mjs — T8: חיישן שבירה שקטה בפיירברי.
// הרצה:  node scripts/tests/fireberry-health.smoke.mjs
//
// שני התרחישים שהחיישן נועד לתפוס, ומה שאסור לו להתריע עליו. הקריאות ל-DB סביבו
// (lib/health-infra.js) הן שתי שאילתות קריאה, והכיסוי שלהן הוא /api/v1/health.
import { fireberryHealthChecks } from '../../lib/health-infra.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))
const statuses = (cs) => cs.map(c => `${c.label.split(' · ')[1]}: ${c.status}`)

// ליד כמו אצל אלפא, ו-3 ההערות האוטומטיות שנמדדו ב-28.9: שתיים ברגע היצירה עם שם
// הליד, ואחת עם טלפון בלבד. ואחריהן הערה אנושית, `humanAfterMin` דקות אחרי היצירה.
const lead = (i, over = {}) => ({
  accountid: 'L' + i, accountname: 'ישראל ישראלי ' + i, createdon: '2026-09-28T10:00:00',
  statuscode: 'אין מענה', ownername: 'משי אלפא', originatingleadcode: 'פייסבוק', pcfsystemfield185: 'Expo-9/2026', ...over,
})
const at = (min) => { const d = new Date(Date.UTC(2026, 8, 28, 10, 0, 0) + min * 60000); return d.toISOString().slice(0, 19) }
const notesFor = (l, { humanAfterMin = 45, autoText } = {}) => [
  { objectid: l.accountid, text: autoText ?? l.accountname, createdon: at(0) },
  { objectid: l.accountid, text: autoText ?? l.accountname, createdon: at(0) },
  { objectid: l.accountid, text: autoText ?? '0537618235', createdon: at(0.2) },
  ...(humanAfterMin === null ? [] : [{ objectid: l.accountid, text: 'אין מענה, ננסה שוב מחר', createdon: at(humanAfterMin) }]),
]
const run = (leads, notes, active = true) => fireberryHealthChecks({ name: 'אקספו חיפה', leads, notes, active })

// ── מצב תקין, כמו היום ────────────────────────────────────────────────────────
const L = Array.from({ length: 20 }, (_, i) => lead(i))
const N = L.flatMap((l, i) => notesFor(l, { humanAfterMin: i % 4 === 0 ? null : 30 + i * 20 }))
eq('תקין: שני הבדיקות ירוקות', statuses(run(L, N)), ['זמני תגובה: green', 'שדות: green'])

// ── 1. האוטומציה שינתה נוסח: "ליד חדש נכנס" במקום שם הליד ─────────────────────
// isHumanNote כבר לא מזהה אותה, והיא נספרת כתגובה תוך 0 דקות.
const N1 = L.flatMap((l) => notesFor(l, { autoText: 'ליד חדש נכנס למערכת' }))
const c1 = run(L, N1)
eq('נוסח אוטומציה חדש = אדום', statuses(c1)[0], 'זמני תגובה: red')
eq('הפירוט אומר כמה ומה לבדוק', /20 מתוך 20 .*isHumanNote/.test(c1[0].detail), true)

// שתי תגובות מהירות אמיתיות מתוך 15 — לא התראה (אנשים לפעמים עונים מהר).
const N1b = L.slice(0, 15).flatMap((l, i) => notesFor(l, { humanAfterMin: i < 2 ? 0.5 : 40 }))
eq('מעט תגובות מהירות אמיתיות = ירוק', statuses(run(L.slice(0, 15), N1b))[0], 'זמני תגובה: green')

// ── 2. שדה נוצר מחדש: pcfsystemfield185 מפסיק להתמלא ──────────────────────────
const L2 = L.map(l => ({ ...l, pcfsystemfield185: '' }))
const c2 = run(L2, N)
eq('שדה קמפיין שהתרוקן = אדום', statuses(c2)[1], 'שדות: red')
eq('הפירוט נוקב בשדה', /שם קמפיין \(pcfsystemfield185\): 0\/20/.test(c2[1].detail), true)

// 93% מלא, כמו מקור ההגעה היום — תקין.
const L2b = L.map((l, i) => (i < 2 ? { ...l, originatingleadcode: null } : l))
eq('מקור חסר ב-2 מתוך 20 = ירוק', statuses(run(L2b, N))[1], 'שדות: green')

// ── לא מספיק נתונים — לא אומרים כלום ─────────────────────────────────────────
eq('פחות מ-10 לידים: בלי בדיקת שדות', run(L2.slice(0, 5), notesFor(L2[0])).map(c => c.label.split(' · ')[1]), [])
eq('פחות מ-5 תגובות: בלי בדיקת זמנים', run(L.slice(0, 12), L.slice(0, 3).flatMap(l => notesFor(l, { autoText: 'x' }))).map(c => c.label.split(' · ')[1]), ['שדות'])

// ── מחוץ לשעות הפעילות: צהוב במקום אדום ──────────────────────────────────────
eq('בלילה: שבירה = צהוב', statuses(run(L2, N, false))[1], 'שדות: yellow')

// הערה שנכתבה לפני יצירת הליד (סנכרון מאוחר) אינה תגובה — כמו בחישוב עצמו.
const early = L.slice(0, 10).flatMap(l => [{ objectid: l.accountid, text: 'הערה ישנה', createdon: '2026-09-27T09:00:00' }, ...notesFor(l)])
eq('הערה מלפני הליד לא נחשבת', statuses(run(L.slice(0, 10), early))[0], 'זמני תגובה: green')

if (!process.exitCode) console.log('\n✓ חיישן פיירברי תקין')
