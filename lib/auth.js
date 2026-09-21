/**
 * lib/auth.js — שכבת ההרשאות של ה-API.
 *
 * הרקע: עד עכשיו כל route "מוגן" בדק `x-client-key === NEXT_PUBLIC_SUPABASE_ANON_KEY`.
 * מפתח ה-anon מוטמע בבאנדל בזמן build — זה תפקידה של התחילית NEXT_PUBLIC_ — ולכן
 * הוא זמין לכל מי שפותח את האתר, גם בלי להתחבר. כלומר לא הייתה שם הרשאה בכלל.
 * (app/api/bmby/debug/route.js כבר תיעד את זה ועבר ל-CRON_SECRET; כאן זה מוחל על הכל.)
 *
 * שלושה סוגי קוראים, שלושה מנגנונים:
 *   1. דפדפן — JWT של Supabase ב-Authorization: Bearer. מאומת מקומית מול המפתח הציבורי
 *      של הפרויקט (JWKS, ES256) — בלי תלות בשרת ה-Auth. ראה getUser.
 *   2. אדמין — אותו JWT, ובנוסף המייל נמצא בטבלת admins בבסיס הנתונים.
 *   3. שרת-לשרת (קרונים, fan-out פנימי) — CRON_SECRET, שכבר קיים בסביבה.
 *
 * כל הפונקציות מחזירות { ok: true, ... } או { ok: false, res } — ה-route רק מחזיר
 * את res כמו שהוא. פועלות fail-closed: משתנה סביבה חסר = דחייה, לא מעבר.
 */
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, errors as joseErrors } from 'jose'

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

// המפתח הציבורי של הפרויקט (JWKS). jose שומר אותו במטמון ומרענן לבד; נטען פעם אחת לכל instance.
let _jwks = null
function jwks() {
  if (_jwks) return _jwks
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return null
  _jwks = createRemoteJWKSet(new URL(url.replace(/\/$/, '') + '/auth/v1/.well-known/jwks.json'), {
    cooldownDuration: 30_000, cacheMaxAge: 600_000, timeoutDuration: 5_000,
  })
  return _jwks
}

/**
 * מזהה את המשתמש מה-JWT.
 *
 * עד 17.9 כל בקשה אומתה מול שרת ה-Auth של Supabase (auth.getUser), שקורא מבסיס הנתונים.
 * כשקרון ה-CRM העמיס על ה-DB (13:37: deadlocks + statement timeouts), שרת ה-Auth ענה
 * ב-504, getUser החזיר null, כל ה-API ענה 401 — ולקוחה ראתה דשבורד ריק. האימות לא צריך
 * את ה-DB בכלל: הטוקן חתום (ES256) והמפתח הציבורי זמין ב-JWKS. אז מאמתים מקומית — מיידי,
 * ולא תלוי בעומס. שרת ה-Auth נשאר רק כנפילה-חזרה (טוקן ישן HS256, או ש-JWKS לא נגיש).
 *
 * המשמעות: טוקן שבוטל (התנתקות) תקף עד שפג (שעה). ההרשאות עצמן (admins, client_access)
 * נבדקות בכל בקשה בכל מקרה, ולכן הסרת גישה נתפסת מיד.
 * bodyToken קיים בשביל navigator.sendBeacon, שלא יכול לשאת כותרות.
 */
export async function getUser(req, bodyToken = null) {
  const token = bearerOf(req) || bodyToken
  if (!token) return null
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return null

  // 1. מקומי
  const local = await verifyLocally(token)
  if (local.ok) return local.user
  if (!local.fallback) return null

  // 2. שרת ה-Auth
  try {
    const { data, error } = await adminClient().auth.getUser(token)
    if (error || !data?.user?.email) return null
    return { id: data.user.id, email: data.user.email.toLowerCase().trim() }
  } catch {
    return null
  }
}

