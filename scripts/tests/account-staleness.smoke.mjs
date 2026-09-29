// scripts/tests/account-staleness.smoke.mjs — B14: חיישן חשבון פרסום שנעצר.
// הרצה:  node scripts/tests/account-staleness.smoke.mjs
//
// נבדקת ההכרעה הטהורה בלבד (accountStalenessChecks). הקריאות ל-DB סביבה הן שתי
// שאילתות קריאה, והכיסוי שלהן הוא /api/v1/health מול פרודקשן.
import { accountStalenessChecks } from '../../lib/health-infra.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

const today = '2026-09-29'
const days = (from, to) => { const out = []; for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out }
const fetches = (source, account, from, to) => days(from, to).map(day => ({ source, account, day }))
const run = (coverage, recentFetches, active = true) => accountStalenessChecks({ coverage, recentFetches, today, active })
const statuses = (checks) => checks.map(c => `${c.label}: ${c.status}`)

// תקין — נמשך עד היום ויש נתונים עד היום: אין בדיקה בכלל (הבדיקה לפי מקור כבר ירוקה).
eq('חשבון תקין לא מדווח',
  run([{ source: 'facebook', account: 'A', max_day: '2026-09-29' }], fetches('facebook', 'A', '2026-09-22', '2026-09-29')), [])

// המקרה של 25.9: google 3529349237 — נמשך כל יום, אבל אין הוצאה מאז 12.9.
const quiet = run([{ source: 'google', account: '3529349237', max_day: '2026-09-12' }], fetches('google', '3529349237', '2026-09-22', '2026-09-29'))
eq('שקט 17 יום = צהוב', statuses(quiet), ['חשבון פרסום — google 3529349237: yellow'])
eq('הניסוח אומר מאז מתי ושואל אם מכוון', /מאז 2026-09-12 \(17 ימים\).*מושהים/.test(quiet[0]?.detail || ''), true)

// שקט של יומיים בלבד — עוד לא (אפשר שאתמול פשוט לא הייתה הוצאה).
eq('שקט יומיים לא מדווח',
  run([{ source: 'google', account: 'B', max_day: '2026-09-27' }], fetches('google', 'B', '2026-09-22', '2026-09-29')), [])

// רדום — שקט יותר מ-30 יום, עדיין נמשך: מפסיק להתריע.
eq('רדום מעל 30 יום לא מדווח',
  run([{ source: 'google', account: 'C', max_day: '2026-08-01' }], fetches('google', 'C', '2026-09-22', '2026-09-29')), [])

// הצנרת לא מגיעה לחשבון: נמשך לאחרונה 25.9, והיו לו נתונים עד אז.
const lagging = run([{ source: 'facebook', account: 'D', max_day: '2026-09-25' }], fetches('facebook', 'D', '2026-09-22', '2026-09-25'))
eq('לא נמשך 4 ימים = אדום', statuses(lagging), ['חשבון פרסום — facebook D: red'])
eq('הניסוח אומר מאז מתי', /לא נמשך מאז 2026-09-25 \(4 ימים\)/.test(lagging[0]?.detail || ''), true)

// נמשך עד אתמול בלבד (לפני הריצה הראשונה של היום) — תקין.
eq('נמשך עד אתמול לא מדווח',
  run([{ source: 'facebook', account: 'E', max_day: '2026-09-28' }], fetches('facebook', 'E', '2026-09-22', '2026-09-28')), [])

// לא נמשך כל השבוע, והיו לו נתונים לפני 10 ימים — הוצא בטעות? אדום.
eq('לא נמשך שבוע, פעיל לאחרונה = אדום',
  statuses(run([{ source: 'google', account: 'F', max_day: '2026-09-19' }], [])), ['חשבון פרסום — google F: red'])

// לא נמשך שבוע, ואין לו נתונים 60 יום — הוצא מהמשיכה בכוונה. לא מדווח.
eq('חשבון שהוצא מזמן לא מדווח',
  run([{ source: 'google', account: 'G', max_day: '2026-07-30' }], []), [])

// מחוץ לשעות הפעילות שום דבר לא אדום: לא נמשך = צהוב, שקט = ירוק.
eq('בלילה: לא נמשך = צהוב',
  statuses(run([{ source: 'facebook', account: 'D', max_day: '2026-09-25' }], fetches('facebook', 'D', '2026-09-22', '2026-09-25'), false)), ['חשבון פרסום — facebook D: yellow'])
eq('בלילה: שקט = ירוק',
  statuses(run([{ source: 'google', account: 'H', max_day: '2026-09-12' }], fetches('google', 'H', '2026-09-22', '2026-09-29'), false)), ['חשבון פרסום — google H: green'])

// אותו מזהה בשני מקורות הוא שני חשבונות שונים.
eq('מזהה זהה בשני מקורות לא מתערבב',
  statuses(run(
    [{ source: 'facebook', account: 'X', max_day: '2026-09-29' }, { source: 'google', account: 'X', max_day: '2026-09-10' }],
    [...fetches('facebook', 'X', '2026-09-22', '2026-09-29'), ...fetches('google', 'X', '2026-09-22', '2026-09-29')])),
  ['חשבון פרסום — google X: yellow'])

// תווית שמסווגת כ"מודעות" ב-jobOf של lib/health.js (/פרסום|Meta|Google/) — כדי שההתראה
// תישלח רק כשקרון המודעות עצמו רץ, ולא תיפול לקבוצת ה-CRM.
eq('התווית משויכת לקרון המודעות', /פרסום|Meta|Google/.test(quiet[0]?.label || ''), true)

if (!process.exitCode) console.log('\n✓ חיישן חשבון שנעצר תקין')
