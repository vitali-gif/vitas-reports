import { NextResponse } from 'next/server'
import { requireAdmin, getUser, isAdminEmail, unauthorized, adminClient, escapeHtml } from '../../../lib/auth'
import { randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'

// לקוח service_role עצל. קודם הוא נוצר ברמת המודול עם נפילה חזרה למפתח
// ה-anon — כלומר אם SUPABASE_SERVICE_ROLE_KEY חסר בסביבה, ה-route המשיך לעבוד
// בשקט עם הרשאות נמוכות והחזיר תוצאות חלקיות, שנראות כמו באג בנתונים ולא
// כתקלת קונפיגורציה. עכשיו הוא נוצר בבקשה הראשונה (לא בזמן build) וזורק
// שגיאה מפורשת אם המפתח חסר. ה-Proxy קיים כדי שמוקדי השימוש יישארו כמו שהם.
let _sbAdmin = null
const supabaseAdmin = new Proxy({}, {
  get(_target, prop) {
    if (!_sbAdmin) _sbAdmin = adminClient()
    const value = _sbAdmin[prop]
    return typeof value === 'function' ? value.bind(_sbAdmin) : value
  },
})

// הרשאה: אדמין מאומת בלבד. ה-route הזה יוצר משתמשי Supabase ומנפיק קישורי כניסה,
// ולכן הוא היה נתיב ההשתלטות הישיר כשהשומר היה מפתח ה-anon הציבורי.

// ── הזמנה בקישור, בלי סיסמה במייל ─────────────────────────────────────────────
// עד 17.9 נשלחה סיסמה זמנית בטקסט גלוי — Outlook סימן/חסם את המיילים, וסיסמה במייל היא
// גם סיכון. עכשיו: המשתמש נוצר עם סיסמה אקראית שאיש לא רואה, ומקבל קישור כניסה חד-פעמי
// שמוביל למסך "בחר סיסמה" (/client?setpw=1). הוספה חוזרת של מייל קיים לא נוגעת בסיסמה
// שלו — רק שולחת קישור חדש.

/** יוצר משתמש Auth אם אינו קיים. לעולם לא משנה סיסמה של משתמש קיים. */
async function ensureAuthUser(email) {
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: randomBytes(24).toString('base64url'),   // לא נשמר ולא נשלח — הלקוח יבחר משלו בקישור
    email_confirm: true,
  })
  if (!createErr) return { ok: true, userId: created.user?.id, created: true }
  // קיים — בסדר גמור (createUser מחזיר שגיאה על מייל תפוס)
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  const existing = users?.find(u => u.email === email)
  if (!existing) return { ok: false, error: createErr.message }
  return { ok: true, userId: existing.id, created: false }
}

/** קישור כניסה חד-פעמי שמוביל למסך קביעת סיסמה. */
async function inviteLinkFor(email) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink', email, options: { redirectTo: `${siteUrl}/client?setpw=1` },
  })
  if (error || !data?.properties?.action_link) return { ok: false, error: error?.message || 'Failed to generate link' }
  return { ok: true, link: data.properties.action_link }
}

async function sendInviteEmail(toEmail, link, clientName) {
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
<tr><td style="background:#14243C;padding:28px 36px;text-align:right">
  <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.03em">tovno</span>
  <span style="color:#7191FF;font-size:14px;font-weight:700"> by Vitas</span>
</td></tr>
<tr><td style="padding:36px 36px 28px">
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0B0F1E">הוזמנת לצפות בדוח הפרויקט</h1>
  <p style="margin:0 0 20px;font-size:15px;color:#5E6478;line-height:1.6">
    ${clientName ? `ניתנה לך גישה לדוח הביצועים של <strong style="color:#0B0F1E">${escapeHtml(clientName)}</strong>.` : 'ניתנה לך גישה לדוח הביצועים.'}<br>
    שם המשתמש שלך הוא כתובת המייל הזו: <strong style="color:#0B0F1E;direction:ltr;unicode-bidi:isolate">${escapeHtml(toEmail)}</strong>
  </p>
  <div style="text-align:center;margin:24px 0">
    <a href="${link}" style="display:inline-block;background:#5B5EF4;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:10px;box-shadow:0 6px 20px rgba(91,94,244,0.35)">כניסה וקביעת סיסמה &rarr;</a>
  </div>
  <p style="margin:0;font-size:13px;color:#5E6478;line-height:1.7">
    הקישור לשימוש חד-פעמי. בלחיצה תיכנס לדוח ותתבקש לבחור סיסמה משלך לכניסות הבאות.<br>
    אם הקישור פג תוקף — במסך הכניסה ב-<a href="${siteUrl}/client" style="color:#5B5EF4">${siteUrl}/client</a> לוחצים "שלחו לי קישור כניסה".
  </p>
  <p style="margin:18px 0 0;font-size:12px;color:#98A0B2;line-height:1.6;text-align:center">אם לא ביקשת גישה — ניתן להתעלם ממייל זה.</p>
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
      body: JSON.stringify({ from: 'Tovno by Vitas <noreply@vitas.co.il>', to: [toEmail], subject: `גישה לדוח${clientName ? ` — ${clientName}` : ''}`, html }),
    })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data.message || JSON.stringify(data) }
    return { ok: true, id: data.id }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// GET — אדמין מקבל את הכל (או מסנן לפי ?email=). לקוח מחובר מקבל רק את השורות
