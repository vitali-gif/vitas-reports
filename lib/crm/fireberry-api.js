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
  // טלפון — רק לטבלת "פגישות שבוצעו", שבה יש לו עמודה משלו (כמו ב-BMBY), כדי שאיש
  // המכירות יוכל לחזור ללקוח. הוא לא נכנס לשורות המקורות ולא לרשימות המשפך.
  phone: 'telephone1',
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
const MEETING_FIELD_LIST = 'activityid,objectid,objecttitle,subject,description,scheduledstart,scheduledend,statuscode,status,ownername,createdon,objecttypecode'

/** שדות לוג השיחה. createdon הוא *מתי טיפלו בליד* — הבסיס לגרף שעות הטיפול. */
const CALL_FIELD_LIST = 'activitylognumber,objectid,objecttitle,description,createdon,createdbyname,owneridname,resultcodename,typecodename,objecttypecode'

export const FIELD_LISTS = { [OBJ.LEAD]: LEAD_FIELD_LIST, [OBJ.MEETING]: MEETING_FIELD_LIST, [OBJ.CALL_LOG]: CALL_FIELD_LIST }

export function fireberryToken() {
  const t = process.env.FIREBERRY_TOKEN
  if (!t) throw new Error('env missing: FIREBERRY_TOKEN')
  return t
}

export const isConfigured = () => Boolean(process.env.FIREBERRY_TOKEN)

// ── מגבלת קצב ────────────────────────────────────────────────────────────────
// Fireberry חוסם ב-100 קריאות לדקה לטוקן (נמדד ב-28.9: ה-429 הראשון אחרי 101
// קריאות רצופות). הטוקן הוא *של אלפא*, ואם יש להם אינטגרציות נוספות שעובדות איתו
// — טופס בדף נחיתה, סנכרון לידים — הן חולקות איתנו את אותה מכסה. דשבורד שאוכל את
// כל המכסה עלול לגרום להן להיחסם, ובמקרה הגרוע ליד שלא נכנס ל-CRM.
//
// לכן הקצב כאן 60 לדקה, ומשאיר להם 40. הוא נאכף ברמת המודול (כל הקריאות באותו
// מופע של הפונקציה עוברות דרכו), כך שגם pool עם כמה עובדים במקביל לא עובר אותו.
// הקצב ניתן לשינוי דרך FIREBERRY_RATE_PER_MIN בלי פריסה.
//
// ⚠️ ב-28.9 בדיקה ראשונה עם 8 קריאות במקביל, בלי המגבלה הזאת, חרגה מהמכסה לכ-12
//    שניות. זו הסיבה שהמגבלה כאן ולא רק "מקביליות נמוכה".
const RATE_PER_MIN = Math.max(10, Math.min(90, Number(process.env.FIREBERRY_RATE_PER_MIN) || 60))
let _nextSlot = 0
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function takeSlot() {
  const now = Date.now()
  const at = Math.max(now, _nextSlot)
  _nextSlot = at + 60000 / RATE_PER_MIN
  if (at > now) await sleep(at - now)
}

/** שגיאת 429. מי שקורא עוצר מיד ולא מנסה שוב — ניסיון חוזר רק מחמיר את החסימה. */
export class RateLimited extends Error {
  constructor() { super('Fireberry 429 — rate limit'); this.rateLimited = true }
}

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
  await takeSlot()
  const res = await fetch(`${BASE}/api/query`, {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: { 'Content-Type': 'application/json', accept: 'application/json', tokenid: fireberryToken() },
    body: JSON.stringify(body),
  })
  if (res.status === 429) throw new RateLimited()
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

// ── הערות ────────────────────────────────────────────────────────────────────
// ההערות על ליד הן ההיסטוריה של הטיפול בו: "אין מענה" של עידו ב-09:27, "מתעניין
// ומעוניין להגיע" של אופיר, סיכום הפגישה של טליה. מהן מחושבים זמני התגובה.
//
// ⚠️ אין להן שאילתה מרוכזת. /api/query לא מכיר את אובייקט ההערה (נבדק ב-28.9 על
//    כל מספר אפשרי), ורשימת ההערות של ליד מחזירה *מזהים בלבד* — בלי טקסט ובלי
//    תאריך, גם עם fields. לכן הערה = קריאה נפרדת, כ-500ms. ~4.4 הערות לליד, כלומר
//    ~1,200 קריאות לאקספו חיפה בשליפה הראשונה. זו הסיבה שהסנכרון מצטבר: כל ריצה
//    שולפת רק מזהים שעוד לא ראינו.
//
// הנתיב הוא /note ביחיד. /notes ברבים מחזיר "Invalid Object Name".
async function getJson(path, signal) {
  await takeSlot()
  const res = await fetch(`${BASE}${path}`, {
    cache: 'no-store', signal,
    headers: { accept: 'application/json', tokenid: fireberryToken() },
  })
  if (res.status === 429) throw new RateLimited()
  if (!res.ok) throw new Error(`Fireberry ${path.split('/').slice(0, 4).join('/')} HTTP ${res.status}`)
  const json = await res.json()
  if (json?.success === false) throw new Error(`Fireberry: ${String(json?.message || 'success=false').slice(0, 200)}`)
  return json?.data || {}
}

/** מזהי ההערות של ליד. עמודים של 25; התקרה מגינה מליד עם אלפי הערות אוטומטיות. */
export async function listLeadNoteIds(leadId, { signal, maxPages = 4 } = {}) {
  const ids = new Set()
  for (let page = 1; page <= maxPages; page++) {
    const d = await getJson(`/api/record/${OBJ.LEAD}/${encodeURIComponent(leadId)}/note?page_number=${page}`, signal)
    const before = ids.size
    for (const r of (d.Records || [])) if (r?.noteid) ids.add(String(r.noteid))
    // עמוד שלא הוסיף אף מזהה חדש = הפרמטר לא נתמך או שהגענו לסוף. בכל מקרה עוצרים.
    if (ids.size >= Number(d.Total_Records || 0) || ids.size === before) break
  }
  return [...ids]
}

/** הערה אחת, מצומצמת למה שצריך: מתי, מי, ומה. בלי HTML ובלי קבצים מצורפים. */
export async function getNote(noteId, { signal } = {}) {
  const d = await getJson(`/api/record/note/${encodeURIComponent(noteId)}`, signal)
  const r = d.Record || {}
  const text = String(r.notetext || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
  return {
    noteid: String(r.noteid || noteId),
    objectid: String(r.objectid || ''),
    createdon: r.createdon || '',
    by: r.createdbyname || r.ownername || '',
    text: text.slice(0, 400),
  }
}

/**
 * מריץ fn על כל פריט, עד n במקביל (הקצב עצמו נאכף ב-takeSlot). עוצר להתחיל פריטים
 * חדשים כש-shouldStop() אמת, או מיד אחרי 429 — ואז out.rateLimited = true.
 */
export async function pool(items, n, fn, shouldStop = () => false) {
  const out = []
  let i = 0
  const worker = async () => {
    while (i < items.length && !shouldStop() && !out.rateLimited) {
      const idx = i++
      try { out[idx] = { ok: true, value: await fn(items[idx]) } }
      catch (e) {
        out[idx] = { ok: false, error: String(e?.message || e).slice(0, 200) }
        if (e?.rateLimited) out.rateLimited = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
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
