// /api/cron/health — "dead man's switch" watchdog.
// Runs hourly. Detects if a data cron has gone SILENT (didn't run / crashed before
// writing), which the in-cron alerts can't catch. Checks freshness of the newest
// CRM report and the newest ads (facebook) report separately, so it catches either
// cron stopping. Emails via Resend if data is stale during active hours.
import { createClient } from '@supabase/supabase-js'
import { sendAlert } from '../../../../lib/alert'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STALE_HOURS = 4 // crons run every 2h; >4h stale during the day = something's wrong

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

  // Active window (UTC): ads cron 04:30, crm 04:40 ... last 18:40. Expect fresh data
  // by ~05:00 and through ~19:00 UTC. Only watch during/after the active window so we
  // don't false-alarm overnight when no cron is scheduled.
  const utcH = new Date().getUTCHours()
  const inActiveWindow = utcH >= 6 && utcH <= 21

  const newestAgeH = async (filter) => {
    let q = sb.from('reports').select('created_at').order('created_at', { ascending: false }).limit(1)
    if (filter === 'crm') q = q.eq('source', 'crm')
    else if (filter === 'ads') q = q.eq('source', 'facebook')
    const { data } = await q
    const ts = data && data[0] && data[0].created_at
    return { ts, ageH: ts ? (Date.now() - new Date(ts).getTime()) / 3.6e6 : 9999 }
  }

  const crm = await newestAgeH('crm')
  const ads = await newestAgeH('ads')

  const stale = []
  if (inActiveWindow && crm.ageH > STALE_HOURS) stale.push({ job: 'prefetch-crm (BMBY/CRM)', ageH: crm.ageH, ts: crm.ts })
  if (inActiveWindow && ads.ageH > STALE_HOURS) stale.push({ job: 'prefetch-ads (Meta/Google)', ageH: ads.ageH, ts: ads.ts })

  if (stale.length) {
    const rows = stale.map(s => `<li><b>${s.job}</b> — אין נתונים חדשים כבר ${s.ageH.toFixed(1)} שעות (אחרון: ${s.ts || 'מעולם'})</li>`).join('')
    const html = `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:right">
      <h2>🚨 ייתכן שקרון הפסיק לרוץ</h2>
      <p>השומר זיהה שלא נכתבו נתונים טריים בשעות הפעילות. ייתכן שהקרון לא רץ או קרס.</p>
      <ul>${rows}</ul>
      <p style="color:#888;font-size:12px">VITAS Reports · קרון שומר (health)</p></div>`
    try { await sendAlert({ subject: `🚨 VITAS: ייתכן שקרון נתקע (${stale.map(s => s.job.split(' ')[0]).join(', ')})`, html }) } catch {}
  }

  return Response.json({
    ok: true, utcH, inActiveWindow,
    crmAgeH: Math.round(crm.ageH * 10) / 10,
    adsAgeH: Math.round(ads.ageH * 10) / 10,
    alerted: stale.length,
  })
}
