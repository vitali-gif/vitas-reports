/**
 * /api/fireberry/fetch — משיכת לידים ופגישות מ-Fireberry (אלפא יזמות ובנייה).
 *   POST — מהדשבורד (אדמין מאומת, או קריאה פנימית עם CRON_SECRET)
 *   GET  — מהקרון (Authorization: Bearer <CRON_SECRET>)
 *
 * משתנה סביבה נדרש: FIREBERRY_TOKEN
 *
 * ⚠️ שער בטיחות, בדיוק כמו ב-zoho/fetch: הדשבורד קורא ל-fetch של *כל* ה-CRM-ים עם
 *    ה-projectId הפתוח. בלי הסינון לפי שם הפרויקט, דוח Fireberry היה נכתב על פרויקט
 *    של BMBY ודורס אותו על אותו מפתח (project, source, month).
 */
import { requireFetchAccess } from '../../../../lib/auth'
import { createClient } from '@supabase/supabase-js'
import { OBJ, queryAll, isConfigured } from '../../../../lib/crm/fireberry-api.js'
import { computeFireberrySummary, toReportRow, filterLeads, fireberryConfigFor } from '../../../../lib/crm/fireberry-summary.js'
import { upsertRawRecords, rebuildCompactIfChanged } from '../../../../lib/crm/raw-store.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

function currentMonth() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}
const isValidDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

async function runSync(opts = {}) {
  if (!isConfigured()) {
    return { status: 200, body: { ok: false, pending: true, message: 'FIREBERRY_TOKEN not configured.' } }
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY   // בלי נפילה חזרה למפתח הציבורי
  if (!supabaseUrl || !supabaseKey) return { status: 500, body: { error: 'Missing Supabase credentials' } }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  let since, until, monthKey
  if (opts.since && opts.until) {
    since = opts.since; until = opts.until; monthKey = `${since}_${until}`
  } else {
    const m = opts.month || currentMonth()
    const [y, mm] = m.split('-').map(Number)
    since = `${y}-${String(mm).padStart(2, '0')}-01`
    until = `${y}-${String(mm).padStart(2, '0')}-${String(new Date(y, mm, 0).getDate()).padStart(2, '0')}`
    monthKey = m
  }

  const { data: projects, error: projectsError } = await supabase.from('projects').select('id, name, client_id')
  if (projectsError) return { status: 500, body: { error: 'Failed to load projects: ' + projectsError.message } }

  const targets = (projects || []).filter(p => fireberryConfigFor(p.name) && (!opts.projectId || p.id === opts.projectId))
  if (targets.length === 0) return { status: 200, body: { ok: false, message: 'No Fireberry project found in Supabase.' } }

  // המשיכה עצמה נעשית פעם אחת לכל הריצה ולא לכל פרויקט: כל הפרויקטים של אלפא יושבים
  // באותו חשבון Fireberry, והסינון הוא מקומי. שני פרויקטים = עדיין שתי בקשות רשת.
  let rawLeads, rawMeetings, truncated = false
  try {
    const [L, M] = await Promise.all([
      queryAll(OBJ.LEAD, { pageSize: 500, maxPages: 20 }),
      queryAll(OBJ.MEETING, { pageSize: 500, maxPages: 10 }),
    ])
    rawLeads = L.rows; rawMeetings = M.rows; truncated = L.truncated || M.truncated
  } catch (err) {
    return { status: 502, body: { error: 'Fireberry fetch failed: ' + String(err?.message || err).slice(0, 300) } }
  }

  const results = []
  for (const proj of targets) {
    const cfg = fireberryConfigFor(proj.name)
    const t0 = Date.now()
    try {
      const leads = filterLeads(rawLeads, cfg)
      const leadIds = new Set(leads.map(l => String(l.accountid || '')))
      const meetings = rawMeetings.filter(m => leadIds.has(String(m?.objectid || '')))

      const R = computeFireberrySummary({ leads, meetings }, { since, until })
      const row = toReportRow(R)

      // תמונת מצב גולמית — ממנה מחושב כל טווח תאריכים בלי לפנות שוב ל-Fireberry.
      let snapshot = null
      if (opts.snapshot !== false) {
        try {
          const [ls, ms] = await Promise.all([
            upsertRawRecords(supabase, proj.id, 'fireberry', 'leads', leads),
            upsertRawRecords(supabase, proj.id, 'fireberry', 'meetings', meetings),
          ])
          snapshot = { leads: ls, meetings: ms }
          try { snapshot.compact = await rebuildCompactIfChanged(supabase, proj.id, 'fireberry', [ls, ms]) }
          catch (e) { snapshot.compact = { error: String(e?.message || e) } }
        } catch (e) { snapshot = { error: String(e?.message || e) } }
      }

      const { error: upsertErr } = await supabase.from('reports').upsert({
        project_id: proj.id,
        source: 'crm',
        month: monthKey,
        data: row.data,
        summary: row.summary,
        file_name: 'Fireberry CRM (live)',
        row_count: row.row_count,
      }, { onConflict: 'project_id,source,month' })
      if (upsertErr) { results.push({ project: proj.name, ok: false, error: upsertErr.message }); continue }

      results.push({
        project: proj.name, ok: true, ms: Date.now() - t0,
        counts: { leads: R.totals.totalLeads, relevant: R.totals.relevantLeads, meetingsScheduled: R.totals.meetingsScheduled, meetingsCompleted: R.totals.meetingsCompleted },
        pool: { leadsInCrm: rawLeads.length, leadsForProject: leads.length, meetingsForProject: meetings.length },
        snapshot,
      })
    } catch (err) {
      results.push({ project: proj.name, ok: false, error: String(err?.message || err).slice(0, 300), ms: Date.now() - t0 })
    }
  }

  // truncated: הגענו לתקרת העמודים. המספרים חלקיים ואסור להציג אותם כאילו הם מלאים.
  return { status: 200, body: { ok: results.every(r => r.ok) && !truncated, month: monthKey, since, until, truncated, projects: results } }
}

export async function POST(request) {
  let body = {}
  try { body = await request.json() } catch {}
  const gate = await requireFetchAccess(request, body.projectId)
  if (!gate.ok) return gate.res
  if ((body.since && !isValidDate(body.since)) || (body.until && !isValidDate(body.until))) {
    return Response.json({ error: 'invalid date format — use YYYY-MM-DD' }, { status: 400 })
  }
  try {
    const { status, body: res } = await runSync({
      month: body.month, since: body.since, until: body.until, projectId: body.projectId,
      snapshot: gate.admin && body.snapshot === false ? false : undefined,
    })
    return Response.json(res, { status })
  } catch (err) {
    return Response.json({ error: 'runSync threw: ' + (err.message || String(err)) }, { status: 500 })
  }
}

export async function GET(request) {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) {
    const { status, body } = await runSync()
    return Response.json(body, { status })
  }
  return Response.json({ ok: true, configured: isConfigured() })
}
