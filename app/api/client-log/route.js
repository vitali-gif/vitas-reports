import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// POST — log session events from client dashboard
export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  const { event, email, clientName, projectIds, sessionId, durationSec } = body

  if (event === 'login') {
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
    const { data, error } = await supabaseAdmin
      .from('client_sessions')
      .insert({
        email: email.toLowerCase().trim(),
        client_name: clientName || null,
        project_ids: projectIds || [],
        logged_in_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, sessionId: data.id })
  }

  if (event === 'heartbeat') {
    if (!sessionId) return NextResponse.json({ ok: true })
    await supabaseAdmin
      .from('client_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', sessionId)
    return NextResponse.json({ ok: true })
  }

  if (event === 'logout') {
    if (!sessionId) return NextResponse.json({ ok: true })
    await supabaseAdmin
      .from('client_sessions')
      .update({
        ended: true,
        last_seen_at: new Date().toISOString(),
        duration_sec: durationSec || 0,
      })
      .eq('id', sessionId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown event' }, { status: 400 })
}

// GET — fetch logs for admin (protected by anon key header)
export async function GET(req) {
  const key = req.headers.get('x-client-key')
  if (!key || key !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('client_sessions')
    .select('*')
    .order('logged_in_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich: compute effective duration
  const now = Date.now()
  const enriched = (data || []).map(s => {
    const lastSeen = new Date(s.last_seen_at).getTime()
    const loggedIn = new Date(s.logged_in_at).getTime()
    const isActive = !s.ended && (now - lastSeen) < 3 * 60 * 1000 // active if heartbeat < 3 min ago
    const durSec = s.ended ? s.duration_sec : Math.round((lastSeen - loggedIn) / 1000)
    return { ...s, isActive, durSec }
  })

  return NextResponse.json(enriched)
}
