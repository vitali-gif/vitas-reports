// API route: /api/tasks/create
//   POST - from the admin UI (auth via x-client-key header = anon key)
//
// Inserts a row into vitas_tasks representing a recommendation the user has
// "locked" — committed to working on. The frontend supplies the rec object;
// we map its fields to the table schema.
//
// Body shape (all required unless marked optional):
//   {
//     projectId:          UUID,
//     role:               'agency' | 'campaign_manager' | 'marketing_manager' | 'salesperson',
//     title:              string,
//     description:        string,                                       (suggestion text)
//     recommendationKey:  string,                                       (rec.dedupKey)
//     metricType:         string,                                       (rec.baseline.metric)
//     baselineValue:      number,                                       (primary numeric value)
//     baselineMetadata:   object,                                       (full rec.baseline + target context)
//     meetingDate?:       'YYYY-MM-DD',                                 (defaults to today)
//     campaignId?:        string                                        (optional)
//   }
//
// If a row already exists for (projectId, recommendationKey) with status
// pending/in_progress, returns 409 with the existing row instead of creating.

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'

const VALID_ROLES = new Set(['agency', 'campaign_manager', 'marketing_manager', 'salesperson'])

function badRequest(message) {
  return Response.json({ error: message }, { status: 400 })
}

export async function POST(request) {
  const auth = await requireAuth(request, { adminOnly: true })
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body = {}
  try { body = await request.json() } catch { return badRequest('Invalid JSON body') }

  const {
    projectId,
    role,
    title,
    description,
    recommendationKey,
    metricType,
    baselineValue,
    baselineMetadata,
    meetingDate,
    campaignId,
  } = body

  // Validate
  if (!projectId || typeof projectId !== 'string') return badRequest('projectId required')
  if (!role || !VALID_ROLES.has(role)) return badRequest('role must be one of: ' + [...VALID_ROLES].join(', '))
  if (!title || typeof title !== 'string') return badRequest('title required')
  if (!description || typeof description !== 'string') return badRequest('description required')
  if (!recommendationKey || typeof recommendationKey !== 'string') return badRequest('recommendationKey required')
  if (!metricType || typeof metricType !== 'string') return badRequest('metricType required')
  if (baselineValue === undefined || baselineValue === null || !Number.isFinite(Number(baselineValue))) {
    return badRequest('baselineValue must be a finite number')
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 })
  }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  // Dedup check: is there an OPEN task for this project + rec_key already?
  const { data: existing, error: lookupErr } = await supabase
    .from('vitas_tasks')
    .select('*')
    .eq('project_id', projectId)
    .eq('recommendation_key', recommendationKey)
    .in('status', ['pending', 'in_progress'])
    .limit(1)
  if (lookupErr) {
    return Response.json({ error: 'Lookup failed: ' + lookupErr.message }, { status: 500 })
  }
  if (existing && existing.length > 0) {
    return Response.json({ existing: existing[0], message: 'Task already exists in pipeline' }, { status: 409 })
  }

  // Insert
  const row = {
    project_id: projectId,
    role,
    task_title: title.slice(0, 500),
    task_description: description.slice(0, 4000),
    recommendation_key: recommendationKey,
    metric_type: metricType,
    baseline_value: Number(baselineValue),
    baseline_metadata: baselineMetadata && typeof baselineMetadata === 'object' ? baselineMetadata : {},
  }
  if (meetingDate && /^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) row.meeting_date = meetingDate
  if (campaignId && typeof campaignId === 'string') row.campaign_id = campaignId

  const { data: inserted, error: insertErr } = await supabase
    .from('vitas_tasks')
    .insert(row)
    .select()
    .single()
  if (insertErr) {
    return Response.json({ error: 'Insert failed: ' + insertErr.message }, { status: 500 })
  }
  return Response.json({ task: inserted }, { status: 201 })
}