// שלו עצמו: מתעלמים מפרמטר email והמייל נלקח מהטוקן, אחרת כל לקוח היה יכול
// לקרוא את רשימת ההרשאות והמיילים של כל שאר הלקוחות.
export async function GET(req) {
  const user = await getUser(req)
  if (!user) return unauthorized()
  const admin = await isAdminEmail(user.email)

  const { searchParams } = new URL(req.url)
  const requested = searchParams.get('email')
  const scopeEmail = admin ? (requested ? requested.toLowerCase().trim() : null) : user.email

  let query = supabaseAdmin
    .from('client_access')
    // plan נשלח כדי שהדשבורד יידע להציג תגית PRO ומסך שדרוג. זו תצוגה בלבד —
    // האכיפה היא ב-lib/auth.js (requireProjectPlan), ולא כאן.
    .select('*, projects(id, name, client_id, is_demo, clients(name, color, plan))')

  if (scopeEmail) query = query.eq('email', scopeEmail).order('created_at', { ascending: true })
  else query = query.order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}

export async function POST(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const body = await req.json()
  // project_ids אופציונלי: אם נשלח — מעניקים גישה רק לפרויקטים שנבחרו.
  // בלעדיו נשמרת ההתנהגות הישנה (כל הפרויקטים של הלקוח), כדי לא לשבור
  // קריאות קיימות.
  // notify=false → עדכון היקף גישה בלבד, בלי מייל. notify=true → קישור כניסה חד-פעמי במייל.
  // הסיסמה של משתמש קיים לעולם לא משתנה כאן.
  // notify_client_names (אופציונלי): כשהאדמין מעניק גישה לכמה לקוחות בבת אחת, הדשבורד שולח קריאה
  // לכל לקוח ומבקש מייל רק באחרונה — ובמייל מופיעים כל הלקוחות, לא רק זה של הקריאה.
  const { email, client_id, project_ids, notify, notify_client_names } = body
  const shouldNotify = notify !== false
  if (!email || !client_id) return NextResponse.json({ error: 'email and client_id required' }, { status: 400 })

  const cleanEmail = email.toLowerCase().trim()

  const { data: allProjects, error: projErr } = await supabaseAdmin
    .from('projects').select('id, name, clients(name)').eq('client_id', client_id)
  if (projErr || !allProjects?.length)
    return NextResponse.json({ error: projErr?.message || 'No projects found' }, { status: 400 })

  // סינון לפי הבחירה — תמיד מול הפרויקטים של הלקוח הזה, כדי ש-project_ids
  // שרירותי לא יוכל להעניק גישה לפרויקט של לקוח אחר.
  const wanted = Array.isArray(project_ids) && project_ids.length
    ? allProjects.filter(p => project_ids.includes(p.id))
    : allProjects
  if (!wanted.length)
    return NextResponse.json({ error: 'לא נבחרו פרויקטים תקפים עבור הלקוח הזה' }, { status: 400 })

  // מוחקים את כל השורות הקיימות של המייל בתוך הלקוח הזה ואז כותבים מחדש —
  // כך שליחה חוזרת עם בחירה אחרת גם *מסירה* פרויקטים, ולא רק מוסיפה.
  const clientProjectIds = allProjects.map(p => p.id)
  await supabaseAdmin.from('client_access').delete().eq('email', cleanEmail).in('project_id', clientProjectIds)

  const projects = wanted
  const rows = projects.map(p => ({ email: cleanEmail, project_id: p.id }))
  const { error: insertErr } = await supabaseAdmin.from('client_access').insert(rows)
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  const clientName = projects[0]?.clients?.name || ''
  const emailClientName = Array.isArray(notify_client_names) && notify_client_names.length
    ? notify_client_names.map(n => String(n).slice(0, 80)).slice(0, 20).join(', ')
    : clientName

  // notify: לוודא שיש משתמש Auth, להנפיק קישור כניסה חד-פעמי ולשלוח. בלי סיסמה, בלי לגעת
  // בסיסמה של משתמש קיים. הקישור חוזר גם לאדמין (inviteLink) להעברה ידנית אם המייל לא הגיע.
  let emailSent = false
  let emailError = null
  let inviteLink = null
  if (shouldNotify) {
    const authResult = await ensureAuthUser(cleanEmail)
    if (!authResult.ok) emailError = authResult.error
    else {
      const lk = await inviteLinkFor(cleanEmail)
      if (!lk.ok) emailError = lk.error
      else {
        inviteLink = lk.link
        const result = await sendInviteEmail(cleanEmail, inviteLink, emailClientName)
        emailSent = result.ok
        emailError = result.error || null
      }
    }
  }

  return NextResponse.json({
    client_id, clientName,
    projectCount: projects.length,
    projectNames: projects.map(p => p.name),
    notified: shouldNotify,
    emailSent, emailError,
    email: cleanEmail,
    inviteLink,
    tempPassword: null,   // תאימות לאחור: אין יותר סיסמאות זמניות
    loginUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il') + '/client',
  }, { status: 201 })
}

export async function DELETE(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('client_access').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