/** @returns {{ok:true,user:{id,email}} | {ok:false,fallback:boolean}} fallback=true כשהכישלון אינו בטוקן עצמו */
async function verifyLocally(token) {
  try {
    const header = decodeProtectedHeader(token)
    if (!header.alg || header.alg.startsWith('HS')) return { ok: false, fallback: true }   // חתימה סימטרית ישנה — רק השרת יכול לאמת
    const keys = jwks()
    if (!keys) return { ok: false, fallback: true }
    const issuer = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '') + '/auth/v1'
    const { payload } = await jwtVerify(token, keys, { issuer, audience: 'authenticated' })
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : ''
    if (!payload.sub || !email) return { ok: false, fallback: false }
    return { ok: true, user: { id: String(payload.sub), email } }
  } catch (e) {
    // הטוקן עצמו פסול (פג, חתימה לא תואמת, claims לא תקפים) — אין טעם לשאול את השרת.
    if (e instanceof joseErrors.JWTExpired || e instanceof joseErrors.JWSSignatureVerificationFailed
        || e instanceof joseErrors.JWTClaimValidationFailed || e instanceof joseErrors.JWSInvalid || e instanceof joseErrors.JWTInvalid) {
      return { ok: false, fallback: false }
    }
    return { ok: false, fallback: true }   // JWKS לא נגיש / מפתח לא מוכר (רוטציה) — השרת יכריע
  }
}

/**
 * האם המייל שייך לאדמין. מקור האמת הוא טבלת `admins` בבסיס הנתונים — אותה
 * טבלה שמדיניות ה-RLS (is_admin()) קוראת.
 *
 * עד 14.9 הבדיקה כאן נשענה על משתנה סביבה ב-Vercel (ADMIN_EMAILS), בעוד שה-RLS
 * נשען על הטבלה. שני מקורות לאותה עובדה נפרדו, וכל קריאות ה-API של האדמין חזרו
 * ריקות. מ-16.9 המשתנה הוסר לגמרי: מקור אחד בלבד. הוספת אדמין = שורה בטבלה.
 *
 * fail-closed: שגיאה בשאילתה = לא אדמין.
 */
export async function isAdminEmail(email) {
  if (!email) return false
  const e = email.toLowerCase().trim()
  try {
    const { data, error } = await adminClient()
      .from('admins').select('email').eq('email', e).maybeSingle()
    if (error) return false
    return !!data
  } catch {
    return false
  }
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
  if (!(await isAdminEmail(user.email))) return { ok: false, res: forbidden('Admin access required') }
  return { ok: true, user, internal: false }
}

/**
 * גישה לפרויקט מסוים — התיקון ל-IDOR.
 * אדמין וקריאה פנימית עוברים; לקוח נבדק מול client_access.
 */
