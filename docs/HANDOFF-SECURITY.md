# Tovno (VITAS Reports) — חומרי רקע לביקורת אבטחה

מסמך זה נכתב עבור סשן ביקורת האבטחה החיצוני, לפי ארבעת הפריטים שהוא ביקש.
**אין בו סיסמאות, מפתחות, טוקנים או ערכי `.env`** — רק שמות משתנים וייעודם,
כפי שהוא ביקש במפורש.

מקור: קריאה בקוד של ענף `redesign` (המיזוג ל-`main` טרם בוצע).
תאריך הפקה: 21.09.2026. כל מה שכתוב כאן נקרא מהקוד; מה שלא אומת מסומן ככזה.

---

## 1. קוד המקור

| פריט | ערך |
|---|---|
| מאגר | `github.com/vitali-gif/vitas-reports` (פרטי) |
| ענף בייצור | `main` → reports.vitas.co.il |
| ענף עבודה | `redesign` — מכיל את כל העבודה האחרונה, טרם מוזג |
| סטאק | Next.js 14 (App Router), React 18, Supabase (Postgres), Vercel |
| תלויות | `package.json` + `package-lock.json` בשורש |

מפת ספריות רלוונטיות לביקורת:

| נתיב | תוכן |
|---|---|
| `lib/auth.js` | **כל שכבת ההרשאות של ה-API.** נקודת הכניסה לביקורת. |
| `lib/rate-limit.js` | הגבלת קצב (טבלת `rate_limits`) |
| `lib/api-fetch.js` | עטיפת fetch בצד הדפדפן — מצרפת את ה-JWT |
| `app/api/**/route.js` | 36 routes; טבלת ההרשאות בסעיף 8 |
| `scripts/migrations/*.sql` | סכמה ו-RLS. `001_rls_lockdown.sql` הוא הבסיס. |
| `lib/crm/*` | חישובי CRM מעל התמונה השמורה |
| `lib/meetings/store.js` | הרשאות של פיצ'ר ישיבות השיווק (`requireMeeting`) |

---

## 2. מפת הרשאות

### תפקידים

| תפקיד | איך נקבע | מה רואה |
|---|---|---|
| **אדמין** | המייל נמצא בטבלה `admins` (בדיקה בכל בקשה) | הכל — כל הלקוחות וכל הפרויקטים |
| **לקוח** | שורה בטבלה `client_access` (`email` + `project_id`) | רק פרויקטים שיש לו שורה עליהם |
| **קריאה פנימית** | `CRON_SECRET` בכותרת `x-internal-key` או כ-Bearer | הכל; משמש קרונים ו-fan-out שרת-לשרת |
| **טוקן API** | `api_tokens` (נשמר כ-`sha256`, לא בטקסט גלוי) | לפי `client_slug`; `*` = ניטור, אגרגטים בלבד |

### שלוש השומרות המרכזיות (`lib/auth.js`)

```
requireAdmin(req)                      אדמין או קריאה פנימית
requireProjectAccess(req, projectId)   אדמין / פנימי / לקוח עם שורה ב-client_access
requireProjectPlan(req, projectId, p)  כנ"ל + מנוי הלקוח (clients.plan) מספיק לפיצ'ר
requireFetchAccess(req, projectId)     כנ"ל + הגבלת קצב ללקוח: 12 משיכות חיות בשעה
isInternalCall(req)                    CRON_SECRET בלבד
monitorTokenOf(req)                    טוקן api_tokens בהיקף '*'
```

`requireProjectPlan` הוא הרחבה של `requireProjectAccess`, לא תחליף: הוא מריץ אותו
במלואו ורק אז מוסיף תנאי. הוא מחזיר 403 עם `code: 'PLAN_REQUIRED'` — קוד נפרד מ-403
של הרשאה, כדי שהדפדפן יבדיל בין "אין לך גישה לפרויקט" ל"הפיצ'ר אינו במנוי". אדמין
וקריאה פנימית עוברים אותו תמיד. המנוי נגזר מ-`projects.client_id → clients.plan`,
והוא fail-closed בכל נתיב: עמודה חסרה, שגיאת שאילתה או ערך לא מוכר = `basic`.

כולן `fail-closed`: משתנה סביבה חסר → דחייה, לא מעבר.

### נקודות שראוי שהביקורת תיתן עליהן את הדעת

1. **אימות JWT מקומי.** מאז 17.09 הטוקן מאומת מקומית מול JWKS (ES256) ולא מול
   שרת ה-Auth. **המשמעות: טוקן שבוטל בהתנתקות נשאר תקף עד שפג — עד שעה.**
   ההרשאות עצמן (`admins`, `client_access`) כן נבדקות בכל בקשה, ולכן *הסרת*
   גישה נתפסת מיד. הפער הוא בביטול סשן בלבד. מתועד ב-`lib/auth.js`.
2. **`NEXT_PUBLIC_SUPABASE_ANON_KEY` אינו הרשאה.** עד 16.09 routes נבדקו מול
   `x-client-key === ANON_KEY`, שמוטמע בבאנדל ולכן ציבורי. זה הוחלף; כלל
   העבודה בפרויקט (`CLAUDE.md`) אוסר להחזיר את הדפוס. **שווה לוודא שלא נשאר
   שריד.**
