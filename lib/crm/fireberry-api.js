/**
 * lib/crm/fireberry-api.js — קריאות בסיס ל-Fireberry (לשעבר Powerlink).
 *
 * התיעוד הרשמי: https://github.com/powerlink/Rest-API
 * האימות הוא כותרת `tokenid` יחידה — אין OAuth, אין רענון, אין תפוגה. לכן אין כאן
 * מטמון אסימונים כמו ב-Zoho; מה שיש הוא רק דפדוף ותקרת עמודים.
 *
 * ⚠️ הטוקן הוא מפתח ארגוני שנותן גישה *לכתיבה ולמחיקה* על כל ה-CRM של הלקוח. כאן
 *    משתמשים אך ורק ב-/api/query, שהוא POST לקריאה בלבד. אין בקובץ הזה create/update/delete
 *    בכוונה — אם יום אחד נצטרך לכתוב ל-Fireberry, זה קובץ נפרד עם שער משלו.
 */

const BASE = process.env.FIREBERRY_API_BASE || 'https://api.fireberry.com'

/** סוגי הרשומות שאנחנו קוראים. המספרים מגיעים מ-/metadata/records של החשבון. */
export const OBJ = {
  LEAD: 1,        // "לקוח" (Account) — זו רשומת הליד אצל אלפא, לא רשומת לקוח משלם
  MEETING: 6,     // "פגישה" (Activity)
  CALL_LOG: 102,  // "לוג שיחה" (ActivityLog) — הטיפול בליד, עם חותמת זמן
}

/**
 * השדות של אובייקט הליד. Fireberry מחזיר שדות מותאמים אישית בשמות גנריים
 * (pcfsystemfieldNNN), ולכן בלי המפה הזאת הנתונים בלתי קריאים לגמרי.
 * המפה אומתה מול /metadata/records ומול הנתונים עצמם (28.9.2026).
 */
export const LEAD_FIELDS = {
  id: 'accountid',
  name: 'accountname',
  createdOn: 'createdon',
  status: 'statuscode',              // חדש / אין מענה / תואמה פגישה / לא רלוונטי ...
  source: 'originatingleadcode',     // פייסבוק / גוגל / ווטסאפ ...
  owner: 'ownername',                // "מנהל לקוח" — הטלמיטינג שקובע פגישות
  salesRep: 'pcfsystemfield212name', // "איש מכירות" — מי שמבצע את הפגישה
  note: 'pcfsystemfield182',         // הערה של איש המכירות
  mailingOptIn: 'pcfsystemfield184name',
  project: 'pcfsystemfield174name',  // "פרויקט" — אקספו חיפה / אלפא טק
  crmCampaign: 'campaignname',       // קמפיין ה-CRM (ויטאס & AllMarket / לאוס)
  campaign: 'pcfsystemfield185',     // שם קמפיין הפרסום
  adset: 'pcfsystemfield186',        // שם קהל
  ad: 'pcfsystemfield187',           // שם מודעה
  campaignId: 'pcfsystemfield188',
  adsetId: 'pcfsystemfield189',
  adId: 'pcfsystemfield190',
  gclid: 'pcfsystemfield193',
  fbclid: 'pcfsystemfield196',
  landingPage: 'pcfsystemfield210',  // גרסת דף נחיתה
  dealClosed: 'pcfsystemfield173name',
}

const LEAD_FIELD_LIST = Object.values(LEAD_FIELDS).join(',')

/** שדות הפגישה. objectid מצביע על הליד, scheduledstart הוא מועד הפגישה. */
const MEETING_FIELD_LIST = 'activityid,objectid,objecttitle,subject,scheduledstart,scheduledend,statuscode,status,ownername,createdon,objecttypecode'

/** שדות לוג השיחה. createdon הוא *מתי טיפלו בליד* — הבסיס לגרף שעות הטיפול. */
const CALL_FIELD_LIST = 'activitylognumber,objectid,objecttitle,description,createdon,createdbyname,owneridname,resultcodename,typecodename,objecttypecode'

export const FIELD_LISTS = { [OBJ.LEAD]: LEAD_FIELD_LIST, [OBJ.MEETING]: MEETING_FIELD_LIST, [OBJ.CALL_LOG]: CALL_FIELD_LIST }

export function fireberryToken() {
  const t = process.env.FIREBERRY_TOKEN
  if (!t) throw new Error('env missing: FIREBERRY_TOKEN')
  return t
}

export const isConfigured = () => Boolean(process.env.FIREBERRY_TOKEN)

/**
 * עמוד אחד מ-/api/query.
 * @returns {Promise<{rows:any[], isLastPage:boolean}>}
 */
export async function queryPage(objectType, { page = 1, pageSize = 500, query, sortBy = 'createdon', sortType = 'desc', signal } = {}) {
  const body = {
    objecttype: objectType,
    page_number: page,
    page_size: pageSize,
    fields: FIELD_LISTS[objectType] || '*',
    sort_by: sortBy,
    sort_type: sortType,
  }
  if (query) body.query = query
  const res = await fetch(`${BASE}/api/query`, {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: { 'Content-Type': 'application/json', accept: 'application/json', tokenid: fireberryToken() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Fireberry ${objectType} HTTP ${res.status}: ${txt.slice(0, 200)}`)
  }
  const json = await res.json()
  // ⚠️ Fireberry מחזיר 200 גם על שגיאה — success:false בגוף. בלי הבדיקה הזאת שגיאת
  //    הרשאה נראית כמו "אפס רשומות", וזה בדיוק הכשל השקט שאי אפשר לאבחן מהדשבורד.
  if (json?.success === false) throw new Error(`Fireberry ${objectType}: ${String(json?.message || 'success=false').slice(0, 200)}`)
  const d = json?.data || {}
  return { rows: Array.isArray(d.Data) ? d.Data : [], isLastPage: d.IsLastPage !== false }
}

/**
 * כל העמודים, עד תקרה. התקרה קיימת כדי שטעות בסינון לא תמשוך עשרות אלפי רשומות
 * בתוך פונקציית serverless עם תקציב זמן.
 */
export async function queryAll(objectType, { pageSize = 500, maxPages = 20, query, signal } = {}) {
  const out = []
  for (let page = 1; page <= maxPages; page++) {
    const { rows, isLastPage } = await queryPage(objectType, { page, pageSize, query, signal })
    out.push(...rows)
    if (isLastPage || rows.length === 0) return { rows: out, pages: page, truncated: false }
  }
  return { rows: out, pages: maxPages, truncated: true }
}
