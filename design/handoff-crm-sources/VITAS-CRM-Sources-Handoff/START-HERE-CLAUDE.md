# VITAS — CRM / מקורות הגעה

## התוצאה המבוקשת
יישם שדרוג חזותי ללקוח ש.ברוך, פרויקט HI PARK, טאב CRM, תת־טאב מקורות הגעה. המשך את הסגנון המאושר: סיידבר כהה, כרטיסים צבעוניים, Heebo, טבלאות בהירות וריווח נוח. שמור על מבנה הנתונים והחישובים הקיימים. לא מחליפים מערכת ולא משכתבים את כל page.js.

זו חבילת handoff עצמאית הכוללת קוד תצוגה ומפרט. אין למחבר גישה למאגר האמיתי; יש למפות את ה-props לשדות בפועל. לא קיימת הנחה שהשדות להלן תואמים ל-reports. אין לפרוס לפני הצגת התוצאה למשתמש.

## קבצים
- reference/crm-sources-style-only.png — סקיצה חזותית; יש בה שגיאות יצירת תמונה המפורטות למטה. אינה מקור לחישוב/טקסט/לוגו.
- components/CrmSources.jsx — מסך, כרטיסים, משפך, טבלת מקורות.
- components/SourceDistribution.jsx — גרף donut אופציונלי ב-Chart.js 4, עם רשימת ערכים נגישה ו-cleanup.
- components/VitasPresentation.jsx + styles/vitas-visual.css — בסיס משותף מהחבילה הקודמת, מצורף לעצמאות החבילה. אם כבר שולב במאגר, השתמש בגרסה המשולבת והתאם imports; אל תדרוס שינויים שכבר בוצעו.
- styles/crm-sources.css — עיצוב תחום ב-vcs-root. ייבוא אחרי קובץ הבסיס.
- examples/demo-model.js — נתוני הדגמה לבדיקת תצוגה בלבד.
- SCREEN-SPEC.md — הסמנטיקה וההתנהגות המדויקות.
- ACCEPTANCE.md — בדיקות קבלה.

## סטאק
React 18, Next.js 14 App Router, CSS classes, Heebo, RTL, lucide-react, Chart.js 4 ישירות על canvas. אין להוסיף Tailwind, shadcn או react-chartjs-2. אין inline styles ב-JSX. שימוש ב-inline-start/end ו-block-start/end. ה-CSS אינו משנה :root גלובלית.

## שלבי יישום
1. קרא AGENTS.md/CLAUDE.md והוראות הפרויקט. בדוק git status ושמור על שינויים קיימים. עבוד בענף מתאים.
2. קרא את אזור CRM sources ב-app/admin/page.js, רכיבי shell וקובצי CSS הרלוונטיים. זהה מקורות, סטטוסים, חישובים, הרשאות, רענון וייצוא קיימים. שמור baseline של נתונים וצילום.
3. אל תחליף את Header/Sidebar/Tabs/date controls. המסך החדש משתלב בתוכן הנוכחי; CrmSources אינו יוצר main ולכן מתאים בתוך main קיים. מצבי הטאב/תת־טאב נשארים מנוהלים בידי ההורה.
4. העתק/שלב את רכיבי התצוגה בתיקייה ייעודית. ייבא CSS פעם אחת לפי מוסכמות Next הקיימות, אחרי globals.css והבסיס. הגבל לפיילוט נדל״ן; KLOSS/BCure לא משתנים.
5. צור adapter מפורש מהנתונים הקיימים למודל התצוגה. אל תשנה נוסחאות כדי להתאים לדוגמה. אם הגדרת טבלה או מדד שונה מהמפרט, תעד והצג את ההגדרה הנכונה; אל תציג כותרת שקרית.
6. חבר את handlers הקיימים ל-onRefresh/onExport/onSort/onOpenSource/onPlatformChange. אל תציג כפתור שאין מאחוריו פעולה. כפתור ״עמודות״ שבסקיצה אינו כלול בקוד: הוסף רק אם כבר קיימת יכולת בחירת עמודות.
7. הגרף הקיים יכול לעבור כ-chart slot. אם משתמשים ב-SourceDistribution המצורף, ודא שמופע הגרף הישן הוסר/נהרס. אין להציג canvas כפול. השתמש במערך items יציב (useMemo).
8. ודא החלפת פרויקט/טווח בטוחה: תגובה ישנה לא מוצגת תחת כותרת חדשה. בזמן החלפה הצג state='loading' עם model=null. כשטוענים פלטפורמה אחרת במשפך בלבד, העבר funnelState='loading'; יתר המסך נשאר ללא שינוי.
9. בדוק גישת לקוח, RTL, נתוני 0/חוסר מידע, מיון, פתיחה וייצוא. הרץ build/lint לפי scripts הקיימים והשווה צילומי מסך מול הסקיצה והמפרט.
10. הצג צילום דסקטופ + סיכום שינויי קבצים + בדיקות + פערים לפני פריסה.