3. **`SUPABASE_SERVICE_ROLE_KEY` בשימוש נרחב בצד השרת.** `adminClient()` עוקף
   RLS. כל route שמשתמש בו מסתמך על השומרת שלו ולא על מסד הנתונים.
4. **RLS.** `crm_raw`, `crm_compact`, `admins`, `api_tokens`, `rate_limits` —
   RLS דלוק **בלי policies בכוונה**, כלומר `service_role` בלבד.
   `clients` / `projects` / `reports` / `vitas_tasks` — יש policies (`001`).

### הזמנות, שיתוף וכניסה בשם לקוח

- הזמנת לקוח: `/api/client-access` (אדמין בלבד) יוצר שורה ושולח magic link ב-Resend.
- כניסה: `/api/client-auth` — magic link, מוגבל קצב. אין סיסמאות ללקוחות.
- **אין** מנגנון "כניסה בשם לקוח" (impersonation) ואין קישורי שיתוף ציבוריים
  לדוחות. לישיבות שיווק יש טבלת `meeting_shares` — **לא אימתתי את מודל
  ההרשאות שלה לעומק; ראוי לבדיקה.**
- **אין MFA** לאדמין. ההזדהות היא Supabase Auth (מייל/סיסמה + OAuth לפי
  `NEXT_PUBLIC_OAUTH_PROVIDERS`).

---

## 3. מבנה הסביבה

| רכיב | ספק |
|---|---|
| אירוח והרצה | Vercel |
| מסד נתונים, הזדהות | Supabase (Postgres) |
| דוא״ל יוצא | Resend |
| קרונים | Vercel Cron + cron-job.org (שולח `Authorization: Bearer <CRON_SECRET>`) |
| ספקי נתונים | Meta Ads API, Google Ads API, BMBY, Zoho CRM, Salesforce |

**אין סביבת בדיקות נפרדת.** ל-Supabase אין ענפים בהגדרה הזאת — כל SQL רץ ישר
על הייצור, וכל מיגרציה נכתבת כקובץ ב-`scripts/migrations/` עם rollback ומורצת
ידנית. זו מגבלה ידועה ומתועדת ב-`CLAUDE.md`.

### קרונים ונקודות קצה מתוזמנות

`/api/cron/prefetch`, `/api/cron/prefetch-ads`, `/api/cron/prefetch-crm`,
`/api/cron/prefetch-daily`, `/api/cron/health`, `/api/keepalive`.
כולם (למעט `keepalive`) דורשים `Authorization: Bearer <CRON_SECRET>`.

### Webhook / ingest חיצוני

`/api/google/script-ingest` — מקבל דחיפה מ-Google Apps Script, מאומת ב-secret
משותף (`GOOGLE_SCRIPT_SECRET`). **זו נקודת הכניסה החיצונית היחידה שאינה
CRON_SECRET או JWT, ולכן ראויה לתשומת לב מיוחדת.**

---

## 4. משתני סביבה — שמות וייעוד בלבד

> ללא ערכים. `NEXT_PUBLIC_*` מוטמעים בבאנדל של הדפדפן ולכן **ציבוריים לפי הגדרה**.

### סודות שרת

| שם | ייעוד |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | עוקף RLS. הסוד הרגיש ביותר במערכת. |
| `CRON_SECRET` | הזדהות שרת-לשרת ולקרונים |
| `GOOGLE_SCRIPT_SECRET` | הזדהות ל-ingest מ-Apps Script |
| `RESEND_API_KEY` | שליחת דוא״ל |
| `META_ACCESS_TOKEN` | Meta Ads API |
| `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID` | Google Ads API |
| `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_REFRESH_TOKEN` | Salesforce OAuth |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` | Zoho OAuth |
| `BMBY_LOGIN`, `BMBY_PASSWORD` | BMBY — **הזדהות בשם משתמש וסיסמה, לא OAuth** |

### הגדרות (לא סודות)

`GOOGLE_ADS_API_VERSION`, `GOOGLE_ADS_CUSTOMER_ID(S)`,
`GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `META_AD_ACCOUNT_ID(S)`, `SF_API_VERSION`,
`SF_LOGIN_URL`, `ZOHO_API_DOMAIN`, `ZOHO_BACKFILL_SINCE`,
`AD_DAILY_BACKFILL_SINCE`, `BMBY_PROJECT_IDS`, `BMBY_RELEVANT_STATUSES`,
`ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`.

### ציבוריים (בבאנדל)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_OAUTH_PROVIDERS`,
`NEXT_PUBLIC_MEETINGS_ENABLED`.

לכל ספק Google Ads אפשר גם דריסה פר-חשבון בסיומת מזהה הלקוח
(`GOOGLE_ADS_*_<customerId>`).

### ניטור, לוגים, גיבויים

- **ניטור:** `/api/cron/health` + טבלאות `cron_heartbeat` ו-`job_log`.
  סוכן חיצוני ניגש ל-`/api/v1/health` עם טוקן `api_tokens` בהיקף `*`.
