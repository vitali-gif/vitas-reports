import { NextResponse } from 'next/server'
import { requireAuth } from '../../../lib/auth'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)


// Generate a readable temporary password: XXXX-XXXX-XXXX
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `${seg()}-${seg()}-${seg()}`
}

// Create or update Supabase auth user with the given password
async function upsertAuthUser(email, password) {
  // Try creating first
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (!createErr) return { ok: true, userId: created.user?.id }

  // User exists — find and update password
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  const existing = users?.find(u => u.email === email)
  if (!existing) return { ok: false, error: createErr.message }
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, { password })
  if (updateErr) return { ok: false, error: updateErr.message }
  return { ok: true, userId: existing.id }
}

// Send welcome email with temp password via Resend
async function sendPasswordEmail(toEmail, tempPassword, clientName) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return { ok: false, error: 'RESEND_API_KEY not set' }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F7FB;font-family:'Heebo',Arial,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FB;padding:40px 16px">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(11,15,30,0.08)">
<tr><td style="background:#0B0F1E;padding:28px 36px;text-align:right">
  <span style="color:#fff;font-size:20px;font-weight:800">VITAS</span>
  <span style="color:#5B5EF4;font-size:20px;font-weight:800"> Reports</span>
</td></tr>
<tr><td style="padding:36px 36px 28px">
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0B0F1E">הוזמנת לצפות בדוח הפרויקט</h1>
  <p style="margin:0 0 24px;font-size:15px;color:#5E6478;line-height:1.6">
    ${clientName ? `ניתנה לך גישה לדוח הביצועים של <strong style="color:#0B0F1E">${clientName}</strong>.` : 'ניתנה לך גישה לדוח הביצועים.'}
  </p>
  <div style="background:#F5F7FB;border-radius:12px;padding:20px 24px;margin:0 0 24px;border:1px solid #DDE2EC">
    <p style="margin:0 0 12px;font-size:13px;color:#98A0B2;font-weight:600">פרטי כניסה:</p>
    <p style="margin:0 0 6px;font-size:14px;color:#0B0F1E">
      <strong>אתר:</strong> <a href="${siteUrl}/client" style="color:#5B5EF4">${siteUrl}/client</a>
    </p>
    <p style="margin:0 0 6px;font-size:14px;color:#0B0F1E">
      <strong>מייל:</strong> ${toEmail}
    </p>
    <p style="margin:0;font-size:14px;color:#0B0F1E">
      <strong>סיסמה:</strong> <code style="background:#fff;border:1px solid #DDE2EC;padding:2px 8px;border-radius:6px;font-size:15px;letter-spacing:0.05em">${tempPassword}</code>
    </p>
  </div>
  <p style="margin:0;font-size:12px;color:#98A0B2;line-height:1.6;text-align:center">
    אם לא ביקשת גישה — ניתן להתעלם ממייל זה.
  </p>
</td></tr>
<tr><td style="background:#F5F7FB;padding:18px 36px;border-top:1px solid #DDE2EC">
  <p style="margin:0;font-size:11px;color:#98A0B2;text-align:center">VITAS Digital Marketing &bull; vitas.co.il</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VITAS Reports <noreply@vitas.co.il>',
        to: [toEmail],
        subject: `גישה לדוח${clientName ? ` — ${clientName}` : ''}`,
        html,
      }),
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data.message || JSON.stringify(data) }
    return { ok: true, id: data.id }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function GET(req) {
  const auth = await requireAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { searchParams } = new URL(req.url)
  // Non-admin callers may only read their own access list
  const email = auth.user.isAdmin ? searchParams.get('email') : auth.user.email
  if (!auth.user.isAdmin && !email) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

export async function POST(req) {
  const auth = await requireAuth(req, { adminOnly: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await req.json()
  // project_ids is OPTIONAL: omit (or send empty) to grant access to ALL of the client's
  // projects (the original behaviour); send a subset to grant per-project access.
  const { email, client_id, project_ids } = body
  if (!email || !client_id) return NextResponse.json({ error: 'email and client_id required' }, { status: 400 })

  const cleanEmail = email.toLowerCase().trim()

  const { data: projects, error: projErr } = await supabaseAdmin
    .from('projects').select('id, name, clients(name)').eq('client_id', client_id)
  if (projErr || !projects?.length)
    return NextResponse.json({ error: projErr?.message || 'No projects found' }, { status: 400 })

  const existingProjectIds = projects.map(p => p.id)

  // Which projects should this person end up with? Guard against ids from another client.
  const requested = Array.isArray(project_ids) ? project_ids.filter(id => existingProjectIds.includes(id)) : []
  const grantedProjects = requested.length > 0 ? projects.filter(p => requested.includes(p.id)) : projects
  if (!grantedProjects.length) return NextResponse.json({ error: 'no valid project_ids for this client' }, { status: 400 })

  // Clean replace: drop every existing row for this email across THIS client's projects,
  // then insert only the granted ones. So the saved set is exactly what was selected.
  await supabaseAdmin.from('client_access').delete().eq('email', cleanEmail).in('project_id', existingProjectIds)

  const rows = grantedProjects.map(p => ({ email: cleanEmail, project_id: p.id }))
  const { error: insertErr } = await supabaseAdmin.from('client_access').insert(rows)
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  const clientName = projects[0]?.clients?.name || ''
  const tempPassword = generateTempPassword()

  // Create or update Supabase auth user
  const authResult = await upsertAuthUser(cleanEmail, tempPassword)

  // Send email with password
  let emailSent = false
  let emailError = null
  if (authResult.ok) {
    const result = await sendPasswordEmail(cleanEmail, tempPassword, clientName)
    emailSent = result.ok
    emailError = result.error || null
  } else {
    emailError = authResult.error
  }

  // Return the temp password so the admin can deliver it out-of-band (WhatsApp/phone).
  // The email is NOT a reliable channel: Microsoft/Outlook quarantines mail containing a
  // plaintext password as phishing (confirmed — Resend reports "Delivered", the client never
  // sees it). The password is hashed in Supabase and can NEVER be recovered afterwards, so
  // this is the only moment it can be shown. Admin-only endpoint (requireAuth adminOnly).
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  return NextResponse.json({
    client_id, clientName, projectCount: grantedProjects.length,
    projectNames: grantedProjects.map(p => p.name),
    emailSent, emailError,
    email: cleanEmail,
    tempPassword: authResult.ok ? tempPassword : null,
    loginUrl: `${siteUrl}/client`,
  }, { status: 201 })
}

export async function DELETE(req) {
  const auth = await requireAuth(req, { adminOnly: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('client_access').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
