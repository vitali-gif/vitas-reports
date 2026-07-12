// /api/cron/health — "dead man's switch" watchdog (hourly).
// Detects if a data cron went SILENT (didn't run / crashed before finishing) — which
// the in-cron alerts can't catch. Each data cron writes an explicit heartbeat row
// (cron_heartbeat.last_run = now) at the end of a successful run; this watchdog alerts
// if a heartbeat is stale during active hours. Bootstrap-safe: if the table/rows don't
// exist yet, it does nothing (no false alarms).
import { createClient } from '@supabase/supabase-js'
import { sendAlert } from '../../../../lib/alert'

export const dynamic = 'force-dynamic'
// force-no-store: supabase-js + internal calls go through fetch, which Next caches by
// default. That cache made the cron read/write STALE data and skip the heartbeat.
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const STALE_HOURS = 4 // crons run every 2h; >4h stale during the day = something's wrong
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

  // Only watch during/after the active cron window (UTC 04:30–18:40 → check 06–21).
  const utcH = new Date().getUTCHours()
  const inActiveWindow = utcH >= 6 && utcH <= 21

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

  return Response.json({ ok: true, utcH, inActiveWindow, status, alerted: stale.length })
}