- **התראות:** מייל ב-Resend אל `ALERT_EMAIL_TO`.
- **לוגים:** לוגי Vercel (שמירה לפי תוכנית Vercel) + `job_log` ו-`vitas_actions_log`.
- **גיבויים:** הגיבויים המובנים של Supabase. **בדיקת שחזור מעולם לא בוצעה
  ולא תועדה** — פער ידוע.

---

## 5. טבלאות ומידע אישי

| טבלה | מידע אישי? | RLS |
|---|---|---|
| `crm_raw` | **כן** — הרשומה הגולמית מה-CRM | דלוק, בלי policies (service_role) |
| `crm_compact` | **כן** — הקרנה: שמות, טלפונים, עיר, כתובת, תקציב, מצב משפחתי, זכאות, הערות חופשיות | דלוק, בלי policies |
| `marketing_meetings`, `meeting_invitees` | **כן** — מיילים, שמות | לבדיקה |
| `meeting_artifacts`, `transcript_segments` | **כן** — תוכן תמלול ושם דובר | לבדיקה |
| `client_access`, `client_sessions` | **כן** — מיילים של משתמשים | לבדיקה |
| `admins`, `api_tokens`, `rate_limits` | מיילים / גיבוב טוקן | דלוק, בלי policies |
| `reports`, `ad_daily` | אגרגטים בלבד | policies ב-001 |
| `clients`, `projects`, `vitas_tasks` | שמות עסקיים | policies ב-001 |

**אף route לא חושף את `crm_raw` או `crm_compact` ישירות — רק אגרגטים.**
היוצא מן הכלל היחיד שמצאתי: `/api/bmby/lead-notes` מחזיר הערות של ליד ספציפי,
ומוגן ב-`requireProjectAccess`.

---

## 6. מה **לא** נבדק ולא ניתן להסיק מקריאת הקוד

רשימה זו נועדה למנוע הסקה שגויה מהמסמך:

1. הגדרות Vercel בפועל (משתני סביבה, הגנת פריסות, מי חבר בצוות).
2. הגדרות Supabase בפועל (מדיניות רשת, מי חבר בפרויקט, האם RLS אכן דלוק
   בייצור כפי שהמיגרציה מורה, מדיניות שמירת גיבויים).
3. **שחזור מגיבוי — מעולם לא נבדק.**
4. מודל ההרשאות של `meeting_shares`.
5. האם קיים MFA על חשבונות Vercel/Supabase/GitHub של הבעלים.
6. רוטציית מפתחות — לא ידוע אם בוצעה אי פעם.
7. תלויות: הקבצים קיימים, אך לא הרצתי סריקת CVE.
8. כל בדיקה פעילה — לא בוצעה ולא צריכה להתבצע מול הייצור.

---

## 7. הערה על דוח הבדיקה הפנימי

בפרויקט רצה בדיקת אבטחה בעזרת Claude. **היא אינה בדיקת חדירה ואינה תחליף
לביקורת עצמאית.** הסשן החיצוני צודק בכך שהיא חומר משלים בלבד, וראוי להעביר
אותה רק אחרי הסקירה העצמאית הראשונית, כדי להשוות כיסוי.

---

## 8. נספח — טבלת ה-routes וההרשאה של כל אחד

| Route | שומרת |
|---|---|
| `ads/daily-sync` | `requireAdmin` |
| `auth/confirm` | ציבורי (נחיתת magic link) |
| `bmby/debug`, `bmby/debug-response` | `?secret=<CRON_SECRET>` |
| `bmby/fetch` | `requireFetchAccess` |
| `bmby/lead-notes` | `requireProjectAccess` |
| `budget/check`, `budget/email` | `requireAdmin` |
| `client-access` | `requireAdmin` |
| `client-auth` | ציבורי + הגבלת קצב (magic link) |
| `client-log` | `requireUser` / `requireAdmin` |
| `cron/health`, `cron/prefetch*` | `Bearer <CRON_SECRET>` |
| `demo` | `requireAdmin` |
| `google/fetch` | `requireFetchAccess` |
| `google/script-ingest` | `GOOGLE_SCRIPT_SECRET` |
| `keepalive` | ציבורי — ping בלבד, לא מחזיר נתונים |
| `meetings`, `meeting-tasks/[id]` | `requireProjectPlan(…, 'pro')` — הרשאה **וגם** מנוי |
| `meetings/[id]`, `/summary`, `/transcript` | `requireMeeting` (פרויקט הישיבה → `requireProjectPlan` עליו) |
| `meta/diagnose`, `meta/rules` | `requireAdmin` |
| `meta/fetch` | `requireFetchAccess` |
| `reports/by-project` | `requireProjectAccess` |
| `reports/range` | `requireProjectAccess` או `monitorTokenOf` |
| `salesforce/fetch`, `zoho/fetch` | `requireFetchAccess` |
| `tasks/create`, `tasks/update` | `requireProjectAccess` |
| `v1/*` | טוקן Bearer מ-`api_tokens` |
