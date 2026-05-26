import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// GET — list all, or lookup by email (returns array — supports multi-project)
export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const email = searchParams.get('email')

  if (email) {
    const { data, error } = await supabaseAdmin
      .from('client_access')
      .select('*, projects(id, name, client_id, clients(name, color))')
      .eq('email', email.toLowerCase().trim())
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 404 })
    return NextResponse.json(data || [])
  }

  const { data, error } = await supabaseAdmin
    .from('client_access')
    .select('*, projects(id, name, client_id, clients(name, color))')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

// POST — add entry + auto-send magic link to client
export async function POST(req) {
  const body = await req.json()
  const { email, project_id, label } = body
  if (!email || !project_id) {
    return NextResponse.json({ error: 'email and project_id required' }, { status: 400 })
  }

  const cleanEmail = email.toLowerCase().trim()

  // Save to DB
  const { data, error } = await supabaseAdmin
    .from('client_access')
    .insert({ email: cleanEmail, project_id, label: label || null })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-send magic link to the client
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  const { error: otpError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: cleanEmail,
    options: { redirectTo: `${siteUrl}/client` }
  })
  // Note: generateLink generates the link but doesn't send — use signInWithOtp for sending
  // We use the anon client to trigger the actual send (goes through Supabase email)
  const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  await supabaseAnon.auth.signInWithOtp({
    email: cleanEmail,
    options: { emailRedirectTo: `${siteUrl}/client`, shouldCreateUser: true }
  })

  return NextResponse.json({ ...data, emailSent: true }, { status: 201 })
}

// DELETE
export async function DELETE(req) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('client_access').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
