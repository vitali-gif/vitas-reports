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
 */
export async function apiFetch(path, options = {}) {
  const token = await accessToken()
  const headers = { ...(options.headers || {}) }
  delete headers['x-client-key']            // שריד מהמנגנון הישן
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(path, { ...options, headers })
}
