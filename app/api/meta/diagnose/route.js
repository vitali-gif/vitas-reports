// API route: /api/meta/diagnose
//   GET — diagnostic. Returns:
//     - Token's granted permissions (so we know if ads_management is included)
//     - Ad account info
//     - List of existing automated rules in the account
//
// Auth: requires CRON_SECRET via Authorization: Bearer (so this isn't world-readable)
// OR x-client-key = anon key (so we can call it from the admin UI).

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'

const META_GRAPH_VERSION = 'v21.0'

async function fetchJson(url) {
  const res = await fetch(url)
  let body
  try { body = await res.json() } catch { body = { error: 'non-json response' } }
  return { status: res.status, ok: res.ok, body }
}

export async function GET(request) {
  // Auth: accept either anon key in x-client-key OR CRON_SECRET as Bearer

  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '')
  const okAnon = (await requireAuth(request, { adminOnly: true })).ok
  const okCron = process.env.CRON_SECRET && bearer === process.env.CRON_SECRET
  if (!okAnon && !okCron) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID
  if (!token || !adAccountId) {
    return Response.json({ error: 'Missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID env vars' }, { status: 500 })
  }

  const result = {
    adAccountId,
    apiVersion: META_GRAPH_VERSION,
  }

  // 1. Token permissions
  try {
    const permsUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/permissions?access_token=${encodeURIComponent(token)}`
    const perms = await fetchJson(permsUrl)
    if (perms.ok && Array.isArray(perms.body.data)) {
      const granted = perms.body.data.filter(p => p.status === 'granted').map(p => p.permission)
      const declined = perms.body.data.filter(p => p.status === 'declined').map(p => p.permission)
      result.permissions = {
        granted,
        declined,
        hasAdsRead: granted.includes('ads_read'),
        hasAdsManagement: granted.includes('ads_management'),
        hasBusinessManagement: granted.includes('business_management'),
      }
    } else {
      result.permissions = { error: perms.body?.error?.message || `HTTP ${perms.status}` }
    }
  } catch (err) {
    result.permissions = { error: err.message || String(err) }
  }

  // 2. Ad account info (sanity check the account ID is valid)
  try {
    const acctUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}?fields=name,currency,account_status,business_name&access_token=${encodeURIComponent(token)}`
    const acct = await fetchJson(acctUrl)
    if (acct.ok) {
      result.account = {
        name: acct.body.name,
        currency: acct.body.currency,
        status: acct.body.account_status,
        business: acct.body.business_name,
      }
    } else {
      result.account = { error: acct.body?.error?.message || `HTTP ${acct.status}` }
    }
  } catch (err) {
    result.account = { error: err.message || String(err) }
  }

  // 3. Existing automated rules
  try {
    const rulesUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/adrules_library?fields=id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time&limit=50&access_token=${encodeURIComponent(token)}`
    const rules = await fetchJson(rulesUrl)
    if (rules.ok) {
      result.automatedRules = {
        count: (rules.body.data || []).length,
        rules: (rules.body.data || []).map(r => ({
          id: r.id,
          name: r.name,
          status: r.status,
          created: r.created_time,
          trigger: r.evaluation_spec,
          action: r.execution_spec,
          schedule: r.schedule_spec,
        })),
      }
    } else {
      result.automatedRules = { error: rules.body?.error?.message || `HTTP ${rules.status}` }
    }
  } catch (err) {
    result.automatedRules = { error: err.message || String(err) }
  }

  // 4. Verdict
  const canCreateRules = !!(result.permissions?.hasAdsManagement)
  result.verdict = {
    canCreateRules,
    summary: canCreateRules
      ? '✓ All set — token has ads_management. Can create automated rules.'
      : '✗ Missing ads_management permission on the token. Need to re-authorize the app in Facebook with ads_management scope.',
  }

  return Response.json(result, { status: 200 })
}
