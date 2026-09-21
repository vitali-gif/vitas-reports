// scripts/tests/plan-gate.smoke.mjs — בדיקת עשן לשער המנוי (PRO).
// הרצה:  node scripts/tests/plan-gate.smoke.mjs
//
// מה נבדק כאן: ההכרעה הטהורה בלבד — normalizePlan ו-planAllows. הן הלב של השער,
// והן גם המקום שקל הכי הרבה לטעות בו: ערך לא צפוי בעמודה (NULL, 'Pro', 'premium',
// מחרוזת ריקה) חייב ליפול ל-basic ולא לפתוח את הפיצ'ר.
//
// מה לא נבדק כאן: projectPlan ו-requireProjectPlan — שתיהן פונות ל-DB ול-JWT, וכל
// stub שלהן היה בודק את ה-stub. הכיסוי שלהן הוא e2e מול פרודקשן.
import { normalizePlan, planAllows } from '../../lib/auth.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (a === b ? console.log('✓ ' + label) : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

// ── נרמול: כל מה שאינו 'pro' הוא 'basic' ─────────────────────────────────────
eq('pro',            normalizePlan('pro'), 'pro')
eq('PRO',            normalizePlan('PRO'), 'pro')
eq('רווח מסביב',     normalizePlan('  Pro '), 'pro')
eq('basic',          normalizePlan('basic'), 'basic')
eq('null',           normalizePlan(null), 'basic')
eq('undefined',      normalizePlan(undefined), 'basic')
eq('מחרוזת ריקה',    normalizePlan(''), 'basic')
eq('premium אינו pro', normalizePlan('premium'), 'basic')
eq('ערך מספרי',      normalizePlan(1), 'basic')
// ⚠️ true אינו מנוי. אם מישהו יחליף את העמודה ל-boolean, השער חייב להיסגר ולא להיפתח.
eq('boolean',        normalizePlan(true), 'basic')

// ── ההכרעה ───────────────────────────────────────────────────────────────────
eq('pro עובר pro',       planAllows('pro', 'pro'), true)
eq('basic נחסם ב-pro',   planAllows('basic', 'pro'), false)
eq('חסר נחסם ב-pro',     planAllows(null, 'pro'), false)
eq('לא מוכר נחסם ב-pro', planAllows('premium', 'pro'), false)
eq('basic עובר basic',   planAllows('basic', 'basic'), true)
eq('pro עובר basic',     planAllows('pro', 'basic'), true)
// דרישה לא מוכרת נופלת ל-basic, כלומר לא נועלת בטעות פיצ'ר שאמור להיות פתוח.
eq('דרישה לא מוכרת',     planAllows('basic', 'enterprise'), true)

if (!process.exitCode) console.log('\n✓ שער המנוי תקין')
