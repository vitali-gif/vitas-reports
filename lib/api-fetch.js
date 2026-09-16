'use client'
/**
 * lib/api-fetch.js — קריאה ל-API של המערכת עם זהות אמיתית.
 *
 * מחליף את התבנית הישנה `headers: { 'x-client-key': ANON_KEY }`. מפתח ה-anon
 * ציבורי (הוא מוטמע בבאנדל), ולכן הוא לא היה הרשאה אלא רק מראית עין של אחת.
 * במקומו נשלח ה-JWT של הסשן הפעיל, שהשרת מאמת מול Supabase ב-lib/auth.js.
 */
import { supabase } from './supabase'

/** הטוקן של הסשן הנוכחי, או null אם אין סשן. */
export async function accessToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  } catch {
    return null
  }
}

/**
 * כמו fetch, אבל מצרף Authorization: Bearer <token>.
 * חתימה זהה ל-fetch כדי שאפשר יהיה להחליף אותו במקום.
 *
 * ניסיון חוזר על 401: בטלפון, כשהאפליקציה חוזרת מהרקע אחרי כמה שעות, הבקשה
 * הראשונה יכולה לצאת עם טוקן שפג לפני שהספריה הספיקה לרענן אותו. השרת מחזיר
 * 401, והלקוח ראה "אין גישה" — ובפתיחה השנייה, כשהטוקן כבר רוענן ברקע, הכל עבד.
 * כאן מרעננים פעם אחת במפורש ושולחים שוב, כך שהלקוח לא רואה את זה בכלל.
 * (הקוד הישן לא נחשף לזה, כי שלח את מפתח ה-anon הקבוע ולא טוקן שפג תוקפו.)
 */
export async function apiFetch(path, options = {}) {
  const send = (token) => {
    const headers = { ...(options.headers || {}) }
    delete headers['x-client-key']            // שריד מהמנגנון הישן
    if (token) headers.Authorization = `Bearer ${token}`
    return fetch(path, { ...options, headers })
  }

  const res = await send(await accessToken())
  if (res.status !== 401) return res

  try {
    const { data } = await supabase.auth.refreshSession()
    const fresh = data?.session?.access_token
    if (fresh) return await send(fresh)
  } catch { /* הרענון נכשל — מחזירים את ה-401 המקורי */ }
  return res
}
