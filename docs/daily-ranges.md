# טווחי תאריכים מיידיים — איך זה בנוי (as built, 17.9.2026)

התכנית והיומן: `docs/daily-ranges-plan.md`. כאן רק מה שקיים ואיך לתחזק אותו.

## הרעיון בשתי שורות

- **מודעות (Meta, Google):** עובדות יומיות בטבלה `ad_daily`; כל טווח = סכום ימים, בתוך Postgres.
- **CRM (BMBY, Zoho, Salesforce):** רשומות גולמיות ב-`crm_raw` → תמונה דחוסה לפרויקט ב-`crm_compact` (BMBY, Zoho)
  או פרוסה לטווח שנחתכת ב-DB (Salesforce, 60k רשומות) → אותה פונקציית חישוב שה-route מריץ על משיכה חיה.

הדשבורד לא השתנה: `GET /api/reports/range?projectId&since&until` מחזיר שורות בצורת `reports`
(`{month: 'since_until', source, data, summary, synthetic: true}`), ו-`triggerFetch` ב-`app/admin/page.js`
פונה אליו לכל מפתח טווח חסר. **אין משיכה חיה אוטומטית — לא ללקוח ולא לאדמין** (מ-17.9): הדפדפן מציג
מה שיש בשרת ומה שחסר נשאר חסר. אדמין שרוצה נתונים מהספקים עכשיו לוחץ "🔄 משיכה חיה" ליד "עודכן לפני" (או
"נסה למשוך שוב" בתקופה ריקה, או "רענן CRM"). ככה האדמין רואה בדיוק את מה שהלקוח רואה.

## טבלאות ומיגרציות

| טבלה | מיגרציה | מה יש בה | מי כותב |
|---|---|---|---|
| `crm_raw` | 006 | רשומה גולמית לכל ישות (BMBY: clients/tasks/price_offers/contracts; Zoho: leads/deals; Salesforce: leads/opportunities/line_items/lead_history), PK (project, crm_type, entity, ext_id) | ה-routes של ה-CRM בכל ריצה |
| `crm_compact` | 009, 010 | שורה אחת לפרויקט (BMBY מוקרן ל-~30 שדות; Zoho מלא) + `built_at`. **לא ל-Salesforce** | `rebuild_crm_compact()` ב-DB, מיד אחרי כל upsert ל-`crm_raw` |
| (Salesforce) | 011 | אין תמונה דחוסה: `crm_slice_salesforce(project, from, to)` חותך מ-`crm_raw` רק את רשומות הטווח (לידים/פגישות בחלון, ההיסטוריה שלהם, הזדמנויות בחלון + cohort, פריטים). 60k רשומות → מאות | נקרא מ-`/api/reports/range` |
| `ad_daily` | 007 | יום × חשבון × מודעה × גיל × מגדר; RPC `ad_daily_aggregate`, `ad_daily_coverage` | `lib/ads/daily-sync.js` |
| `job_log` | 008 | ריצות רקע (30 יום) | `lib/job-log.js` |

RLS דלוק בלי מדיניות בכולן — service_role בלבד. הרשומות הגולמיות לעולם לא מוחזרות החוצה.

## קוד

```
lib/crm/
  bmby-summary.js        computeBmbySummary + toReportRow — הועבר מהroute זהה שורה-בשורה (שלב 0)
  zoho-summary.js        computeZohoSummary + filterDigitalLeads — כנ"ל (שלב 4א)
  salesforce-summary.js  emulateSalesforceQueries — מחקה 40 שאילתות SOQL מרשומות גולמיות (שלב 4ב)
  salesforce-shape.js    קוד העיצוב של route Salesforce, *מיוצר אוטומטית* ממנו (ראה למטה)
  salesforce-common.js   קבועים ועזרים של Salesforce
  compute.js             computeCrmRow(crmType, snapshot, period) — שער אחד; totalKeysFor לכל סוג
  raw-store.js           upsertRawRecords / loadRawRecords / loadCompactSnapshot / loadCompactMeta / rebuildCompact
  schema-version.js      גרסאות הסכמה של כל המקורות, במקום אחד
lib/ads/
  meta-api.js, google-api.js   קריאות בסיס (הועברו מה-routes)
  routing.js                   ניתוב שורה → פרויקט (חשבון / שם קמפיין / סוכנות KLOSS), slim, computeTotals
  meta-daily.js, google-daily.js   עובדות יומיות (time_increment=1 / segments.date)
  daily-store.js               rowKey, upsert, delete-range, coverage, aggregateRange (RPC)
  daily-sync.js                runDailySync: recent / backfill / range — נרשם ב-job_log
  range-rows.js                שורות facebook/google לטווח (demographics, slim, byAgency, bySubProject, reach)
lib/health-infra.js            חיישני בריאות למנגנון (שלב 5)
app/api/reports/range/route.js הנקודה עצמה: מטא → מטמון תוצאה → מטמון payload → DB; compare=1 להשוואת זהב
app/api/cron/prefetch-daily/route.js   קרון שעתי (cron-job.org, דקה 25): ad_daily recent+backfill, Zoho deals
                               + backfill חודשי, Salesforce modified-refresh
```

