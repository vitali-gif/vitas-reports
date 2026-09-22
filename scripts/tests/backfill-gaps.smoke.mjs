// scripts/tests/backfill-gaps.smoke.mjs — בדיקת עשן לבחירת הטווח הבא ב-backfill.
// הרצה:  node scripts/tests/backfill-gaps.smoke.mjs
//
// למה דווקא כאן: זו הפונקציה שהחליפה את הסמן הישן (min(day) ב-ad_daily). הסמן הישן
// ידע רק ללכת אחורה מהיום המוקדם ביותר, ולכן חור *מעל* היום הזה לא נסגר לעולם —
// ככה נעלמו 19 ימים של BCureLaser (22.8–9.9) ועוד 13 (27.6–9.7), והדשבורד הראה
// בטווח תאריכים 35,109 ₪ במקום 64,679 ₪. ראו מיגרציה 021.
//
// מה נבדק כאן: ההכרעה הטהורה בלבד — latestMissingRange. אין DB ואין רשת.
import { latestMissingRange } from '../../lib/ads/daily-sync.js'

const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1 }
const eq = (label, a, b) => (JSON.stringify(a) === JSON.stringify(b)
  ? console.log('✓ ' + label)
  : fail(`${label}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`))

const days = (from, to) => {
  const out = []
  for (let d = from; d <= to; ) {
    out.push(d)
    const n = new Date(d + 'T00:00:00Z'); n.setUTCDate(n.getUTCDate() + 1); d = n.toISOString().slice(0, 10)
  }
  return out
}
const have = (...ranges) => new Set(ranges.flatMap(([a, b]) => days(a, b)))

const FLOOR = '2026-01-01'

// ── אין כלום → מושך את החלון האחרון שלפני החזית, אחורה ──────────────────────
eq('כיסוי ריק',
  latestMissingRange(FLOOR, '2026-09-14', new Set(), 14),
  { since: '2026-09-01', until: '2026-09-14' })

// ── הכל מכוסה → אין מה לעשות ────────────────────────────────────────────────
eq('כיסוי מלא',
  latestMissingRange(FLOOR, '2026-09-14', have([FLOOR, '2026-09-14']), 14),
  null)

// ── המקרה האמיתי: חור 22.8–9.9 מעל היום המוקדם ביותר ────────────────────────
// הסמן הישן היה קופץ אל מתחת ל-10.8 ומדלג עליו לנצח. כאן הוא נבחר ראשון.
const bcure = have([FLOOR, '2026-08-21'], ['2026-09-10', '2026-09-14'])
eq('החור החדש ביותר נבחר ראשון',
  latestMissingRange(FLOOR, '2026-09-14', bcure, 14),
  { since: '2026-08-27', until: '2026-09-09' })

// אחרי שהחלק הזה נסגר — שאר אותו חור.
const bcure2 = have([FLOOR, '2026-08-21'], ['2026-08-27', '2026-09-14'])
eq('שארית החור נסגרת בריצה הבאה',
  latestMissingRange(FLOOR, '2026-09-14', bcure2, 14),
  { since: '2026-08-22', until: '2026-08-26' })

// ── חור שנסגר → ממשיכים אחורה אל החזית ההיסטורית, אותו קוד ──────────────────
eq('בלי חורים ממשיכים אחורה',
  latestMissingRange(FLOOR, '2026-09-14', have(['2026-03-08', '2026-09-14']), 14),
  { since: '2026-02-22', until: '2026-03-07' })

// ── לא חורגים מ-floor ───────────────────────────────────────────────────────
eq('נעצר ב-floor',
  latestMissingRange('2026-01-10', '2026-09-14', have(['2026-01-16', '2026-09-14']), 14),
  { since: '2026-01-10', until: '2026-01-15' })

// ── יום בודד חסר באמצע ──────────────────────────────────────────────────────
eq('יום בודד',
  latestMissingRange(FLOOR, '2026-09-14', have([FLOOR, '2026-05-04'], ['2026-05-06', '2026-09-14']), 14),
  { since: '2026-05-05', until: '2026-05-05' })

// ── maxSpan נאכף ────────────────────────────────────────────────────────────
eq('maxSpan=3',
  latestMissingRange(FLOOR, '2026-09-14', have([FLOOR, '2026-06-30']), 3),
  { since: '2026-09-12', until: '2026-09-14' })

// ── יום שנמשך והחזיר 0 שורות נחשב מכוסה ולא נדרש שוב ────────────────────────
// זה מה שעצר את חשבון 805919712416404, שביקש את אותו טווח ריק בכל שעה מחדש (B9).
eq('חודש ריק שנמשך לא נדרש שוב',
  latestMissingRange(FLOOR, '2026-09-14', have([FLOOR, '2026-09-14']), 14),
  null)

if (!process.exitCode) console.log('\n✓ בחירת הטווח ב-backfill תקינה')
