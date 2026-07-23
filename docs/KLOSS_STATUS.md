# KLOSS — מצב הפרויקט (מסמך העברה)

עודכן: 2026-07-22. מסמך זה הוא מקור האמת להמשך עבודה על הדשבורד של **קלוס** מכל מחשב.

## מה זה
לקוח רביעי ב-vitas-reports. CRM = **Salesforce**. מדיה: Meta + Google (טרם חוברו).
Repo: `vitali-gif/vitas-reports` · Deploy: Vercel → reports.vitas.co.il/admin

## חיבור Salesforce
- ארגון **Production**, My Domain: `beithasapa.my.salesforce.com`, משתמש admin@sdc.com
- **External Client App** בשם "Vitas Reports Dashboard" (הארגון חוסם Connected App קלאסי)
- env ב-Vercel: `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_REFRESH_TOKEN`, `SF_LOGIN_URL=https://beithasapa.my.salesforce.com`, `SF_API_VERSION=v60.0`
- חובה: **Enable Authorization Code and Credentials Flow** מסומן באפליקציה
- ה-session של SF פג מהר; לחקירה ידנית צריך authorize→code→exchange מאותו origin

## סינון קריטי
- לידים: `Chain_Name__c = 'קלוס'` · הזדמנויות: `Cahin_Name__c = 'קלוס'` (**טעות כתיב Cahin במקור**)
- כל התקופות לפי `CreatedDate`, בגבולות **שעון ישראל** (לא UTC)
- ה-route כותב רק לפרויקטים ששמם מכיל `kloss`

## מיפוי סטטוסי ליד (ערך API ↔ תווית עברית)
| API | תווית |
|---|---|
| New | חדש |
| Working | נוצר קשר ראשוני |
| אין מענה | אין מענה |
| **Nurturing** | **תואמה פגישה בסניף** (טרם התקיימה) |
| לא הגיעו לפגישה | לא הגיעו לפגישה |
| **Qualified** | **הומר** (הגיע לפגישה) |
| **Unqualified** | **לא הומר** |

**פגישות = Nurturing + Qualified + לא הגיעו לפגישה.** לא לספור לפי `meetingDate__c` (ליד שנוצר החודש יכול להחזיק פגישה עתידית). `Unqualified` אינו פגישה — סיבות אי-ההמרה שלו הן פסילות כלליות.

## שדות מרכזיים
- הזדמנות: `StageName` (חדש / קיבל הצעת מחיר / הזמנה - שולמה מקדמה / נסגר ללא הצלחה)
- שווי: `TotalPrice_Opp_Product__c` (מוצג) · `Amount` (הדשבורד של הלקוח משתמש בזה — כולל הובלה +~72K) · `ovala__c` = הובלה והרכבה (קארד נפרד)
- `Buying_Purpose__c`, `Description`, סניף `Branch_Name__c`, איש מכירות `Salesman__r.Name` (lookup ל-Contact)
- מוצרים: `OpportunityLineItem` → `Product2.Name`
- זמני תגובה: `LeadHistory` (Field='Status') — מ-CreatedDate עד השינוי הראשון
- שעות/ימי פגישות: `HOUR_IN_DAY()`/`DAY_IN_WEEK()` — **HOUR_IN_DAY מחזיר UTC**, ה-route ממיר לשעון ישראל

## אימות מול הלקוח (הושלם)
המספרים תואמים. פערים שהיו ונפתרו: מקורות הגעה שלא היו ב-picklist (עמוד נחיתה/ig/fb — הלקוח הוסיף), הגדרת פגישות לפי סטטוס, וגבולות חודש בשעון ישראל.

