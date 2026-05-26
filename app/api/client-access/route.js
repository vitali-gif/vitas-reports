import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Admin-only CRUD for client_access table
// Uses service-role key so it bypasses RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// GET /api/client-access — list all entries (admin only)
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email')

  if (email) {
    // Single lookup — used by client page to find project
    const { data, error } = await supabaseAdmin
      .from('client_access')
      .select('*, projects(id, name, client_id, clients(name, color))')
      .eq('email', email.toLowerCase().trim())
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 404 })
    return NextResponse.json(data)
  }

  // Full list for admin panel
  const { data, error } = await supabaseAdmin
    .from('client_access')
    .select('*, projects(id, name, client_id, clients(name, color))')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

// POST /api/client-access — add entry
export async function POST(req) {
  const body = await req.json()
  const { email, project_id, label } = body
  if (!email || !project_id) {
    return NextResponse.json({ error: 'email and project_id required' }, { status: 400 })
  }
  const { data, error } = await supabaseAdmin
    .from('client_access')
    .insert({ email: email.toLowerCase().trim(), project_id, label: label || null })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

// DELETE /api/client-access?id=xxx
export async function DELETE(req) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('client_access').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
