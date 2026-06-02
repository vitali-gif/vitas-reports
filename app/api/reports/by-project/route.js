/**
 * GET /api/reports/by-project?projectId=xxx
 *
 * Reads the reports cache for a project using the service-role key,
 * bypassing Supabase RLS (which blocks anon reads on the reports table).
 * Used by AdminPage in client view so cache-first rendering works properly.
 *
 * Auth: x-client-key must equal NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export const dynamic = 'force-dynamic'

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

  const { data, error } = await supabaseAdmin
    .from('reports')
    .select('*')
    .eq('project_id', projectId)
    .order('month', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}
