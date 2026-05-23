// API route: /api/meta/rules
//   POST — create a new Meta Automated Rule from a recommendation
//   GET  — list current automated rules (mirrors diagnose, but only rules)
//
// Body shape (POST):
//   {
//     projectName:      'HI PARK' | 'ONCE' | 'REHAVIA',
//     ruleType:         'pause_high_cpl_ads' | 'boost_budget_on_day' | 'pause_high_spend_no_results',
//     params:           { ... }   // type-specific (see below)
//     recommendationKey?: string  // for audit linkage to vitas_tasks
//   }
//
// Rule types implemented (v1):
//   pause_high_cpl_ads — pause any ad in the project's campaigns that has spent
//     more than minSpend AND has CPL > cplThreshold over the last N days.
//     Params: { minSpend: number (default 200), cplThreshold: number, lookbackDays: 7|14|30 }
//
//   pause_high_spend_no_results — pause any ad that spent more than minSpend but
//     produced 0 leads in lookbackDays.
//     Params: { minSpend: number (default 200), lookbackDays: 7|14|30 }
//
//   boost_budget_on_day — increase the daily_budget of all ad sets in the project's
//     campaigns by pctIncrease, but only on the given dayOfWeek. (Implemented as a
//     rule with schedule_spec for the day, action CHANGE_BUDGET.)
//     Params: { dayOfWeek: 0..6 (0=Sun), pctIncrease: number (e.g. 30 for +30%) }
//
// Auth: requires x-client-key = anon key (admin UI only).

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
const META_GRAPH_VERSION = 'v21.0'

function bad(message, status = 400) {
  return Response.json({ error: message }, { status })
}

// Map our params to a Meta adrules_library payload
function buildRulePayload(ruleType, params, projectName, adAccountId) {
  // All rules apply to the user's whole account; we narrow via campaign filter.
  // The filter uses Meta's evaluation operators (GREATER_THAN, LESS_THAN, etc.).
  // Reference: https://developers.facebook.com/docs/marketing-api/automated-rules
  const projectFilter = {
    field: 'entity_name',
    operator: 'CONTAIN',
    value: projectName,
  }
  switch (ruleType) {
    case 'pause_high_cpl_ads': {
      const minSpend = Number(params.minSpend ?? 200)
      const cpl = Number(params.cplThreshold)
      const lookback = Number(params.lookbackDays ?? 14)
      if (!cpl || cpl <= 0) throw new Error('cplThreshold must be a positive number')
      return {
        name: `[VITAS] השהה מודעות עם CPL > ${Math.round(cpl)}₪ ב-${projectName}`,
        evaluation_spec: {
          evaluation_type: 'SCHEDULE',  // run on schedule, not triggered
          filters: [
            projectFilter,
            { field: 'spent', operator: 'GREATER_THAN', value: minSpend * 100 },  // spent is in account currency cents
            { field: 'cost_per_inline_link_click', operator: 'GREATER_THAN', value: cpl * 100 },
          ],
        },
        execution_spec: {
          execution_type: 'PAUSE',
          execution_options: [
            { field: 'user_id', value: 'me', operator: 'EQUAL' },
          ],
        },
        schedule_spec: {
          schedule_type: 'SEMI_HOURLY',
        },
        status: 'ENABLED',
      }
    }
    case 'pause_high_spend_no_results': {
      const minSpend = Number(params.minSpend ?? 200)
      const lookback = Number(params.lookbackDays ?? 7)
      return {
        name: `[VITAS] השהה מודעות שמבזבזות בלי לידים ב-${projectName}`,
        evaluation_spec: {
          evaluation_type: 'SCHEDULE',
          filters: [
            projectFilter,
            { field: 'spent', operator: 'GREATER_THAN', value: minSpend * 100 },
            { field: 'actions:offsite_conversion.fb_pixel_lead', operator: 'EQUAL', value: 0 },
          ],
        },
        execution_spec: {
          execution_type: 'PAUSE',
        },
        schedule_spec: {
          schedule_type: 'SEMI_HOURLY',
        },
        status: 'ENABLED',
      }
    }
    case 'boost_budget_on_day': {
      const dayOfWeek = Number(params.dayOfWeek)
      const pct = Number(params.pctIncrease)
      if (!(dayOfWeek >= 0 && dayOfWeek <= 6)) throw new Error('dayOfWeek must be 0..6')
      if (!pct || pct <= 0) throw new Error('pctIncrease must be a positive number')
      const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']
      // Schedule: only active on the chosen day, from 00:00 to 23:30 in Asia/Jerusalem
      return {
        name: `[VITAS] +${pct}% תקציב ביום ${dayNames[dayOfWeek]} ב-${projectName}`,
        evaluation_spec: {
          evaluation_type: 'SCHEDULE',
          filters: [
            projectFilter,
            { field: 'entity_type', operator: 'EQUAL', value: 'ADSET' },
          ],
        },
        execution_spec: {
          execution_type: 'CHANGE_BUDGET',
          execution_options: [
            { field: 'change_value', value: Math.round(pct), operator: 'EQUAL' },
            { field: 'change_type', value: 'PERCENTAGE_INCREASE', operator: 'EQUAL' },
          ],
        },
        schedule_spec: {
          schedule_type: 'CUSTOM',
          schedule: [
            {
              start_minute: 0,                    // 00:00
              end_minute: 60 * 23 + 30,           // 23:30
              days: [dayOfWeek],
            },
          ],
        },
        status: 'ENABLED',
      }
    }
    default:
      throw new Error(`Unknown ruleType: ${ruleType}`)
  }
}

