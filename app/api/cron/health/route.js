// /api/cron/health — "dead man's switch" watchdog (hourly).
// Detects if a data cron went SILENT (didn't run / crashed before finishing) — which
// the in-cron alerts can't catch. Each data cron writes an explicit heartbeat row
// (cron_heartbeat.last_run = now) at the end of a successful run; this watchdog alerts
// if a heartbeat is stale during active hours. Bootstrap-safe: if the table/rows don't
// exist yet, it does nothing (no false alarms).
import { createClient } from '@supabase/supabase-js'
import { sendAlert } from '../../../../lib/alert'
import { computeHealth, renderHealthEmail, israelHour } from '../../../../lib/health'

export const dynamic = 'force-dynamic'
// force-no-store: supabase-js + internal calls go through fetch, which Next caches by
// default. That cache made the cron read/write STALE data and skip the heartbeat.
export const fetchCache = 'force-no-store'
export const maxDuration = 60

// GitHub Actions (our scheduler since Vercel's died) delivers schedules on a BEST-EFFORT
// basis and is routinely late — the 04:30 UTC slot has landed as late as 07:46. Combined
// with the legitimate overnight gap (last run ~18:30 UTC, next ~04:30 UTC = 10h), a tight
// threshold produced a false "cron stopped" alarm every single morning.
// 6h absorbs the 2h cadence + a few hours of GH delay; the window starts at 10:00 UTC so the
// (possibly delayed) first run of the day has landed before we start judging.
const STALE_HOURS = 6
const JOBS = [
  { job: 'prefetch-ads', label: 'קרון מודעות (Meta/Google)' },
  { job: 'prefetch-crm', label: 'קרון CRM (BMBY/Zoho)' },
]

export async function GET(request) {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return Response.json({ ok: false, error: 'env missing' }, { status: 500 })
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  // Only judge once the (often-delayed) first run of the day has had time to land.
  const utcH = new Date().getUTCHours()
  const inActiveWindow = utcH >= 10 && utcH <= 21

  let beats
  try {
    const { data, error } = await sb.from('cron_heartbeat').select('job, last_run')
    if (error) throw error
    beats = data || []
  } catch (e) {
    // Table not created yet (bootstrap) — do nothing, never false-alarm.
    return Response.json({ ok: true, bootstrap: true, note: 'cron_heartbeat not available yet' })
  }

  const status = []
  const stale = []
  for (const { job, label } of JOBS) {
    const row = beats.find(b => b.job === job)
    if (!row || !row.last_run) { status.push({ job, ageH: null, seen: false }); continue } // never ran yet → skip
    const ageH = (Date.now() - new Date(row.last_run).getTime()) / 3.6e6
    status.push({ job, ageH: Math.round(ageH * 10) / 10, seen: true })
    if (inActiveWindow && ageH > STALE_HOURS) stale.push({ label, ageH, last: row.last_run })
  }

  if (stale.length) {
    const rows = stale.map(s => `<li><b>${s.label}</b> — לא רץ כבר ${s.ageH.toFixed(1)} שעות (אחרון: ${s.last})</li>`).join('')
    const html = `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:right">
      <h2>🚨 ייתכן שקרון הפסיק לרוץ</h2>
      <p>השומר זיהה שקרון לא דיווח על ריצה מוצלחת בשעות הפעילות. ייתכן שלא רץ או קרס.</p>
      <ul>${rows}</ul>
      <p style="color:#888;font-size:12px">VITAS Reports · קרון שומר (health)</p></div>`
    try { await sendAlert({ subject: `🚨 VITAS: ייתכן שקרון נתקע`, html }) } catch {}
  }

  // ── Per-branch data health: morning + evening digest, immediate alert on a NEW red. ──
  // Wrapped so it can NEVER break the heartbeat watchdog above. Date-based dedup makes the
  // digest robust to GitHub Actions lateness (fires on the first hourly run past the target).
  let health = null
  try {
    health = await computeHealth(sb)
    const dateIL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
    const hr = israelHour()
    let st = null, tableOk = true
    try {
      const { data, error } = await sb.from('health_state').select('id, reds, last_morning, last_evening').eq('id', 1)
      if (error) tableOk = false
      else st = (data && data[0]) || { reds: [], last_morning: null, last_evening: null }
    } catch { tableOk = false }
    if (tableOk && st) {
      const prevReds = Array.isArray(st.reds) ? st.reds : []
      let lastMorning = st.last_morning, lastEvening = st.last_evening, sentDigest = false
      if (hr >= 7 && hr < 14 && lastMorning !== dateIL) {
        await sendAlert({ subject: `📊 VITAS בריאות מערכת (בוקר) — ${health.anyRed ? '⚠️ יש בעיות' : '✔️ הכל תקין'}`, html: renderHealthEmail(health, { digest: true }) })
        lastMorning = dateIL; sentDigest = true
      } else if (hr >= 20 && lastEvening !== dateIL) {
        await sendAlert({ subject: `📊 VITAS בריאות מערכת (ערב) — ${health.anyRed ? '⚠️ יש בעיות' : '✔️ הכל תקין'}`, html: renderHealthEmail(health, { digest: true }) })
        lastEvening = dateIL; sentDigest = true
      }
      if (!sentDigest && health.anyRed) {
        const newReds = health.reds.filter(r => !prevReds.includes(r))
        if (newReds.length) await sendAlert({ subject: `🔴 VITAS: ${newReds.length} ענפים נשברו`, html: renderHealthEmail({ ...health, reds: newReds }, { digest: false }) })
      }
      await sb.from('health_state').upsert({ id: 1, reds: health.reds, last_morning: lastMorning, last_evening: lastEvening, updated_at: new Date().toISOString() })
    }
  } catch { /* health branch is best-effort; never fail the watchdog */ }

  return Response.json({ ok: true, utcH, inActiveWindow, status, alerted: stale.length, health: health ? { anyRed: health.anyRed, reds: health.reds } : null })
}
