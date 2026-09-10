# מודל ההרשאות

מסמך קצר לקריאה לפני שמוסיפים API route חדש.

## הכלל האחד

**`NEXT_PUBLIC_SUPABASE_ANON_KEY` הוא לא סוד ולעולם לא הרשאה.**

כל משתנה עם התחילית `NEXT_PUBLIC_` מוטמע בקוד שנשלח לדפדפן בזמן ה-build — זה
בדיוק תפקידה של התחילית. אפשר לקרוא אותו מ-`page-*.js` בלי להתחבר, בלי חשבון,
בלי כלום. התבנית הישנה

```js
const anon = request.headers.get('x-client-key')
if (anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return 401   // ← לא הרשאה
```

נראתה כמו שער אבל הייתה פתוחה לכל אחד. היא הוסרה מכל ה-routes.

## מה להשתמש במקום

הכל ב-[`lib/auth.js`](../lib/auth.js). כל הפונקציות מחזירות `{ ok, res }` —
ה-route רק מחזיר את `res` כמו שהוא.

| הקורא | מה להשתמש | מה זה בודק |
|---|---|---|
| אדמין מממשק הניהול | `requireAdmin(req)` | JWT תקף + המייל ב-`ADMIN_EMAILS` |
| לקוח, על פרויקט מסוים | `requireProjectAccess(req, projectId)` | JWT תקף + שורה ב-`client_access` |
| כל משתמש מחובר | `requireUser(req)` | JWT תקף בלבד |
| קרון / קריאה פנימית | `isInternalCall(req)` | `CRON_SECRET` בכותרת `x-internal-key` |

```js
import { requireProjectAccess } from '../../../../lib/auth'

export async function POST(request) {
  const body = await request.json()
  const gate = await requireProjectAccess(request, body.projectId)
  if (!gate.ok) return gate.res
  // gate.user.email זמין כאן
}
```

### איך בוחרים בין `requireAdmin` ל-`requireProjectAccess`

השאלה היא לא "מי אמור להשתמש בזה" אלא **"האם לקוח יכול להגיע לזה מהמסך שלו"**.
תצוגת הלקוח מרנדרת את אותו `AdminPage` עם `isClientView`, ולכן הרבה יותר
פונקציונליות זמינה לו ממה שנדמה — טאב ההמלצות, היסטוריית הערות של לידים,
עדכון סטטוס משימות. אם הבקשה נושאת `projectId`, כמעט תמיד `requireProjectAccess`
הוא הנכון: הוא מרשה ללקוח לגשת לשלו וחוסם גישה לפרויקט של אחר.

## מהצד של הדפדפן

לא לקרוא ל-`fetch('/api/...')` ישירות. להשתמש ב-[`lib/api-fetch.js`](../lib/api-fetch.js),
שמצרף את ה-JWT של הסשן:

```js
import { apiFetch } from '../../lib/api-fetch'
const res = await apiFetch('/api/reports/by-project?projectId=' + id)
```

## service_role

`SUPABASE_SERVICE_ROLE_KEY` **עוקף RLS לחלוטין**. כל route שמשתמש בו חייב לאמת
בעצמו שהקורא רשאי לגשת לנתונים המבוקשים — RLS כבר לא עושה את זה בשבילו.
זה בדיוק מה שהחמיץ `/api/reports/by-project`, שהחזיר את הנתונים הגולמיים של כל
פרויקט לפי `projectId` בלבד.

אין נפילה חזרה למפתח ה-anon. חסר המפתח — הבקשה נכשלת עם שגיאה מפורשת.

## בדיקה אוטומטית

```bash
npm run check:auth
```

עוברת על כל ה-routes ונכשלת אם נמצא `x-client-key` או route בלי שום שומר.
route שהוא ציבורי בכוונה נרשם ב-`PUBLIC_ROUTES` בתוך
[`scripts/check-auth-pattern.mjs`](../scripts/check-auth-pattern.mjs) — עם הסבר למה.

הבדיקה נוספה אחרי ש-`bmby/lead-notes` נכתב עם התבנית הישנה שבועיים אחרי
שהוחלפה, פשוט כי היא הייתה הסטנדרט בכל שאר הקוד.

## בסיס הנתונים

מדיניות RLS מתועדת ב-[`scripts/migrations/`](../scripts/migrations/). מי אדמין
נקבע בשני מקומות שצריכים להישאר מסונכרנים:

- `ADMIN_EMAILS` — משתנה סביבה ב-Vercel, משמש את שכבת ה-API
- טבלת `admins` — משמשת את `is_admin()` במדיניות RLS

מוסיפים אדמין? לשני המקומות.
