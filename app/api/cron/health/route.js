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
// 2026-09-08: המתזמן הוחלף ל-cron-job.org (דיוק של דקה) ו-GitHub Actions נשאר כגיבוי בלבד,
// אז אין יותר צורך בסבלנות לאיחורים של שעות. החלון נפתח ב-05:00 UTC (08:00 בישראל) כדי שהתקלה
// תתגלה לפני שמישהו פותח את הדשבורד, ולא ב-13:00 כמו קודם.
const STALE_HOURS = 3
// "שקט": אף שורה לא נכתבה בכלל. הקצב הוא שעתיים, אז 4 שעות בלי שום כתיבה = תקלה ודאית.
const SILENT_HOURS = 4
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
  const inActiveWindow = utcH >= 5 && utcH <= 21

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

  // ── "שקט" — אף שורת דוח לא נכתבה לאחרונה. ─────────────────────────────────────────
  // ה-heartbeat למעלה תופס "הקרון לא רץ". הבדיקה הזו תופסת גם את המקרה ההפוך והגרוע יותר:
  // הקרון רץ, דיווח הצלחה, וכתב heartbeat — אבל לא כתב שום נתון. נשלחת רק כשהתראת ה-heartbeat
  // לא נשלחה, כדי לא להתריע פעמיים על אותו שורש.
  let writeAgeH = null
  try {
    const { data: newest } = await sb.from('reports').select('created_at').order('created_at', { ascending: false }).limit(1)
    const ts = newest && newest[0] && newest[0].created_at
    if (ts) {
      writeAgeH = Math.round(((Date.now() - new Date(ts).getTime()) / 3.6e6) * 10) / 10
      if (inActiveWindow && stale.length === 0 && writeAgeH > SILENT_HOURS) {
        const html = `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:right">
          <h2>🚨 אין כתיבות חדשות לטבלת הדוחות</h2>
          <p>הקרונים מדווחים שהם רצים, אבל <b>לא נכתבה שום שורה כבר ${writeAgeH} שעות</b> (הקצב הצפוי: שעתיים).</p>
          <p>כלומר המשיכה מתבצעת אך לא מגיעה למסד — לא תקלת תזמון אלא תקלת נתונים.</p>
          <p style="color:#888;font-size:12px">VITAS Reports · שומר שקט</p></div>`
        try { await sendAlert({ subject: `🚨 VITAS: אין נתונים חדשים כבר ${writeAgeH} שעות`, html }) } catch {}
      }
    }
  } catch { /* best-effort */ }

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
      // Per-client IMMEDIATE alerts: a client whose data didn't update as expected (even one day),
      // but ONLY when the relevant cron itself ran fresh — otherwise it's a system-wide cron outage
      // that the heartbeat watchdog above already covers (avoids double alerts + morning false alarms
      // before the day's first run has landed).
      const _freshOf = (job) => { const b = beats.find(x => x.job === job); return !!(b && b.last_run && ((Date.now() - new Date(b.last_run).getTime()) / 3.6e6) <= STALE_HOURS) }
      const _jobFresh = { ads: _freshOf('prefetch-ads'), crm: _freshOf('prefetch-crm') }
      const liveIssues = (health.issues || []).filter(i => _jobFresh[i.job])
      const liveKeys = liveIssues.map(i => `${i.name} — ${i.label}`)
      if (!sentDigest && liveKeys.length) {
        const newIssues = liveIssues.filter(i => !prevReds.includes(`${i.name} — ${i.label}`))
        if (newIssues.length) {
          const rows = newIssues.map(i => `<li><b>${i.name}</b> — ${i.label} <span style="color:#888">(${i.detail})</span></li>`).join('')
          const html = `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:right">
            <h2>⚠️ VITAS: נתונים לא עודכנו אצל לקוח</h2>
            <p>הקרון רץ, אך לפריטים הבאים הנתונים לא עודכנו כמצופה (ייתכן שיום בודד לא נמשך אצל הלקוח):</p>
            <ul>${rows}</ul>
            <p style="color:#888;font-size:12px">VITAS · חיישני בריאות פר-לקוח</p></div>`
          await sendAlert({ subject: `⚠️ VITAS: בעיה בנתונים אצל ${newIssues.length} לקוח/פרויקט`, html })
        }
      }
      await sb.from('health_state').upsert({ id: 1, reds: liveKeys, last_morning: lastMorning, last_evening: lastEvening, updated_at: new Date().toISOString() })
    }
  } catch { /* health branch is best-effort; never fail the watchdog */ }

  // ── Daily reports pruning: delete stale date-range report rows so the table never re-bloats.
  // Unbounded daily-shifting keys (currentMonth/last7/today...) accumulate ~10-15 rows/project/day
  // and were never overwritten → 1000s of rows → the by-project index ballooned and exhausted the
  // DB's Disk IO budget (Cloudflare 522/525 on every cron). Runs at most ~once/day (heartbeat-gated,
  // robust to GitHub Actions lateness). The heavy DELETE runs IN the DB via an RPC (minimal IO/transfer).
  // Requires the SQL function prune_old_reports() to exist; if it doesn't yet, this is a no-op (error
  // caught, heartbeat not written → retried next hour). Never breaks the watchdog.
  let pruned = null
  try {
    const clRow = beats.find(b => b.job === 'reports_cleanup')
    const clAgeH = clRow?.last_run ? (Date.now() - new Date(clRow.last_run).getTime()) / 3.6e6 : Infinity
    if (clAgeH > 20) {
      // retain_days=3 ולא 14: החתך הוא לפי created_at, והקרון דורס את המפתחות
        // החיים כל שעתיים. 14 יום היה משאיר כמעט הכל (נמדד: 224 מתוך 230 שורות).
        const { data, error } = await sb.rpc('prune_old_reports', { retain_days: 3 })
      if (!error) {
        pruned = data
        await sb.from('cron_heartbeat').upsert({ job: 'reports_cleanup', last_run: new Date().toISOString() }, { onConflict: 'job' })
      }
    }
  } catch { /* best-effort; never fail the watchdog */ }

  return Response.json({ ok: true, utcH, inActiveWindow, status, writeAgeH, alerted: stale.length, pruned, health: health ? { anyRed: health.anyRed, reds: health.reds } : null })
}
