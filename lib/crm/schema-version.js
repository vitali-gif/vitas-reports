/**
 * lib/crm/schema-version.js — גרסאות הסכמה של הסיכומים השמורים, במקום אחד.
 *
 * עד 16.9 הקבועים היו כפולים: 33 בשרת (bmby/fetch) מול 14 בשני מקומות בדשבורד,
 * ו-2 של Google בשני מקומות. הדשבורד משתמש בהם כדי להחליט אם דוח שמור ישן מדי
 * ולמשוך מחדש — ערך לא מעודכן = משיכות חיות מיותרות או דוח ישן שלא מתרענן.
 * להעלות כאן בכל שינוי בצורת xlsxRows / summary של המקור המתאים.
 */
export const CRM_SCHEMA_VERSION = 34     // v34: responseTimeStats.noResponseBySource/ByUser (טרם התקיימה שיחה לפי מקור/נציג). v33: cid + שם מודעה על כל ליד + cid על completedMeetings
export const ZOHO_SCHEMA_VERSION = 2     // Zoho (BCureLaser / ISMOOTH)
export const SF_SCHEMA_VERSION = 10      // Salesforce (KLOSS)
export const GOOGLE_SCHEMA_VERSION = 2   // bump when the stored Google summary shape changes