export async function requireProjectAccess(req, projectId, bodyToken = null) {
  if (!projectId) return { ok: false, res: json({ error: 'projectId required' }, 400) }
  if (isInternalCall(req)) return { ok: true, user: null, internal: true, admin: true }

  const user = await getUser(req, bodyToken)
  if (!user) return { ok: false, res: unauthorized() }
  if (await isAdminEmail(user.email)) return { ok: true, user, internal: false, admin: true }

  const { data, error } = await adminClient()
    .from('client_access')
    .select('id')
    .eq('email', user.email)
    .eq('project_id', projectId)
    .limit(1)

  if (error) return { ok: false, res: json({ error: 'access check failed' }, 500) }
  if (!data?.length) return { ok: false, res: forbidden('No access to this project') }
  return { ok: true, user, internal: false, admin: false }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * מנויים (PRO)
 *
 * המנוי יושב על הלקוח — עמודה `plan` ב-clients, מיגרציה 020 — ופרויקט יורש אותו
 * דרך projects.client_id. הוא נקרא כאן בלבד. התגית "PRO" בממשק היא שילוט ואינה
 * הרשאה: CLAUDE.md אוסר להסתמך על הסתרה ב-UI, ולכן כל route של פיצ'ר PRO חייב
 * לעבור דרך requireProjectPlan ולא להסתפק בכך שהכפתור לא מוצג.
 *
 * fail-closed לאורך כל הדרך: עמודה חסרה, שגיאת שאילתה או ערך לא מוכר = basic.
 * ═══════════════════════════════════════════════════════════════════════════ */

const PLAN_RANK = { basic: 0, pro: 1 }

/** כל מה שאינו 'pro' הוא 'basic'. */
export const normalizePlan = (value) =>
  String(value || '').toLowerCase().trim() === 'pro' ? 'pro' : 'basic'

/** האם המנוי שיש מספיק למה שנדרש. ערך לא מוכר בשני הצדדים נחשב basic. */
export const planAllows = (actual, required = 'pro') =>
  (PLAN_RANK[normalizePlan(actual)] ?? 0) >= (PLAN_RANK[normalizePlan(required)] ?? 0)

/** המנוי של הלקוח שמחזיק את הפרויקט. */
export async function projectPlan(projectId) {
  if (!projectId) return 'basic'
  try {
    const { data, error } = await adminClient()
      .from('projects').select('clients(plan)').eq('id', projectId).maybeSingle()
    if (error || !data) return 'basic'
    // PostgREST מחזיר יחס many-to-one כאובייקט, אבל גרסאות מסוימות מחזירות מערך
    // בן איבר אחד. שגיאה כאן שקולה לנעילת הפיצ'ר אצל לקוח משלם, ולכן שני המקרים.
    const client = Array.isArray(data.clients) ? data.clients[0] : data.clients
    return normalizePlan(client?.plan)
  } catch {
    return 'basic'
  }
}

/**
 * 403 של מנוי — נפרד מ-403 של הרשאה.
 * ה-code קיים כדי שהדפדפן יוכל להציג מסך שדרוג ("זה פיצ'ר PRO") במקום "אין גישה",
 * שהוא מסר שונה לגמרי ללקוח שכן רשאי לראות את הפרויקט.
 */
export const planRequired = (plan = 'pro') => json({
  error: `הפיצ'ר הזה זמין למנויי ${plan.toUpperCase()}`,
  code: 'PLAN_REQUIRED',
  requiredPlan: plan,
}, 403)

/**
 * גישה לפרויקט **וגם** מנוי מתאים.
 * אדמין וקריאה פנימית עוברים תמיד — לצוות VITAS יש גישה לכל פיצ'ר בכל לקוח,
 * והקרונים אינם לקוח.
 */
export async function requireProjectPlan(req, projectId, minPlan = 'pro', bodyToken = null) {
  const gate = await requireProjectAccess(req, projectId, bodyToken)
  if (!gate.ok) return gate
  if (gate.admin) return { ...gate, plan: 'pro' }

  const plan = await projectPlan(projectId)
  if (!planAllows(plan, minPlan)) return { ok: false, res: planRequired(minPlan) }
  return { ...gate, plan }
}

/**
 * הרשאה למשיכה חיה (meta/google/bmby/zoho/salesforce fetch).
 *
 * קריאה פנימית ואדמין עוברים תמיד. לקוח עובר רק עם projectId מפורש של פרויקט
 * שהוא רשאי לראות, ובהגבלת קצב — משיכה חיה מפעילה את ה-API של Meta/Google/BMBY
 * ויכולה לרוץ דקות. עד 16.9 המסלול היה אדמין-בלבד (וגם הדפדפן שלח אותו בלי
 * טוקן), ולכן לקוח שבחר טווח תאריכים מותאם — שהקרון לא מחמם — ראה אפסים.
 *
 * מחזיר גם admin:true/false, כדי שה-route יסתיר אופציות דיבוג ממי שאינו אדמין.
 */
export async function requireFetchAccess(req, projectId) {
  if (isInternalCall(req)) return { ok: true, user: null, internal: true, admin: true }
  const user = await getUser(req)
  if (!user) return { ok: false, res: unauthorized() }
  if (await isAdminEmail(user.email)) return { ok: true, user, internal: false, admin: true }

  if (!projectId) return { ok: false, res: forbidden('Admin access required for a fetch without projectId') }
  const { data, error } = await adminClient()
    .from('client_access').select('id')
    .eq('email', user.email).eq('project_id', projectId).limit(1)
  if (error) return { ok: false, res: json({ error: 'access check failed' }, 500) }
  if (!data?.length) return { ok: false, res: forbidden('No access to this project') }

  // ייבוא דינמי: rate-limit.js מייבא adminClient מכאן, וייבוא סטטי היה מעגלי.
  const { rateLimit, tooManyRequests } = await import('./rate-limit')
  const rl = await rateLimit('live-fetch', user.email, 12, 3600)
  if (!rl.ok) return { ok: false, res: tooManyRequests(rl.retryAfterSec) }
  return { ok: true, user, internal: false, admin: false }
}

/**
 * טוקן ניטור מטבלת api_tokens (client_slug = '*'), כמו ב-/api/v1/health.
 * מחזיר את שורת הטוקן או null. מיועד לנקודות קצה שמחזירות אגרגטים בלבד, בלי PII.
 */
export async function monitorTokenOf(req) {
  const t = bearerOf(req)
  if (!t) return null
  const hash = createHash('sha256').update(t).digest('hex')
  const { data } = await adminClient().from('api_tokens').select('id, client_slug, label')
    .eq('token_hash', hash).eq('revoked', false).maybeSingle()
  return data && data.client_slug === '*' ? data : null
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
