import { NextResponse } from 'next/server'
import { requireAdmin, requireUser, escapeHtml } from '../../../lib/auth'
import { createClient } from '@supabase/supabase-js'
import { sendAlert } from '../../../lib/alert'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// POST — log session events from client dashboard.
// הרשאה: משתמש מחובר בלבד, והמייל נלקח מהטוקן ולא מגוף הבקשה. קודם ה-route
// היה פתוח לגמרי — אפשר היה להזריק שורות ל-client_sessions ולהפעיל שליחת מיילים.
export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  // navigator.sendBeacon (אירוע logout) לא יכול לשאת כותרות, ולכן הטוקן מתקבל גם מהגוף.
  const gate = await requireUser(req, body.accessToken)
  if (!gate.ok) return gate.res
  const email = gate.user.email

  const { event, clientName, projectIds, sessionId, durationSec } = body

  if (event === 'login') {
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
      .eq('id', sessionId).eq('email', email)
    return NextResponse.json({ ok: true })
  }

  if (event === 'project_select') {
    if (!sessionId) return NextResponse.json({ ok: true })
    await supabaseAdmin
      .from('client_sessions')
      .update({ selected_project: body.projectName || null })
      .eq('id', sessionId).eq('email', email)
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
      .eq('id', sessionId).eq('email', email)
    return NextResponse.json({ ok: true })
  }

  if (event === 'no_data') {
    // A client opened the dashboard but no data loaded (broken pipeline / cron). Alert the owner.
    const when = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })
    const html = `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#0B0F1E">
      <h2 style="margin:0 0 10px">\u26a0\ufe0f \u05dc\u05e7\u05d5\u05d7 \u05e0\u05db\u05e0\u05e1 \u05dc\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3 \u05e8\u05d9\u05e7</h2>
      <p style="margin:0 0 12px;color:#5E6478">\u05dc\u05e7\u05d5\u05d7 \u05e0\u05db\u05e0\u05e1 \u05dc\u05de\u05e2\u05e8\u05db\u05ea \u05d0\u05da \u05dc\u05d0 \u05e0\u05d8\u05e2\u05e0\u05d5 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd (\u05d9\u05d9\u05ea\u05db\u05df \u05e7\u05e8\u05d5\u05df/\u05e4\u05d9\u05d9\u05e4\u05dc\u05d9\u05d9\u05df).</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:3px 10px 3px 0;color:#98A0B2">\u05de\u05d9\u05d9\u05dc</td><td style="padding:3px 0"><b>${escapeHtml(email) || '\u2014'}</b></td></tr>
        <tr><td style="padding:3px 10px 3px 0;color:#98A0B2">\u05dc\u05e7\u05d5\u05d7</td><td style="padding:3px 0">${escapeHtml(clientName) || '\u2014'}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;color:#98A0B2">\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8</td><td style="padding:3px 0">${escapeHtml(body.projectName) || '\u2014'}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;color:#98A0B2">\u05e1\u05d9\u05d1\u05d4</td><td style="padding:3px 0">${escapeHtml(body.reason) || '\u2014'}</td></tr>
        <tr><td style="padding:3px 10px 3px 0;color:#98A0B2">\u05d6\u05de\u05df</td><td style="padding:3px 0">${when}</td></tr>
      </table>
    </div>`
    try { await sendAlert({ subject: `\u26a0\ufe0f VITAS: \u05dc\u05e7\u05d5\u05d7 \u05e8\u05d0\u05d4 \u05d3\u05e9\u05d1\u05d5\u05e8\u05d3 \u05e8\u05d9\u05e7 \u2014 ${String(clientName || email || '').slice(0, 120)}`, html }) } catch {}
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown event' }, { status: 400 })
}

// DELETE — clear all session logs (protected by anon key header)
export async function DELETE(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const { error } = await supabaseAdmin.from('client_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// GET — fetch logs for admin (protected by anon key header)
export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res

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
