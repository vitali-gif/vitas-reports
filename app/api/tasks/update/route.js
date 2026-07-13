// API route: /api/tasks/update
//   POST - from the admin UI / client UI (auth via x-client-key header = anon key)
//
// Updates a vitas_tasks row's status (and optionally writes the impact snapshot
// when the task is closed). Trigger vitas_tasks_set_updated_at on the DB side
// will stamp closed_at / clear it on re-open.
//
// Body shape:
//   {
//     taskId:          UUID,
//     status:          'pending' | 'in_progress' | 'done' | 'dropped',
//     impactSnapshot?: object   (only meaningful when status='done')
//   }

import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set(['pending', 'in_progress', 'done', 'dropped'])

function badRequest(message) {
  return Response.json({ error: message }, { status: 400 })
}

export async function POST(request) {
  const auth = await requireAuth(request, { adminOnly: true })
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

  let body = {}
  try { body = await request.json() } catch { return badRequest('Invalid JSON body') }

  const { taskId, status, impactSnapshot } = body

  if (!taskId || typeof taskId !== 'string') return badRequest('taskId required')
  if (!status || !VALID_STATUSES.has(status)) return badRequest('status must be one of: ' + [...VALID_STATUSES].join(', '))

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 })
  }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  const update = { status }
  if (status === 'done' && impactSnapshot && typeof impactSnapshot === 'object') {
    update.impact_snapshot = impactSnapshot
  }

  const { data: updated, error: updateErr } = await supabase
    .from('vitas_tasks')
    .update(update)
    .eq('id', taskId)
    .select()
    .single()
  if (updateErr) {
    return Response.json({ error: 'Update failed: ' + updateErr.message }, { status: 500 })
  }
  if (!updated) {
    return Response.json({ error: 'Task not found' }, { status: 404 })
  }
  return Response.json({ task: updated }, { status: 200 })
}
