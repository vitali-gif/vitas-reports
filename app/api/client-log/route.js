import { NextResponse } from 'next/server'
import { requireAdmin, requireUser, escapeHtml, adminClient } from '../../../lib/auth'
import { createClient } from '@supabase/supabase-js'
import { sendAlert } from '../../../lib/alert'

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

// משתמשי בדיקה — לא נרשמים בלוג ולא מוצגים בו. qa@vitas.co.il הוא משתמש ה-E2E: הוא נכנס
// בכל פריסת preview ובכל בוקר, צבר 2,121 כניסות, ומילא את 100 השורות שהלוג מציג — כך
// שכניסות של לקוחות אמיתיים לא נראו (ויטלי, 29.9). כתובות נוספות: CLIENT_LOG_IGNORE ב-Vercel,
// מופרדות בפסיק.
const LOG_IGNORED = new Set(['qa@vitas.co.il', ...String(process.env.CLIENT_LOG_IGNORE || '').split(',')]
  .map(e => e.toLowerCase().trim()).filter(Boolean))
// לא נספרים גם (ויטלי, 6.11: "תסנן את הפעולות שלי ושל גורדל ואת המייל הפרטי שלי"): כל מייל בטבלת
// admins, וכל כינוי של המייל הפרטי (vitalidisel+משהו@gmail.com — משתמשי בדיקה שלו).
const OWNER_ALIAS = /^vitalidisel(\+[^@]*)?@gmail\.com$/
// גורדל לא בטבלת admins (יש לו גישת לקוח ל-7 פרויקטים), ולכן עד 8.11 הכניסות שלו עדיין הוצגו
const STAFF_LIKE = '%gordel%'
const STAFF_RE = /gordel/i
let _admins = { at: 0, set: new Set() }
async function adminEmails() {
  if (Date.now() - _admins.at < 5 * 60 * 1000) return _admins.set
  const { data } = await supabaseAdmin.from('admins').select('email')
  _admins = { at: Date.now(), set: new Set((data || []).map(a => String(a.email || '').toLowerCase().trim()).filter(Boolean)) }
  return _admins.set
}
async function isIgnored(email) {
  const e = String(email || '').toLowerCase().trim()
  return LOG_IGNORED.has(e) || OWNER_ALIAS.test(e) || STAFF_RE.test(e) || (await adminEmails()).has(e)
}
// מסנן לשאילתה: הרשימה המדויקת + כל הכינויים של המייל הפרטי. סינכרוני בכוונה — await על
// query builder של Supabase מריץ אותו; את הרשימה מביאים קודם (ignoreList).
async function ignoreList() { return [...new Set([...LOG_IGNORED, ...(await adminEmails()), 'vitalidisel@gmail.com'])] }
const excludeIgnored = (q, list) => q.not('email', 'in', `(${list.map(e => `"${e.replace(/"/g, '')}"`).join(',')})`).not('email', 'ilike', 'vitalidisel+%@gmail.com').not('email', 'ilike', STAFF_LIKE)

