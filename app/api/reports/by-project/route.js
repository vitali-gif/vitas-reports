/**
 * GET /api/reports/by-project?projectId=xxx
 *
 * Reads the reports cache for a project using the service-role key,
 * bypassing Supabase RLS (which blocks anon reads on the reports table).
 * Used by AdminPage (both client AND admin views) for cache-first rendering.
 *
 * Auth: x-client-key must equal NEXT_PUBLIC_SUPABASE_ANON_KEY.
 *
 * IMPORTANT — why this is chunked:
 *   A single `select('*')` for a whole project pulls every report's large JSONB
 *   `data` column at once. Once a project accumulates many reports this exceeds
 *   Postgres' statement_timeout (error 57014) and returns 500 — even under
 *   service_role — which blanked the dashboard for ALL clients. We therefore
 *   fetch the lightweight id list first, then pull the heavy rows in small
 *   batches (each batch stays well under the timeout) and concatenate. The
 *   response shape is identical to the old single-query version.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHUNK_SIZE = 6      // reports per heavy query — keeps each query under statement_timeout
const CONCURRENCY = 4     // parallel batches

export async function GET(request) {
  const key = request.headers.get('x-client-key')
  if (!key || key !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  }

  // 1) Lightweight: just the ids + month (no heavy `data` column) — fast, never times out.
  const { data: index, error: idxErr } = await supabaseAdmin
    .from('reports')
    .select('id, month')
    .eq('project_id', projectId)
    .order('month', { ascending: false })

  if (idxErr) return NextResponse.json({ error: idxErr.message }, { status: 500 })
  if (!index || index.length === 0) return NextResponse.json([])

  // 2) Pull full rows in small batches so no single query exceeds the statement timeout.
  const ids = index.map((r) => r.id)
  const chunks = []
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) chunks.push(ids.slice(i, i + CHUNK_SIZE))

  const byId = {}
  let fetchErr = null

  const runChunk = async (chunk) => {
    const { data, error } = await supabaseAdmin
      .from('reports')
      .select('*')
      .in('id', chunk)
    if (error) { fetchErr = error; return }
    for (const row of data || []) byId[row.id] = row
  }

  const queue = [...chunks]
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY)
    await Promise.all(batch.map(runChunk))
    if (fetchErr) break
  }

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

  // 3) Re-assemble in the original month-desc order from the index.
  const ordered = index.map((r) => byId[r.id]).filter(Boolean)
  return NextResponse.json(ordered)
}