## קרונים (cron-job.org)

| קרון | תדירות | מה |
|---|---|---|
| `prefetch-ads` | כל שעתיים מ-07:07 | 26 דוחות שמורים של מודעות (ללא שינוי) |
| `prefetch-crm` | כל שעתיים מ-07:37 | דוחות CRM שמורים + **שומר crm_raw ובונה crm_compact** |
| `prefetch-daily` | כל שעה, דקה 25 | ad_daily (7 ימים אחורה + צעד backfill), Zoho deals שהשתנו + backfill חודשי, Salesforce שהשתנה |
| `health` | כל שעה, דקה 15 | מייל בריאות; כולל עכשיו את 'תשתית · טווחי תאריכים' |

## ביצועים (HI PARK, הפרויקט הכבד)

שרת קר, טווח חדש ≈ 3 שניות (טעינת 1.7MB + חישוב 0.2). שרת חם, טווח חדש ≈ 0.7. צפייה חוזרת ≈ 0.5, כולה רשת.
`vercel.json` מריץ את הפונקציות בסינגפור ליד Supabase (`regions: ["sin1"]`).

## איך מוודאים שהכל נכון

- `GET /api/reports/range?...&compare=1` (גם עם טוקן הניטור): החישוב מהתמונה מול הדוח החי לאותו מפתח.
  סטייה צפויה רק בשדות "מצב נוכחי" (סיווג רלוונטי, פגישות עתידיות, לידים לטיפול) כשהתמונה טרייה יותר.
- `GET /api/v1/health`: `daily_facts` (כיסוי + ריצות אחרונות), `crm_snapshot` (תמונות לפי פרויקט),
  ו-`projects` כולל 'תשתית · טווחי תאריכים'.
- `npm test`: 71 בדיקות עשן על רשומות מלאכותיות לכל מקור.

## תחזוקה

- **שינוי בחישוב של BMBY/Zoho:** עורכים את הפונקציה ב-`lib/crm/*-summary.js` (ה-route משתמש בה).
  להעלות את `*_SCHEMA_VERSION` ב-`lib/crm/schema-version.js`.
- **שינוי ב-route של Salesforce:** ה-route נשאר על SOQL בכוונה (השוואת זהב בלתי תלויה). אחרי שינוי,
  לייצר מחדש את `lib/crm/salesforce-shape.js` (המחולל: הקטע מ-"response time from LeadHistory" עד
  `const results = []`, עם החלפת `await soql(...)`/`Promise.all` ב-E) ולעדכן את החיקוי ב-`salesforce-summary.js`
  אם נוספה שאילתה. `npm run test:crm` בודק את שניהם.
- **שדה חדש בחישוב BMBY:** להוסיף גם להקרנה ב-`rebuild_crm_compact_bmby` (מיגרציה 010).
- **חשבון מודעות חדש:** מספיק להוסיף ל-`META_AD_ACCOUNT_IDS` / `GOOGLE_ADS_CUSTOMER_IDS`; backfill מתמלא לבד.
- **מילוי היסטורי:** `AD_DAILY_BACKFILL_SINCE` (ברירת מחדל 2026-01-01), `ZOHO_BACKFILL_SINCE` (2026-01).
