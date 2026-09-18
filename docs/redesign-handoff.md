# עיצוב מחודש של הדשבורד — נקודת המשך (handoff בין המחשבים)

מסמך זה נועד להמשך העבודה מכל מחשב (נייד/נייח). GitHub הוא המקום המשותף היחיד — מה שכתוב כאן
משקף את המצב בענף `redesign` נכון ל-18.9.2026. מעדכנים אותו בסוף כל סבב עבודה.

## איך ממשיכים במחשב אחר

```
git fetch
git checkout redesign
git pull
npm install
& "C:\Program Files\nodejs\npx.cmd" vercel env pull .env.local --environment=production
```

- `.env.local` לא בגיט. הקובץ שנמשך מ-Vercel מכיל את ערכי הפרודקשן; משתני Secret (BMBY, CRON_SECRET,
  RESEND) מופיעים כ-`[SENSITIVE]` — לכן "משיכה חיה" מ-BMBY לא עובדת בלוקאל (מחזירה 500). כל שאר הדשבורד עובד.
- שרת פיתוח: דרך `.claude/launch.json` (שם `vitas-dev`, פורט 3000). **לא מריצים `npm run build` בזמן ששרת
  הפיתוח רץ** — שניהם כותבים ל-`.next` והתוצאה היא "Cannot find module './NNNN.js'". סדר עבודה: לעצור את
  השרת → `rm -rf .next && npm run build` → קומיט/דחיפה → `rm -rf .next` → להפעיל את השרת מחדש.
- פותחים סשן Claude חדש בתיקיית הפרויקט ומבקשים: "קרא את docs/redesign-handoff.md והמשך משם".

## מה זה הפרויקט

ויטלי מקבל מ-ChatGPT חבילות עיצוב (zip) מסך-מסך. כל חבילה נשמרת ב-`design/handoff-*/` ובה
`START-HERE-CLAUDE.md` (החוזה), רכיבי React, CSS ומסמכי DATA-CONTRACT/ACCEPTANCE/VALIDATION.
העיצוב נבנה **רק בענף `redesign`** ולא מתמזג ל-`main` עד אישור מפורש של ויטלי. הכללים הקבועים:
שומרים על כל החישובים וההרשאות הקיימים, לא מוחקים מדדים בעלי משמעות, ולא ממציאים נתונים
(אם מדד לא זמין — "אין נתון" ומדווחים).

ויטלי בודק בדפדפן שלו (Chrome, `localhost:3000/admin`, לקוח ש.ברוך › פרויקט HI PARK, טווח "החודש
הנוכחי") ושולח צילומי מסך עם הערות. אחרי כל סבב: אימות חזותי, build, קומיט, דחיפה.

## ארכיטקטורה של העיצוב החדש

- `app/components/report-ui/` — רכיבי החבילות: `VitasPresentation.jsx` (MetricCard עם `badge`/`onClick`
  /`details`, Funnel, ReportSection, ReportTable, AdGrid), `CrmSources.jsx` (CohortFunnel), `SourceDistribution.jsx`
  (דונאט עם אחוזים על הפרוסות), `BrandMarks.jsx` (MetaMark, GoogleMark, Yad2Mark, WhatsAppMark, SourceMark).
- CSS: `vitas-visual.css` ו-`crm-sources.css` ו-`response-times.css` (מהחבילות) + `vitas-bridge.css`
  (שלנו: מעצב מחדש markup קיים תחת `.vr-ui` / `.vr-shell` / `.header-vr` / `.vcs-root` / `.vrt-root`).
  כולם מיובאים ב-`app/layout.js` אחרי `globals.css`.
- דגלים ב-`app/admin/page.js` (בתוך הקומפוננטה, ליד `vrShell`):
  - `vrShell` — view=dashboard, לא דמו, לא Zoho/Salesforce → המעטפת (סיידבר, כותרת, כרטיס תקציב, טאבים) בכל
    הטאבים של פרויקטי נדל"ן. KLOSS/BCure/דמו לא משתנים.
  - `vrMode` — תוכן טאב "הכל".
  - `vrCrm` — תוכן CRM › מקורות הגעה.
  - `vrResp` — תוכן CRM › זמני תגובה.
  בכל מקום הקוד הישן נשאר בענף `else`, כך שהמצב הישן ממשיך לעבוד למי שלא בדגל.
- `createChart(id, type, labels, datasets, scales, onSliceClick, extra)` — `extra = { plugins, options }`
  למיזוג לפי מפתח (legend/tooltip) בלי לשבור את העיצוב הבסיסי. `vrBarLabelsPlugin` מצייר ערכים מעל עמודות.
- הקבצים הם CRLF. עריכות גדולות נעשות בסקריפט node שמנרמל `\r\n`, עם עוגנים מדויקים וספירה.

## מה הושלם (3 מסכים)

1. **המעטפת + טאב "הכל"** (`design/handoff-v1`): סיידבר 224px מלא-גובה עם לוגו, כפתורי כותרת (lucide),
   כרטיס תקציב בשורה אחת עם מפריד אלפים, טאבים מקוטעים, 10 כרטיסי KPI עם גרדיאנטים, משפך, גלריות מודעות
   3 עמודות, לוגואי Meta/Google בטבלאות, פילוח דמוגרפי בכרטיסים.
2. **CRM › מקורות הגעה** (`design/handoff-crm-sources`): 8 כרטיסים, CohortFunnel עם אייקונים/חיצים/כרטיסי
   מודעות/ענף ביטולים, טבלת מקורות עם סימני מקור, דונאט עם אחוזים, שורת תת-טאבים עם כפתור "רענון נתונים".
3. **CRM › זמני תגובה** (`design/handoff-response-times`): 4 כרטיסים (סה"כ לידים, קיבלו מענה, זמן מענה ממוצע
   עם חציון, בלי מענה), פס הסבר, "מהירות המענה" (2 גרפים קיימים), "דפוסי פגישות ומענה" (3 גרפים בעיצוב
   הסקיצה), שתי טבלאות לפי העיצוב המקורי כולל "זמן חציוני" ו"טרם התקיימה שיחה".
   - החציון היה כבר בסיכום (`responseTimeStats.business.medianMinutes` ולכל נציג/מקור) ומוצג רק כשיש
     דוח CRM אחד לטווח.
   - "טרם התקיימה שיחה" דרש שדה חדש בשרת: `responseTimeStats.noResponseBySource/noResponseByUser`
     ב-`lib/crm/bmby-summary.js`, וגרסת סכמה `CRM_SCHEMA_VERSION = 34`. דוחות שמורים ישנים מציגים "אין נתון"
     עד שהקרון ירענן אותם (אחרי פריסה) או עד "משיכה חיה" באדמין.

## מה נשאר

- תת-טאבי CRM: התנגדויות, יישובים, פגישות שבוצעו.
- טאבים Facebook, Google, המלצות חכמות.
- הבדלים בין תצוגת לקוח לאדמין; KLOSS (Salesforce) ו-BCure (Zoho) — כרגע במצב הישן בכוונה.
- ויטלי שולח חבילה לכל מסך; מחלצים ל-`design/handoff-<שם>/`, קוראים `START-HERE-CLAUDE.md`, מיישמים.

## תצפיות פתוחות (לא קשורות לעיצוב)

- HI PARK ב"חודש שעבר" (אוגוסט 2026) מציג אפסים גם בטאב "הכל" — כנראה דוח אוגוסט חסר/ריק. לבדוק בנפרד.
- מעקב אבטחה (MFA, רוטציית סודות, גיבויים) עדיין פתוח.
