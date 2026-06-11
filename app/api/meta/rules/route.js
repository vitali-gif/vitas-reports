// API route: /api/meta/rules
//   POST   — create a Meta Automated Rule from a recommendation (scoped to a project's campaigns)
//   GET    — list current automated rules
//   DELETE — remove a rule by id (?id=RULE_ID) — for cleanup / UI rule management
//
// Auth: requires x-client-key = anon key (admin UI only).
//
// NOTE: Meta Automated Rules schema is strict. Key requirements (per Meta docs):
//   - every rule MUST include an entity_type OR id filter
//   - any insights filter requires a time_preset filter (operator EQUAL)
//   - scope-by-name uses field `name`/`campaign.name` (NOT `entity_name`)
//   - cost metrics must be valid Insights fields (e.g. cost_per_lead_fb, NOT cost_per_inline_link_click)
// We scope by campaign.id IN [...] (resolved from the project name) so rules never
// affect other clients sharing the same ad account, and to avoid case-sensitivity issues.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
const META_GRAPH_VERSION = 'v21.0'

function bad(message, status = 400) {
  return Response.json({ error: message }, { status })
}

// lookbackDays -> Meta time_preset (presets that include TODAY, suitable for schedule rules)
function timePreset(lookbackDays) {
  const n = Number(lookbackDays)
  if (n >= 30) return 'LAST_30_DAYS'
  if (n >= 14) return 'LAST_14_DAYS'
  return 'LAST_7_DAYS'
}

// Resolve campaign IDs whose name contains projectName (case-insensitive) within the ad account.
async function getCampaignScope(adAccountId, token, projectName) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/campaigns?fields=id,name&limit=500&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('Failed to list campaigns: ' + (json?.error?.message || res.status))
  const wanted = String(projectName || '').trim()
  const needle = wanted.toLowerCase()
  const matched = (json.data || []).filter(c => (c.name || '').toLowerCase().includes(needle))
  // Derive the actual-cased substring from a real campaign name so the CONTAIN filter
  // matches regardless of case (e.g. project "HI PARK" but campaigns named "Hi Park-...").
  let nameValue = wanted
  if (matched.length) {
    const nm = matched[0].name || ''
    const idx = nm.toLowerCase().indexOf(needle)
    if (idx >= 0) nameValue = nm.substr(idx, wanted.length)
  }
  return { nameValue, count: matched.length, ids: matched.map(c => String(c.id)) }
}

// Resolve the token owner's FB user id (recipient for NOTIFICATION rules).
async function getMeId(token) {
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me?fields=id&access_token=${encodeURIComponent(token)}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('Failed to resolve user id: ' + (json?.error?.message || res.status))
  return String(json.id)
}