// POST â log session events from client dashboard
// פעולות בתוך הכניסה (lib/usage-track.js, מיגרציה 029): רק השמות והשדות האלה נשמרים, טקסט קצר בלבד.
const ACTIONS = { tab: ['tab'], crm_view: ['view'], period: ['period'], compare: [], section: ['title'], help: ['title'], ai_open: [], modal: ['kind'] }
const DEVICES = new Set(['mobile', 'tablet', 'desktop'])
const cleanText = (v, n = 80) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n)
const okSec = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Math.round(Number(v)), 86400) : null)
// עמודות מיגרציה 029 — לפני שהיא רצה, העדכון נכשל על העמודה; מנסים שוב בלעדיה
async function updateSession(id, email, patch, extra) {
  const { error } = await supabaseAdmin.from('client_sessions').update({ ...patch, ...extra }).eq('id', id).eq('email', email)
  if (error && Object.keys(extra).length) await supabaseAdmin.from('client_sessions').update(patch).eq('id', id).eq('email', email)
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}))
  // navigator.sendBeacon (אירוע logout) לא יכול לשאת כותרות, לכן הטוקן מתקבל גם מהגוף.
  const gate = await requireUser(req, body.accessToken)
  if (!gate.ok) return gate.res
  const email = gate.user.email

  const { event, clientName, projectIds, sessionId, durationSec } = body

  if (event === 'login') {
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
    // בלי sessionId ה-heartbeat וה-project_select שאחריו לא נוגעים בטבלה.
    if (await isIgnored(email)) return NextResponse.json({ ok: true, sessionId: null })
    const row = {
      email: email.toLowerCase().trim(),
      client_name: clientName || null,
      project_ids: projectIds || [],
      logged_in_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    }
    const device = DEVICES.has(body.device) ? body.device : null
    let { data, error } = await supabaseAdmin.from('client_sessions').insert(device ? { ...row, device } : row).select('id').single()
    if (error && device) ({ data, error } = await supabaseAdmin.from('client_sessions').insert(row).select('id').single())
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, sessionId: data.id })
  }

  if (event === 'heartbeat') {
    if (!sessionId) return NextResponse.json({ ok: true })
    const act = okSec(body.activeSec)
    // heartbeat בלי activeSec = גרסה ישנה של הדף שנשארה פתוחה בלשונית (לפני 6.11). היא שולחת כל דקה גם
    // כשאף אחד לא משתמש, ולכן לא מעדכנים לפיה — אחרת הכניסה נראית "פעילה עכשיו" ימים שלמים.
    if (act == null) return NextResponse.json({ ok: true })
    await updateSession(sessionId, email, { last_seen_at: new Date().toISOString() }, { active_sec: act })
    return NextResponse.json({ ok: true })
  }

  if (event === 'actions') {
    if (!sessionId || !Array.isArray(body.items) || !body.items.length) return NextResponse.json({ ok: true })
    // הכניסה חייבת להיות של המשתמש הזה — אחרת אפשר היה לכתוב פעולות לכניסה של מישהו אחר
    const { data: own } = await supabaseAdmin.from('client_sessions').select('id').eq('id', sessionId).eq('email', email).maybeSingle()
    if (!own) return NextResponse.json({ ok: true })
    const now = Date.now()
    const rows = body.items.slice(0, 60).filter(i => i && Object.prototype.hasOwnProperty.call(ACTIONS, i.name)).map(i => {
      const detail = {}
      for (const k of ACTIONS[i.name]) if (i.detail && i.detail[k] != null) detail[k] = cleanText(i.detail[k])
      const t = Date.parse(i.at)
      return { session_id: sessionId, email: email.toLowerCase().trim(), project_name: i.project ? cleanText(i.project, 120) : null, name: i.name, detail,
        at: Number.isFinite(t) && t <= now + 60000 && t > now - 864e5 ? new Date(t).toISOString() : new Date(now).toISOString() }
    })
    if (rows.length) await supabaseAdmin.from('client_events').insert(rows)   // לפני מיגרציה 029 — נכשל בשקט
    return NextResponse.json({ ok: true })
  }

  if (event === 'project_select') {
    if (!sessionId) return NextResponse.json({ ok: true })
    await supabaseAdmin
      .from('client_sessions')
      // שם הלקוח לפי הפרויקט שנבחר — משתמש עם גישה לכמה לקוחות נרשם בכניסה לפי הראשון ברשימה
      .update({ selected_project: body.projectName || null, ...(clientName ? { client_name: String(clientName).slice(0, 120) } : {}) })
      .eq('id', sessionId).eq('email', email)
    return NextResponse.json({ ok: true })
  }

  if (event === 'logout') {
    if (!sessionId) return NextResponse.json({ ok: true })
    const act = okSec(body.activeSec)
    await updateSession(sessionId, email, { ended: true, last_seen_at: new Date().toISOString(), duration_sec: durationSec || 0 }, act != null ? { active_sec: act } : {})
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
    try { await sendAlert({ subject: `\u26a0\ufe0f VITAS: \u05dc\u05e7\u05d5\u05d7 \u05e8\u05d0\u05d4 \u05d3\u05e9\u05d1\u05d5\u05e8\u05d3 \u05e8\u05d9\u05e7 \u2014 ${escapeHtml(clientName) || email || ''}`, html }) } catch {}
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown event' }, { status: 400 })
}