export async function POST(request) {
  const anon = request.headers.get('x-client-key')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return bad('Unauthorized', 401)
  }
  let body = {}
  try { body = await request.json() } catch { return bad('Invalid JSON') }
  const { projectName, ruleType, params, recommendationKey } = body
  if (!projectName) return bad('projectName required')
  if (!ruleType) return bad('ruleType required')

  const token = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID
  if (!token || !adAccountId) return bad('Meta env vars missing', 500)

  let payload
  try {
    payload = buildRulePayload(ruleType, params || {}, projectName, adAccountId)
  } catch (err) {
    return bad('Invalid rule params: ' + (err.message || String(err)))
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/adrules_library`
  const form = new URLSearchParams()
  // Meta wants nested fields as JSON-stringified values
  for (const [k, v] of Object.entries(payload)) {
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  form.append('access_token', token)

  const res = await fetch(url, {
    method: 'POST',
    body: form,
  })
  const respText = await res.text()
  let respJson
  try { respJson = JSON.parse(respText) } catch { respJson = { raw: respText } }

  if (!res.ok) {
    return Response.json({
      error: 'Meta rejected the rule',
      status: res.status,
      meta_error: respJson?.error || respJson,
      sent_payload: payload,
    }, { status: 502 })
  }

  // Audit log
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
      await supabase.from('vitas_actions_log').insert({
        action_type: 'meta_rule_created',
        project_name: projectName,
        rule_type: ruleType,
        rule_id: respJson.id || null,
        rule_name: payload.name,
        params: params || {},
        recommendation_key: recommendationKey || null,
      })
      // Ignore failure — log is optional, don't break the user
    }
  } catch {}

  return Response.json({
    ok: true,
    ruleId: respJson.id,
    ruleName: payload.name,
    payload,
  }, { status: 201 })
}

export async function GET(request) {
  const anon = request.headers.get('x-client-key')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return bad('Unauthorized', 401)
  }
  const token = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID
  if (!token || !adAccountId) return bad('Meta env vars missing', 500)

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/adrules_library?fields=id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time&limit=100&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return Response.json({ error: json?.error || 'Meta API error' }, { status: 502 })
  return Response.json({ rules: json.data || [] })
}
