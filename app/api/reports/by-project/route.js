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
export const maxDuration = 300  // heavy per-month `data` (facebook age×gender rows) can be ~25MB → needs >60s
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

  // FAST PATH (perf): when the caller asks for specific months' heavy `data`, return ONLY those
  // rows. Until now this route always re-sent the FULL light index alongside them — 14.7MB measured
  // on HI PARK — so every month switch in the UI re-downloaded the whole index it already had in
  // memory. The client merges these rows into its existing state by `id` and ignores rows whose
  // `data` is null, so returning just the heavy rows is a drop-in.
  if (dataForMonths.length > 0) {
    const { data: heavy, error: heavyOnlyErr } = await supabaseAdmin
      .from('reports')
      .select('id, project_id, source, month, summary, created_at, data')
      .eq('project_id', projectId)
      .in('month', dataForMonths)
    if (heavyOnlyErr) return NextResponse.json({ error: heavyOnlyErr.message }, { status: 500 })
    return NextResponse.json(heavy || [], { headers: NO_STORE })
  }

  // 1) LIGHT index — no heavy `data` column (fast, never times out).
  const { data: lite, error: liteErr } = await supabaseAdmin
    .from('reports')
    .select('id, project_id, source, month, summary, created_at')
    .eq('project_id', projectId)
    .order('month', { ascending: false })
  if (liteErr) return NextResponse.json({ error: liteErr.message }, { status: 500 })
  if (!lite || lite.length === 0) return NextResponse.json([], { headers: NO_STORE })

  // No dataForMonths ⇒ pure light index (the heavy path returned above).
  const out = lite.map(r => ({ ...r, data: null }))
  return NextResponse.json(out, { headers: NO_STORE })
}
