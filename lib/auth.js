// lib/auth.js — server-side auth for API routes.
//
// Replaces the old "x-client-key = NEXT_PUBLIC_SUPABASE_ANON_KEY" pattern, which was
// NOT auth (the anon key ships in the browser bundle and is public).
//
// Callers authenticate one of two ways:
//   1. User JWT:  Authorization: Bearer <supabase access_token>
//      - admin  = email listed in ADMIN_EMAILS env (comma-separated) or DEFAULT_ADMINS
//      - client = any other authenticated user; may only touch projects granted in client_access
//   2. Cron/internal: x-cron-secret: <CRON_SECRET>  (or Authorization: Bearer <CRON_SECRET>)
import { createClient } from '@supabase/supabase-js'

const DEFAULT_ADMINS = ['vitali@vitas.co.il', 'vitalidisel@gmail.com']

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export function adminEmails() {
  const env = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return env.length ? env : DEFAULT_ADMINS
}

export function isCronRequest(request) {
  const secret = process.env.CRON_SECRET || ''
  if (!secret) return false
  const header = request.headers.get('x-cron-secret') || ''
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return header === secret || bearer === secret
}

export async function getAuthUser(request) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return null
  try {
    const { data, error } = await adminClient().auth.getUser(bearer)
    if (error || !data?.user?.email) return null
    const email = data.user.email.toLowerCase()
    return { email, isAdmin: adminEmails().includes(email) }
  } catch { return null }
}

export async function allowedProjectIdsFor(email) {
  try {
    const { data } = await adminClient().from('client_access').select('project_id').eq('email', email)
    return (data || []).map(r => r.project_id).filter(Boolean)
  } catch { return [] }
}

// Central gate for API routes.
// opts: { adminOnly: bool, projectId: string|null, allowCron: bool }
// Returns { ok, status?, error?, user?, allowed? } — never throws.
export async function requireAuth(request, opts = {}) {
  if (opts.allowCron && isCronRequest(request)) {
    return { ok: true, user: { email: 'cron', isAdmin: true, isCron: true } }
  }
  const user = await getAuthUser(request)
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }
  if (user.isAdmin) return { ok: true, user }
  if (opts.adminOnly) return { ok: false, status: 403, error: 'Forbidden' }
  const allowed = await allowedProjectIdsFor(user.email)
  if (opts.projectId && !allowed.includes(opts.projectId)) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  return { ok: true, user, allowed }
}