// DELETE â clear all session logs (protected by anon key header)
export async function DELETE(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const { error } = await supabaseAdmin.from('client_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// GET â fetch logs for admin (protected by anon key header)
export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res

  const url = new URL(req.url)
  const view = url.searchParams.get('view')
  if (view === 'usage' || view === 'user') return usageView(url, view)

  // השורות הישנות של משתמשי הבדיקה נשארות בטבלה — מסננים אותן כאן, לפני תקרת ה-100.
  let q = supabaseAdmin
    .from('client_sessions')
    .select('*')
  q = excludeIgnored(q, await ignoreList())
  const { data, error } = await q
    .order('logged_in_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich: compute effective duration
  const now = Date.now()
  const enriched = (data || []).map(s => {
    const lastSeen = new Date(s.last_seen_at).getTime()
    const loggedIn = new Date(s.logged_in_at).getTime()
    const isActive = !s.ended && s.active_sec != null && (now - lastSeen) < 3 * 60 * 1000 // heartbeat < 3 min ago, from a page that measures work time (6.11+)
    const durSec = s.ended ? s.duration_sec : Math.round((lastSeen - loggedIn) / 1000)
    return { ...s, isActive, durSec }
  })

  return NextResponse.json(enriched)
}

// ── מסך השימוש (ויטלי, 6.11): סיכום לכל משתמש, וציר זמן של משתמש אחד ─────────────────────────
// view=usage&days=30 → { since, users: [...] } · view=user&email=…&days=30 → { sessions: [{ ..., events: [...] }] }
const effDur = (s, now) => (s.ended ? (s.duration_sec || 0) : Math.round((new Date(s.last_seen_at).getTime() - new Date(s.logged_in_at).getTime()) / 1000))
async function usageView(url, view) {
  const days = Math.min(180, Math.max(1, Number(url.searchParams.get('days')) || 30))
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const now = Date.now()
  const ign = await ignoreList()
  const notIgnored = (q) => excludeIgnored(q, ign)

  if (view === 'user') {
    const email = String(url.searchParams.get('email') || '').toLowerCase().trim()
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
    const { data: ss, error } = await supabaseAdmin.from('client_sessions').select('*').eq('email', email).gte('logged_in_at', since).order('logged_in_at', { ascending: false }).limit(60)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const ids = (ss || []).map(x => x.id)
    const evs = []
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabaseAdmin.from('client_events').select('session_id, project_name, name, detail, at').in('session_id', ids.slice(i, i + 100)).order('at', { ascending: true }).limit(5000)
      evs.push(...(data || []))
    }
    const by = new Map(); for (const e of evs) { if (!by.has(e.session_id)) by.set(e.session_id, []); by.get(e.session_id).push(e) }
    return NextResponse.json({ sessions: (ss || []).map(x => ({ ...x, durSec: effDur(x, now), isActive: !x.ended && x.active_sec != null && now - new Date(x.last_seen_at).getTime() < 180000, events: by.get(x.id) || [] })) }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const { data: ss, error } = await notIgnored(supabaseAdmin.from('client_sessions').select('*').gte('logged_in_at', since)).order('logged_in_at', { ascending: false }).limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: evs, error: evErr } = await notIgnored(supabaseAdmin.from('client_events').select('email, name, detail, at').gte('at', since)).order('at', { ascending: false }).limit(20000)
  const users = new Map()
  const U = (email) => users.get(email) || users.set(email, { email, client: null, sessions: 0, days: new Set(), durSec: 0, activeSec: 0, activeKnown: 0, lastAt: null, devices: {}, projects: new Set(), tabs: {}, sections: {}, help: {}, crmViews: {}, ai: 0, compare: 0, modals: 0, periods: { month: 0, range: 0 } }).get(email)
  for (const x of ss || []) {
    const u = U(x.email)
    u.client = u.client || x.client_name
    u.sessions++
    u.days.add(String(x.logged_in_at).slice(0, 10))
    u.durSec += effDur(x, now)
    if (x.active_sec != null) { u.activeSec += x.active_sec; u.activeKnown++ }
    if (!u.lastAt || x.last_seen_at > u.lastAt) u.lastAt = x.last_seen_at
    if (x.device) u.devices[x.device] = (u.devices[x.device] || 0) + 1
    if (x.selected_project) u.projects.add(x.selected_project)
  }
  const inc = (o, k) => { if (k) o[k] = (o[k] || 0) + 1 }
  for (const e of evs || []) {
    const u = users.get(e.email); if (!u) continue
    const d = e.detail || {}
    if (e.name === 'tab') inc(u.tabs, d.tab)
    else if (e.name === 'section') inc(u.sections, d.title)
    else if (e.name === 'help') inc(u.help, d.title)
    else if (e.name === 'crm_view') inc(u.crmViews, d.view)
    else if (e.name === 'ai_open') u.ai++
    else if (e.name === 'compare') u.compare++
    else if (e.name === 'modal') u.modals++
    else if (e.name === 'period') u.periods[String(d.period || '').includes('_') ? 'range' : 'month']++
  }
  const top = (o, n = 8) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n)
  const out = [...users.values()].map(u => ({
    email: u.email, client: u.client, sessions: u.sessions, days: u.days.size, durSec: u.durSec,
    activeSec: u.activeKnown ? u.activeSec : null, activeSessions: u.activeKnown, lastAt: u.lastAt, devices: u.devices, projects: [...u.projects],
    tabs: top(u.tabs, 12), sections: top(u.sections, 40), help: top(u.help, 10), crmViews: top(u.crmViews, 10),
    ai: u.ai, compare: u.compare, modals: u.modals, periods: u.periods,
  })).sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
  return NextResponse.json({ since, days, eventsReady: !evErr, users: out }, { headers: { 'Cache-Control': 'no-store' } })
}
