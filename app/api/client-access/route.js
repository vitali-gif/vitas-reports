import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

function checkAuth(req) {
  const key = req.headers.get('x-client-key')
  const expected = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return expected && key === expected
}

// Send invite email directly via Resend API (bypasses Supabase SMTP)
async function sendInviteEmail(toEmail, magicLink, projectName) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return { ok: false, error: 'RESEND_API_KEY not set' }

  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F7FB;font-family:'Heebo',Arial,sans-serif;direction:rtl">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FB;padding:40px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(11,15,30,0.08)">

        <!-- Header -->
        <tr><td style="background:#0B0F1E;padding:28px 36px;text-align:right">
          <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.03em">VITAS</span>
          <span style="color:#5B5EF4;font-size:20px;font-weight:800"> Reports</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 36px 28px">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0B0F1E;letter-spacing:-0.02em">
            הוזמנת לצפות בדוח הפרויקט
          </h1>
          <p style="margin:0 0 24px;font-size:15px;color:#5E6478;line-height:1.6">
            ${projectName ? `ניתנה לך גישה לדוח הביצועים של <strong style="color:#0B0F1E">${projectName}</strong>.` : 'ניתנה לך גישה לדוח הביצועים של הפרויקט שלך.'}
            <br>לחץ על הכפתור כדי להיכנס:
          </p>

          <div style="text-align:center;margin:28px 0">
            <a href="${magicLink}"
               style="display:inline-block;background:#5B5EF4;color:#fff;font-size:15px;font-weight:700;
                      text-decoration:none;padding:14px 36px;border-radius:10px;
                      box-shadow:0 6px 20px rgba(91,94,244,0.35)">
              כניסה לדוח &rarr;
            </a>
          </div>

          <p style="margin:20px 0 0;font-size:12px;color:#98A0B2;line-height:1.6;text-align:center">
            הקישור בתוקף ל-24 שעות.<br>
            אם לא ביקשת גישה — ניתן להתעלם ממייל זה.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#F5F7FB;padding:18px 36px;border-top:1px solid #DDE2EC">
          <p style="margin:0;font-size:11px;color:#98A0B2;text-align:center">
            VITAS Digital Marketing &bull; vitas.co.il
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'VITAS Reports <noreply@vitas.co.il>',
        to: [toEmail],
        subject: `הוזמנת לצפות בדוח${projectName ? ` — ${projectName}` : ''}`,
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

// POST — add entry + send magic link via Resend directly
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
    .select('*, projects(name)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  const projectName = data?.projects?.name || ''

  // Generate magic link via Supabase admin
  let magicLink = null
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: cleanEmail,
    options: { redirectTo: `${siteUrl}/client` }
  })
  if (!linkError && linkData?.properties?.action_link) {
    magicLink = linkData.properties.action_link
  }

  // Send email directly via Resend API
  let emailSent = false
  let emailError = null
  if (magicLink) {
    const result = await sendInviteEmail(cleanEmail, magicLink, projectName)
    emailSent = result.ok
    emailError = result.error || null
  } else {
    emailError = linkError?.message || 'Failed to generate magic link'
  }

  return NextResponse.json({
    ...data,
    emailSent,
    emailError,
    magicLink: emailSent ? null : magicLink, // fallback for admin if email failed
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
