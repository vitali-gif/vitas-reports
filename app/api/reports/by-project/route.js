/**
 * GET /api/reports/by-project?projectId=xxx[&dataForMonths=KEY1,KEY2]
 *
 * Reads the reports cache for a project (service-role, bypasses RLS).
 * Used by AdminPage (client AND admin views).
 *
 * LAZY LOADING (phase 1): always returns a LIGHT index — every report's metadata +
 * summary, but NOT the heavy JSONB `data` column. The heavy `data` is included ONLY
 * for the month-keys listed in `dataForMonths` (the period being viewed + compare +
 * recommendations window). This keeps each response small (was 40MB for ONCE → blank
 * screens) while the dashboard still renders KPIs/charts from `summary` instantly.
 * Response shape unchanged: an array of report rows; rows outside dataForMonths have data:null.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const revalidate = 0            // never cache this route
export const fetchCache = 'force-no-store'

// Ensure freshly-written reports are visible immediately (no stale cached snapshot).
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }

export async function GET(request) {
  const key = request.headers.get('x-client-key')
  if (!key || key !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const dataForMonths = (searchParams.get('dataForMonths') || '')
    .split(',').map(s => s.trim()).filter(Boolean)

  // 1) LIGHT index — no heavy `data` column (fast, never times out).
  const { data: lite, error: liteErr } = await supabaseAdmin
    .from('reports')
    .select('id, project_id, source, month, summary, created_at')
    .eq('project_id', projectId)
    .order('month', { ascending: false })
  if (liteErr) return NextResponse.json({ error: liteErr.message }, { status: 500 })
  if (!lite || lite.length === 0) return NextResponse.json([], { headers: NO_STORE })

  // 2) HEAVY `data` only for the requested month-keys.
  // Fetched ONE report at a time (bounded concurrency), NOT `.in('month', keys)` in a single
  // query. A single facebook report's `data` JSONB can be several MB (ad-level age×gender
  // rows), so a whole-month/quarter query exceeded Postgres' statement_timeout (8s) and
  // returned 500 — which left the dashboard's detail tables stuck on "loading" forever.
  // Per-report selects each stay well under the timeout; we assemble them here.
  const heavyById = {}
  if (dataForMonths.length > 0) {
    const wanted = new Set(dataForMonths)
    const heavyIds = lite.filter(r => wanted.has(r.month)).map(r => r.id)  // reuse the light index — no extra query
    const CONCURRENCY = 4
    let heavyErr = null
    const fetchOne = async (id) => {
      const { data, error } = await supabaseAdmin.from('reports').select('data').eq('id', id).single()
      if (error) { heavyErr = error; return }
      heavyById[id] = data?.data ?? null
    }
    const queue = [...heavyIds]
    while (queue.length > 0 && !heavyErr) {
      await Promise.all(queue.splice(0, CONCURRENCY).map(fetchOne))
    }
    if (heavyErr) return NextResponse.json({ error: heavyErr.message }, { status: 500 })
  }

  const out = lite.map(r => ({ ...r, data: heavyById[r.id] ?? null }))
  return NextResponse.json(out, { headers: NO_STORE })
}