## תיקונים מחייבים לסקיצה
- חשיפות לפני קליקים בסדר RTL, ולא להפך.
- המשפך בדוגמה: 186→130→26→16→3→1. האחוזים על המעבר הם 69.9%, 20%, 61.5%, 18.8%, 33.3%. התמונה כוללת אחוזים מוטעים. ב-production משתמשים בנוסחאות האמיתיות ומציינים את המכנה בפועל, גם אם שונה מהדוגמה.
- ביטולים הם ענף מפגישות שנקבעו, אינם שלב בדרך להרשמה. אין להסיק שיתרת הפגישות היא ״לא הגיעו״ בלי שדה מתאים.
- בטבלה בדיוק 13 עמודות לפי SOURCE_COLUMNS. אין עמודת ״תואמו״ כפולה. שורת סיכום היא tfoot.
- הלוגו והבניינים בסיידבר בתמונה אינם מקור למיתוג. השתמש בלוגו VITAS המקורי ובמעטפת שכבר קיימת.
- אין להקטין טקסט כדי לדחוס טבלה. מקור sticky בצד ימין, גלילה אופקית מקומית, מינימום רוחב 1320px.

## חוזה הרכבה
CrmSources מקבל:
- model: metricsScope, metrics (8 כרטיסים), funnel, table, distributionScope.
- state: ready/loading/error/empty/missing. במצב שאינו ready מותר model=null.
- platforms: [{id,label}], selectedPlatform, onPlatformChange. IDs מגיעים מהפרויקט, לא שמות מוחלטים מהדוגמה.
- funnelState: מצב טעינת המשפך בנפרד.
- onRefresh, refreshing, onRetry, onExport, onOpenSource.
- sort={key,direction:'asc'|'desc'}, onSort. ההורה מחזיר rows ממוינים; הרכיב לא ממיין.
- chart: ReactNode; מומלץ הגרף הקיים או SourceDistribution עם נתוני raw numeric.
- additionalContent: מקום לשימור בלוקים קיימים מחוץ לארבעת חלקי המסך, למשל ״עלות לתוצאה לפי מודעה״ אם קיים. אין למחוק יכולת קיימת כי אינה מצוירת בסקיצה.

הכרטיסים מקבלים icon כרכיב lucide, label, value מוכן, tone, details. שמות/מדדי/אחוזי funnel נמסרים מה-adapter, בלי חישוב עסקי ברכיבי התצוגה. table.rows הם [{id,cells:{...13 keys}}], total באותו מבנה. ערך חסר הוא null ולא 0; לא לחשב עלות/יחס עם מכנה אפס.

## שימוש בגרף
SourceDistribution מקבל items=[{id,label,value:number|null}]. הוא מחשב רק סך התצוגה ואחוז מתוך כלל הלידים לציור, לא יעילות/המרות. missing value לא הופך לאפס. כל הנתונים נשארים קריאים ברשימה. אם יש סוג מקור לא משויך, כלול אותו במקום להשמיטו כדי לשמור על הסכום.

## ייבוא הרכיבים

```jsx
import { CrmSources } from './CrmSources';
import SourceDistribution from './SourceDistribution';
```

SourceDistribution הוא default export; שאר רכיבי התצוגה הם named exports. התאם את הנתיבים למיקום האמיתי בפרויקט. טען תחילה vitas-visual.css ולאחריו crm-sources.css. אין להוסיף route חדש או מסך דמו ציבורי; שלב בתת-הטאב הקיים. VALIDATION.md מתעד את הבדיקות שבוצעו בחבילה ואת הבדיקות שנותרו לשילוב.
