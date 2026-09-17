/**
 * lib/crm/schema-version.js — גרסאות הסכמה של הסיכומים השמורים, במקום אחד.
 *
 * עד 16.9 הקבועים היו כפולים: 33 בשרת (bmby/fetch) מול 14 בשני מקומות בדשבורד,
 * ו-2 של Google בשני מקומות. הדשבורד משתמש בהם כדי להחליט אם דוח שמור ישן מדי
 * ולמשוך מחדש — ערך לא מעודכן = משיכות חיות מיותרות או דוח ישן שלא מתרענן.
 * להעלות כאן בכל שינוי בצורת xlsxRows / summary של המקור המתאים.
 */
export const CRM_SCHEMA_VERSION = 33     // v33: cid + שם מודעה על כל ליד (פופ-אפ התנגדויות) + cid על completedMeetings (היסטוריית הערות)
export const ZOHO_SCHEMA_VERSION = 2     // Zoho (BCureLaser / ISMOOTH)
export const GOOGLE_SCHEMA_VERSION = 2   // bump when the stored Google summary shape changes
