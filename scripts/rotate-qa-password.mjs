/**
 * scripts/rotate-qa-password.mjs — סיסמה חדשה למשתמש ה-QA של בדיקות ה-E2E.
 *
 * למה: Playwright רושם ערכי fill בטקסט גלוי בתוך ה-trace, וה-trace נשמר 14 יום
 * כ-artifact ב-GitHub. הסיסמה של qa@vitas.co.il נחשפה כך ב-22.9. לתיבת הדואר הזו
 * אין מי שקורא, ולכן "שכחתי סיסמה" לא עובד — הסקריפט מגדיר סיסמה ישירות דרך
 * ה-Admin API של Supabase.
 *
 * הרצה (מתיקיית הפרויקט, בטרמינל שלך — לא דרך סשן של Claude, כדי שהסיסמה לא תופיע בו):
 *   node --env-file=.env.local scripts/rotate-qa-password.mjs
 *
 * אחרי ההרצה: להדביק את הסיסמה שהודפסה ב-GitHub → Settings → Secrets and variables →
 * Actions → QA_CLIENT_PASSWORD. בלי העדכון הזה כל בדיקות ה-E2E המחוברות ייכשלו.
 */
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomInt } from 'crypto'

const EMAIL = process.argv[2] || 'qa@vitas.co.il'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key || key.includes('SENSITIVE')) {
  console.error('חסרים NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ב-.env.local')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

// חיפוש המשתמש לפי מייל. ל-Admin API אין חיפוש ישיר, אז עוברים על הדפים.
let user = null
for (let page = 1; page <= 50 && !user; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
  if (error) { console.error('listUsers נכשל:', error.message); process.exit(1) }
  user = data.users.find(u => (u.email || '').toLowerCase() === EMAIL.toLowerCase()) || null
  if (data.users.length < 200) break
}
if (!user) { console.error(`לא נמצא משתמש ${EMAIL}`); process.exit(1) }

// 24 תווים אקראיים + אות גדולה, קטנה, ספרה וסימן — עובר כל מדיניות סיסמאות סבירה.
const pick = (s) => s[randomInt(s.length)]
const password = randomBytes(18).toString('base64url') + pick('ABCDEFGHJKLMNPQRSTUVWXYZ') + pick('abcdefghijkmnpqrstuvwxyz') + pick('23456789') + pick('!@#%^*-_')

const { error } = await sb.auth.admin.updateUserById(user.id, { password })
if (error) { console.error('העדכון נכשל:', error.message); process.exit(1) }

console.log(`\nהסיסמה של ${EMAIL} הוחלפה. הסיסמה הקודמת כבר לא עובדת.\n`)
console.log('הסיסמה החדשה (מופיעה פעם אחת בלבד):\n')
console.log('    ' + password + '\n')
console.log('עכשיו: GitHub → Settings → Secrets and variables → Actions → QA_CLIENT_PASSWORD → Update.')
console.log('אל תדביק אותה בשום צ\'אט.\n')
