# VITAS Reports

דשבורד דוחות שיווק ללקוחות של סוכנות VITAS. פרודקשן: https://reports.vitas.co.il
Next.js 14 (App Router) · Supabase · Vercel · אינטגרציות: Meta, Google Ads, BMBY, Zoho, Salesforce, Fireberry.

הפרויקט נערך משני מחשבים (נייד ונייח). **GitHub הוא המקום המשותף היחיד** — מה שלא נדחף, לא קיים במחשב השני.

## כללי עבודה

1. **לפני שמתחילים:** `git fetch` ולבדוק איפה `main` — הוא זז לעתים קרובות.
2. **עובדים רק על ענפים.** לא נוגעים ב-`main` ולא מעלים לפרודקשן בלי אישור מפורש של ויטלי.
3. **לפני שמסיימים:** לדחוף את הענף. ענף שלא נדחף נעלם מבחינת המחשב השני.
4. **מאמתים מקומית:** `npm run build` לפני כל דחיפה. לא שולחים את ויטלי לבדוק בפרודקשן.
5. **שינויים בבסיס הנתונים** נכתבים כקובץ ב-`scripts/migrations/` עם rollback, וויטלי מריץ אותם. ל-Supabase אין ענפים — כל SQL רץ ישר על הפרודקשן.
6. **לא מאפסים ענפים** (`reset --hard`) בלי לבדוק שאין עליהם קומיטים שלא נדחפו.

## תקשורת

כשצריך שוויטלי יעשה משהו: רשימה קצרה וממוספרת, בשפה פשוטה, עם קישור ישיר. בלי טבלאות ובלי רקע באותה הודעה.

## הרשאות

`NEXT_PUBLIC_SUPABASE_ANON_KEY` מוטמע בדפדפן — **הוא לא סוד ולעולם לא הרשאה**. לא להשתמש ב-`x-client-key`.
כל route חדש משתמש ב-`lib/auth.js`:
- `requireAdmin(req)` — אדמין (לפי טבלת `admins` בבסיס הנתונים)
- `requireProjectAccess(req, projectId)` — לקוח על הפרויקט שלו (לפי `client_access`)
- `isInternalCall(req)` — קרונים, עם `CRON_SECRET`
- `requireFetchAccess(req, projectId)` — משיכה חיה: אדמין וקרונים תמיד; לקוח רק לפרויקט שלו, בהגבלת קצב

בצד הדפדפן: `apiFetch` מ-`lib/api-fetch.js`, לא `fetch` ישיר.

סוכנים חיצוניים (סשני קמפיינים, סוכן הבדיקה היומי) נכנסים רק דרך `/api/v1/*` עם טוקן Bearer מטבלת `api_tokens` — ראה `API_V1_METRICS.md`. הסוכן היומי משתמש ב-`/api/v1/health` עם טוקן בהיקף `client_slug = *`.

## חיבורים ופרטי התחברות

סשן שלא מצליח להתחבר לפייסבוק, לגוגל או לדשבורד — **`docs/CONNECTIONS.md`**: איפה כל מפתח שמור, איך
מתחברים, ושלוש הבדיקות (האם צריך בכלל, רשת, מפתח). כשויטלי שואל על פרטי התחברות — להפנות לשם,
וגם לעותק בדרייב: "VITAS — מפת חיבורים ומפתחות (בלי ערכים).txt" (https://drive.google.com/file/d/1NyfHIdcMvlN9jq9L9yNmcaB6vo8N2qfn/view).

**הקובץ המרוכז של ויטלי (עם הערכים): `G:\האחסון שלי\API.txt`** (Google Drive במחשב שלו). שני כללים:
1. בכל פעם שנוצר API / טוקן / סוד / מזהה חדש (Google Cloud, Azure, Meta, CRM, Vercel, כל כלי) — להזכיר לו להוסיף אותו לקובץ הזה, עם כותרת ברורה (מה זה, איזה חשבון, איזה פרויקט).
2. כשהוא שואל איך מתחברים / מאיפה מביאים מפתח — להזכיר לו שהכל מרוכז שם, ולהפנות ל-`docs/CONNECTIONS.md` למה שחסר.
הקובץ אצלו בלבד: לא לבקש ממנו להדביק ממנו ערכים בצ'אט, ולא להעתיק ממנו למאגר.
אין בו ערכים, ואסור להוסיף: סודות רק ב-Vercel, בהגדרות הסביבה של הסשן ובמנהל הסיסמאות. לא מבקשים מויטלי להדביק מפתח בצ'אט.

## טווחי תאריכים מיידיים

כל טווח תאריכים נטען מ-`/api/reports/range` מתוך `ad_daily` (מודעות) ו-`crm_compact` (CRM), בלי לפנות לספקים
חיצוניים. איך זה בנוי, אילו קרונים ממלאים, ואיך מתחזקים: **`docs/daily-ranges.md`**. חישובי ה-CRM חיים
ב-`lib/crm/*-summary.js` — ה-routes משתמשים בהם; `lib/crm/salesforce-shape.js` מיוצר אוטומטית ואין לערוך ידנית.

## הקמה על מחשב חדש (Windows)

```
winget install OpenJS.NodeJS.LTS
git clone https://github.com/vitali-gif/vitas-reports.git
cd vitas-reports
npm install
& "C:\Program Files\nodejs\npx.cmd" vercel env pull .env.local --environment=production
```

- מדיניות ההרצה של PowerShell חוסמת `npx`, לכן משתמשים ב-`npx.cmd` עם נתיב מלא.
- משתני ה-Secret ב-Vercel (`CRON_SECRET`, `RESEND_API_KEY`) לא נמשכים — מופיעים כ-`[SENSITIVE]`. לקימפול מקומי זה בסדר.
- אחרי התקנת Node צריך לפתוח טרמינל חדש, אחרת `node` לא נמצא.
