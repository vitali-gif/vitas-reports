/**
 * lib/auth.js — שכבת ההרשאות של ה-API.
 *
 * הרקע: עד עכשיו כל route "מוגן" בדק `x-client-key === NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * מפתח ה-anon מוטמע בבאנדל בזמן build — זה תפקידה של התחילית NEXT_PUBLIC_ — ולכן
 * הוא זמין לכל מי שפותח את האתר, גם בלי להתחבר. כלומר לא הייתה שם הרשאה בכלל.
 * (app/api/bmby/debug/route.js כבר תיעד את זה ועבר ל-CRON_SECRET; כאן זה מוחל על הכל.)
 *
 * שלושה סוגי קוראים, שלושה מנגנונים:
 *   1. דפדפן — JWT של Supabase ב-Authorization: Bearer. מאומת מול שרת ה-Auth,
 *      כך שגם ניתוק משתמש או ביטול טוקן נתפסים.
 *   2. אדמין — אותו JWT, ובנוסף המייל חייב להופיע ב-ADMIN_EMAILS.
 *   3. שרת-לשרת (קרונים, fan-out פנימי) — CRON_SECRET, שכבר קיים בסביבה.
 *
 * כל הפונקציות מחזירות { ok: true, ... } או { ok: false, res } — ה-route רק מחזיר
 * את res כמו שהוא. פועלות fail-closed: משתנה סביבה חסר = דחייה, לא מעבר.
 */
import { createClient } from '@supabase/supabase-js'

/** לקוח service_role. זורק אם המפתח חסר במקום ליפול חזרה ל-anon בשקט. */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

const json = (body, status) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export const unauthorized = (msg = 'Unauthorized') => json({ error: msg }, 401)
export const forbidden = (msg = 'Forbidden') => json({ error: msg }, 403)

function bearerOf(req) {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

/**
 * קריאה פנימית שרת-לשרת. CRON_SECRET מגיע או כ-x-internal-key או כ-Bearer
 * (Vercel Cron שולח אותו כ-Bearer בעצמו).
 */
export function isInternalCall(req) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('x-internal-key')
  return header === secret || bearerOf(req) === secret
}

/** הכותרות שקריאה פנימית צריכה לשאת. לשימוש הקרונים. */
export function internalHeaders(extra = {}) {
  return { 'x-internal-key': process.env.CRON_SECRET || '', ...extra }
}

/**
 * מזהה את המשתמש מה-JWT ומאמת אותו מול Supabase.
 * bodyToken קיים בשביל navigator.sendBeacon, שלא יכול לשאת כותרות.
 */
export async function getUser(req, bodyToken = null) {
  const token = bearerOf(req) || bodyToken
  if (!token) return null
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return null
  try {
    const { data, error } = await adminClient().auth.getUser(token)
    if (error || !data?.user?.email) return null
    return { id: data.user.id, email: data.user.email.toLowerCase().trim() }
  } catch {
    return null
  }
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export function isAdminEmail(email) {
  if (!email) return false
  const list = adminEmails()
  if (!list.length) return false   // fail-closed: בלי ADMIN_EMAILS אין אדמינים
  return list.includes(email.toLowerCase().trim())
}

/** משתמש מחובר כלשהו (לקוח או אדמין). */
export async function requireUser(req, bodyToken = null) {
  const user = await getUser(req, bodyToken)
  if (!user) return { ok: false, res: unauthorized() }
  return { ok: true, user }
}

/** אדמין בלבד. קריאה פנימית עוברת גם היא (קרונים שמפעילים משיכות). */
export async function requireAdmin(req) {
  if (isInternalCall(req)) return { ok: true, user: null, internal: true }
  const user = await getUser(req)
  if (!user) return { ok: false, res: unauthorized() }
  if (!isAdminEmail(user.email)) return { ok: false, res: forbidden('Admin access required') }
  return { ok: true, user, internal: false }
}

/**
 * גישה לפרויקט מסוים — התיקון ל-IDOR.
 * אדמין וקריאה פנימית עוברים; לקוח נבדק מול client_access.
 */
export async function requireProjectAccess(req, projectId, bodyToken = null) {
  if (!projectId) return { ok: false, res: json({ error: 'projectId required' }, 400) }
  if (isInternalCall(req)) return { ok: true, user: null, internal: true }

  const user = await getUser(req, bodyToken)
  if (!user) return { ok: false, res: unauthorized() }
  if (isAdminEmail(user.email)) return { ok: true, user, internal: false }

  const { data, error } = await adminClient()
    .from('client_access')
    .select('id')
    .eq('email', user.email)
    .eq('project_id', projectId)
    .limit(1)

  if (error) return { ok: false, res: json({ error: 'access check failed' }, 500) }
  if (!data?.length) return { ok: false, res: forbidden('No access to this project') }
  return { ok: true, user, internal: false }
}

/** רשימת הפרויקטים שהמשתמש רשאי לראות. */
export async function allowedProjectIds(email) {
  const { data } = await adminClient()
    .from('client_access').select('project_id').eq('email', email.toLowerCase().trim())
  return (data || []).map(r => r.project_id)
}

/** escaping לפני הזרקה ל-HTML של מיילים. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
