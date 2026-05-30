import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// Simple auth: require anon key in x-client-key header (same as all other API routes)
function checkAuth(req) {
  const key = req.headers.get('x-client-key')
  const expected = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return expected && key === expected
}

// GET — list all, or lookup by email
export async function GET(req) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

// POST — add entry + send magic link to client
export async function POST(req) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'

  // Generate a magic link via the admin API (this creates the token in Supabase).
  // The link itself is returned so we can: (a) try emailing it via OTP, and
  // (b) return it to the admin UI as a fallback copy-paste link.
  let magicLink = null
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: cleanEmail,
    options: { redirectTo: `${siteUrl}/client` }
  })
  if (!linkError && linkData?.properties?.action_link) {
    magicLink = linkData.properties.action_link
  }

  // Also fire signInWithOtp which attempts to send the email via Supabase's email provider.
  // This may fail silently on free-tier rate limits or missing SMTP config — we capture
  // the error and include it in the response so the admin knows to use the fallback link.
  let emailError = null
  try {
    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
    const { error: otpErr } = await supabaseAnon.auth.signInWithOtp({
      email: cleanEmail,
      options: { emailRedirectTo: `${siteUrl}/client`, shouldCreateUser: true }
    })
    if (otpErr) emailError = otpErr.message
  } catch (e) {
    emailError = String(e)
  }

  return NextResponse.json({
    ...data,
    emailSent: !emailError,
    emailError: emailError || null,
    magicLink,  // fallback: admin can copy this and send manually if email failed
  }, { status: 201 })
}

// DELETE
export async function DELETE(req) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('client_access').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
