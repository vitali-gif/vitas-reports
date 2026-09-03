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
import { adminClient, requireProjectAccess } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300  // heavy per-month `data` (facebook age×gender rows) can be ~25MB → needs >60s
export const revalidate = 0            // never cache this route
export const fetchCache = 'force-no-store'

// Ensure freshly-written reports are visible immediately (no stale cached snapshot).
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  // הקריאה רצה עם service_role ועוקפת RLS, ולכן היא חייבת לאמת בעצמה שהקורא
  // רשאי לגשת לפרויקט הזה. בלי זה כל projectId מחזיר את הנתונים הגולמיים של
  // הלקוח שאליו הוא שייך — כולל PII של לידים.
  const gate = await requireProjectAccess(request, projectId)
  if (!gate.ok) return gate.res

  const supabaseAdmin = adminClient()

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
  const heavyById = {}
  if (dataForMonths.length > 0) {
    const { data: heavy, error: heavyErr } = await supabaseAdmin
      .from('reports')
      .select('id, data')
      .eq('project_id', projectId)
      .in('month', dataForMonths)
    if (heavyErr) return NextResponse.json({ error: heavyErr.message }, { status: 500 })
    for (const r of heavy || []) heavyById[r.id] = r.data
  }

  const out = lite.map(r => ({ ...r, data: heavyById[r.id] ?? null }))
  return NextResponse.json(out, { headers: NO_STORE })
}