## מלכודות שנתקלנו בהן
1. `app/admin/page.js` — `renderDashboard` עטוף ב-**useCallback**; כל state חדש חייב להיכנס למערך התלויות (שורה ~3808) אחרת ה-UI לא מגיב.
2. הקובץ מייבא `Fragment` ישירות — **אין `React` בסקופ**.
3. esbuild לא תופס שגיאות TDZ — לוודא סדר הגדרות כשמזריקים חישובים.
4. גידור UI: כל דבר שאינו מגודר ל-`crmType === 'salesforce'` ידלוף ללקוחות אחרים. הבדיקה בקוד היא `!['zoho','salesforce'].includes(crmType)` עבור מסלול הנדל"ן.
5. Vercel הפסיק פעם אחת לפרוס אוטומטית למרות ש-Git מחובר.

## מה נשאר
- נרמול שמות סניפים (כפילויות עם/בלי רווח) ומקורות (fb/ig/פייסבוק טופס לידים)
- הכרעה: "ליד" כולל מומרים (מומלץ) או לא
- חיבור 2 חשבונות Meta + 2 חשבונות Google (שתי סוכנויות כל אחד) → יפעיל עלות לליד/פגישה/לקוח ו-ROAS
- גישת לקוח ותקציב חודשי


## עדכון 2026-07-23 — שתי עדשות (קוהורט מול פעילות)
בעיה חוזרת: לידים/פגישות נספרים לפי תאריך יצירת הליד (קוהורט), אבל הזדמנויות/מכירות לפי תאריך יצירת ההזדמנות (פעילות, כולל לידים מחודשים קודמים). זה יצר מספרים "בלתי-אפשריים" (הזדמנויות > פגישות).

**הפתרון שהוטמע (schema v11):**
- `funnelCohort` — קבוצת הלידים שנוצרו החודש: leads→meetings→arrived→opportunities→quotes→paid, מקונן. כולל quotesValue, paidValue, lost, noShow. מקור: `SELECT ConvertedOpportunity.StageName, ConvertedOpportunity.TotalPrice_Opp_Product__c FROM Lead WHERE ... AND IsConverted=true` + סיכום ב-JS (SUM דרך יחס-אב חסום ב-SF).
- `funnelPeriod` — פעילות החודש: leads, opportunities(created this month), meetings(meetingDate this month), quotes+value, paid+value, lost, noShow.
- **קלפי מסך רשת + קלפי טאב "הכל"** מציגים קוהורט. שני המשפכים + טבלת הסניפים מציגים את שתי העדשות (בטבלת הסניפים יש טוגל `sfBranchLens`, ברירת מחדל cohort). ה-`branchDetail` מכיל cohortOpps/cohortQuotesTotal/cohortPaid/cohortValue/cohortConvLeadToPaid לצד השדות ה-period.
- כפתור **"רענן CRM"** ב-CRM tab (handler `refreshFromSalesforce`).

**מלכודת שחזרה שלוש פעמים (חשוב!):** משתנה שמוצב ב-destructuring אבל לא מוכרז ב-`let` (למשל `cohortStagesR`, `branchCohortR`) → `ReferenceError` בזמן ריצה → כל משיכה מחזירה **500** והנתונים לא נכתבים. `node --check` ו-`esbuild` **לא** תופסים את זה. לוודא: כל משתנה חדש ב-destructure מוכרז ב-let, ומספר ה-soql = מספר המשתנים.

**מלכודת שנייה:** אחרי דחיפת שינוי route, הנתונים נמשכים טריים אבל ה-JS bundle בדפדפן מטמון — צריך **טעינה מחדש מלאה** של הדף כדי לראות שינויי UI. משיכת נתונים (רענן CRM) לא מספיקה לשינויי קוד.

**מיפוי משתנים ל-CARD/funnel:** anchor וריאנטים ב-app/admin/page.js — הקלפים ב-crmType==='salesforce' branch (~L2800), sfKpiCards (~L2101, מקבל _cohortCards בקריאה ב-~L3262), funnelBars + cohortFunnel/periodFunnel, branchesSec עם sfBranchLens.

**מצב פריסה נוכחי:** commit `9a6a75d` = הכל עובד, 200 על משיכה, טוגל סניפים חי. הנתונים נמשכו ל-2026-07.
