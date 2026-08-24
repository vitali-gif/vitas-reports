/**
 * GET /api/v1/me
 *   Authorization: Bearer <READ_TOKEN>
 * Returns what the presenting token is allowed to access (client + projects + usage).
 * Read-only, no PII. Lets a session discover its scope instead of guessing.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { CLIENTS } from '../../../../lib/apiClients'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store, max-age=0' } })

export async function GET(request) {
  const proto = request.headers.get('x-forwarded-proto')
  if (proto && proto !== 'https') return J({ error: 'https_required' }, 400)
  const auth = request.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return J({ error: 'missing_bearer_token' }, 401)
  const tokenHash = createHash('sha256').update(m[1].trim()).digest('hex')
  const { data: tok } = await supabaseAdmin
    .from('api_tokens').select('client_slug, label, created_at, last_used_at')
    .eq('token_hash', tokenHash).eq('revoked', false).maybeSingle()
  if (!tok) return J({ error: 'invalid_or_revoked_token' }, 401)

  const client = CLIENTS[tok.client_slug]
  const projects = client ? Object.keys(client.projects) : []
  return J({
    token: { label: tok.label || null, created_at: tok.created_at || null, last_used_at: tok.last_used_at || null },
    client_slug: tok.client_slug,
    client_name: client ? client.name : null,
    projects,
    usage: {
      metrics: `GET /api/v1/clients/${tok.client_slug}/metrics?project={${projects.join('|')}}&from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=campaign|adset|ad&platform=meta|google|all`,
      auth: 'Authorization: Bearer <token>',
    },
  })
}