// Map our params to a Meta adrules_library payload, scoped to the given campaign IDs.
function buildRulePayload(ruleType, params, projectName, scope, notifyUserId) {
  switch (ruleType) {
    case 'pause_high_cpl_ads': {
      const minSpend = Number(params.minSpend ?? 200)
      const cpl = Number(params.cplThreshold)
      if (!cpl || cpl <= 0) throw new Error('cplThreshold must be a positive number')
      return {
        name: `[VITAS] השהה מודעות עם CPL > ${Math.round(cpl)}₪ ב-${projectName}`,
        evaluation_spec: {
          evaluation_type: 'SCHEDULE',
          filters: [
            { field: 'entity_type', operator: 'EQUAL', value: 'AD' },
            scope,
            { field: 'time_preset', operator: 'EQUAL', value: timePreset(params.lookbackDays) },
            { field: 'spent', operator: 'GREATER_THAN', value: minSpend * 100 },        // account currency cents
            { field: 'cost_per_lead_fb', operator: 'GREATER_THAN', value: cpl * 100 },   // cost per lead, cents
          ],
        },
        execution_spec: { execution_type: 'PAUSE' },
        schedule_spec: { schedule_type: 'SEMI_HOURLY' },
        status: 'ENABLED',
      }
    }
    case 'pause_high_spend_no_results': {
      const minSpend = Number(params.minSpend ?? 200)
      return {
        name: `[VITAS] השהה מודעות שמבזבזות בלי לידים ב-${projectName}`,
        evaluation_spec: {
          evaluation_type: 'SCHEDULE',
          filters: [
            { field: 'entity_type', operator: 'EQUAL', value: 'AD' },
            scope,
            { field: 'time_preset', operator: 'EQUAL', value: timePreset(params.lookbackDays) },
            { field: 'spent', operator: 'GREATER_THAN', value: minSpend * 100 },
            { field: 'offsite_conversion.fb_pixel_lead', operator: 'EQUAL', value: 0 },
          ],
        },
        execution_spec: { execution_type: 'PAUSE' },
        schedule_spec: { schedule_type: 'SEMI_HOURLY' },
        status: 'ENABLED',
      }
    }
    case 'boost_budget_on_day':     // +pct% on the golden day
    case 'revert_budget_on_day':    // undo the boost the next day
    case 'cut_budget_on_day':       // -pct% on a weak day (offsets the boost -> budget-neutral)
    case 'restore_budget_on_day': { // undo the cut the next day
      // CHANGE_BUDGET must target ADSET (Meta requirement). change_spec { amount, unit }.
      // Budget-NEUTRAL design: boost golden day by +pct%, cut weak day by -pct%. With equal
      // base daily budgets the absolute +/- cancel, so monthly spend is unchanged - money is
      // just shifted toward the golden day. Each change reverts the next day (narrow 30-min
      // window -> applied once) so nothing compounds week over week.
      const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']
      const pct = Number(params.pctIncrease)
      if (!pct || pct <= 0 || pct >= 100) throw new Error('pctIncrease must be between 1 and 99')
      const goldenDay = Number(params.dayOfWeek)
      const cutDay = Number(params.cutDay)
      // amount precision helper
      const r2 = (x) => Math.round(x * 100) / 100
      let actDay, amount, name
      if (ruleType === 'boost_budget_on_day') {
        if (!(goldenDay >= 0 && goldenDay <= 6)) throw new Error('dayOfWeek must be 0..6')
        actDay = goldenDay; amount = Math.round(pct)
        name = `[VITAS] +${Math.round(pct)}% תקציב ביום ${dayNames[goldenDay]} ב-${projectName}`
      } else if (ruleType === 'revert_budget_on_day') {
        if (!(goldenDay >= 0 && goldenDay <= 6)) throw new Error('dayOfWeek must be 0..6')
        actDay = (goldenDay + 1) % 7; amount = -r2((pct / (100 + pct)) * 100) // undo +pct
        name = `[VITAS] החזרת תקציב ביום ${dayNames[actDay]} (סיום בוסט ${dayNames[goldenDay]}) ב-${projectName}`
      } else if (ruleType === 'cut_budget_on_day') {
        if (!(cutDay >= 0 && cutDay <= 6)) throw new Error('cutDay must be 0..6')
        actDay = cutDay; amount = -Math.round(pct)
        name = `[VITAS] -${Math.round(pct)}% תקציב ביום ${dayNames[cutDay]} ב-${projectName}`
      } else { // restore_budget_on_day
        if (!(cutDay >= 0 && cutDay <= 6)) throw new Error('cutDay must be 0..6')
        actDay = (cutDay + 1) % 7; amount = r2((pct / (100 - pct)) * 100) // undo -pct
        name = `[VITAS] החזרת תקציב ביום ${dayNames[actDay]} (סיום קיצוץ ${dayNames[cutDay]}) ב-${projectName}`
      }
      return {
        name,
        evaluation_spec: {
          evaluation_type: 'SCHEDULE',
          filters: [
            { field: 'entity_type', operator: 'EQUAL', value: 'ADSET' },
            scope,
          ],
        },
        execution_spec: {
          execution_type: 'CHANGE_BUDGET',
          execution_options: [
            { field: 'change_spec', value: { amount, unit: 'PERCENTAGE' }, operator: 'EQUAL' },
          ],
        },
        schedule_spec: {
          schedule_type: 'CUSTOM',
          schedule: [ { start_minute: 0, end_minute: 30, days: [actDay] } ],
        },
        status: 'ENABLED',
      }
    }
    case 'notify_high_cpl': {
      const minSpend = Number(params.minSpend ?? 100)
      const cpl = Number(params.cplThreshold)
      if (!cpl || cpl <= 0) throw new Error('cplThreshold must be a positive number')
      if (!notifyUserId) throw new Error('notifyUserId required for notification rules')
      return {
        name: `[VITAS] \u05d4\u05ea\u05e8\u05d0\u05d4: \u05e7\u05de\u05e4\u05d9\u05d9\u05df \u05e2\u05dd CPL > ${Math.round(cpl)}\u20aa \u05d1-${projectName}`,
        evaluation_spec: {
          evaluation_type: 'SCHEDULE',
          filters: [
            { field: 'entity_type', operator: 'EQUAL', value: 'CAMPAIGN' },
            scope,
            { field: 'time_preset', operator: 'EQUAL', value: timePreset(params.lookbackDays) },
            { field: 'spent', operator: 'GREATER_THAN', value: minSpend * 100 },
            { field: 'cost_per_lead_fb', operator: 'GREATER_THAN', value: cpl * 100 },
          ],
        },
        execution_spec: {
          execution_type: 'NOTIFICATION',
          execution_options: [
            { field: 'user_ids', value: [notifyUserId], operator: 'EQUAL' },
          ],
        },
        schedule_spec: { schedule_type: 'DAILY' },
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

  // Resolve the project's campaigns so the rule is scoped (never account-wide).
  // We scope by a readable, dynamic campaign.name CONTAIN filter (visible in Ads Manager,
  // and auto-covers future campaigns) — using the actual-cased substring so it matches.
  let scopeInfo
  try {
    scopeInfo = await getCampaignScope(adAccountId, token, projectName)
  } catch (err) {
    return bad('Failed to resolve campaigns: ' + (err.message || String(err)), 502)
  }
  if (!scopeInfo || scopeInfo.count === 0) {
    return bad(`לא נמצאו קמפיינים ששמם מכיל "${projectName}" בחשבון המודעות. ודא ששמות הקמפיינים כוללים את שם הפרויקט.`, 404)
  }
  const scope = { field: 'campaign.name', operator: 'CONTAIN', value: scopeInfo.nameValue }

  let notifyUserId = null
  if (ruleType === 'notify_high_cpl') {
    try { notifyUserId = await getMeId(token) } catch (err) { return bad('Failed to resolve notification recipient: ' + (err.message || String(err)), 502) }
  }

  let payload
  try {
    payload = buildRulePayload(ruleType, params || {}, projectName, scope, notifyUserId)
  } catch (err) {
    return bad('Invalid rule params: ' + (err.message || String(err)))
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${adAccountId}/adrules_library`
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(payload)) {
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  form.append('access_token', token)

  const res = await fetch(url, { method: 'POST', body: form })
  const respText = await res.text()
  let respJson
  try { respJson = JSON.parse(respText) } catch { respJson = { raw: respText } }

  if (!res.ok) {
    return Response.json({
      error: 'Meta rejected the rule',
      status: res.status,
      meta_error: respJson?.error || respJson,
      sent_payload: payload,
      scoped_campaigns: scopeInfo.count,
    }, { status: 502 })
  }

  // Audit log (optional)
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
    }
  } catch {}

  return Response.json({
    ok: true,
    ruleId: respJson.id,
    ruleName: payload.name,
    scopedCampaigns: scopeInfo.count, scopeName: scopeInfo.nameValue,
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

export async function DELETE(request) {
  const anon = request.headers.get('x-client-key')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return bad('Unauthorized', 401)
  }
  const token = process.env.META_ACCESS_TOKEN
  if (!token) return bad('Meta env vars missing', 500)
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return bad('id query param required')
  const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${id}?access_token=${encodeURIComponent(token)}`, { method: 'DELETE' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return Response.json({ error: json?.error || 'Meta API error' }, { status: 502 })
  return Response.json({ ok: true, deleted: id })
}
