// API route: /api/keepalive
// Tiny endpoint that pings Supabase to keep the project from being auto-paused
// on the Free tier (which pauses after 7 days of inactivity).
// Called by Vercel cron daily.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ ok: false, error: 'Missing Supabase env vars' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })
  const start = Date.now()

  // Three lightweight queries against three different tables, so it counts as
  // a "real" interaction across the schema. Each is a HEAD-style count query.
  try {
    const [c1, c2, c3] = await Promise.all([
      supabase.from('clients').select('*', { count: 'exact', head: true }),
      supabase.from('projects').select('*', { count: 'exact', head: true }),
      supabase.from('reports').select('*', { count: 'exact', head: true }),
    ])
    const errors = [c1.error, c2.error, c3.error].filter(Boolean).map(e => e.message)
    if (errors.length) {
      return Response.json({ ok: false, errors, ms: Date.now() - start }, { status: 500 })
    }
    return Response.json({
      ok: true,
      counts: { clients: c1.count, projects: c2.count, reports: c3.count },
      ms: Date.now() - start,
      ts: new Date().toISOString(),
    })
  } catch (err) {
    return Response.json({ ok: false, error: String(err.message || err), ms: Date.now() - start }, { status: 500 })
  }
}
