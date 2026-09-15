/**
 * GET /api/v1/me
 *   Authorization: Bearer <READ_TOKEN>
 * Returns what the presenting token is allowed to access (client + projects + usage).
 * Read-only, no PII. Lets a session discover its scope instead of guessing.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { adminClient } from '../../../../lib/auth'
import { CLIENTS } from '../../../../lib/apiClients'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

// לקוח service_role עצל. קודם הוא נוצר ברמת המודול עם נפילה חזרה למפתח
// ה-anon — כלומר אם SUPABASE_SERVICE_ROLE_KEY חסר בסביבה, ה-route המשיך לעבוד
// בשקט עם הרשאות נמוכות והחזיר תוצאות חלקיות, שנראות כמו באג בנתונים ולא
// כתקלת קונפיגורציה. עכשיו הוא נוצר בבקשה הראשונה (לא בזמן build) וזורק
// שגיאה מפורשת אם המפתח חסר. ה-Proxy קיים כדי שמוקדי השימוש יישארו כמו שהם.
let _sbAdmin = null
const supabaseAdmin = new Proxy({}, {
  get(_target, prop) {
    if (!_sbAdmin) _sbAdmin = adminClient()
    const value = _sbAdmin[prop]
    return typeof value === 'function' ? value.bind(_sbAdmin) : value
  },
})
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
