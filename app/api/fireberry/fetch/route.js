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
import { OBJ, queryAll, isConfigured, listLeadNoteIds, getNote, pool } from '../../../../lib/crm/fireberry-api.js'
import { computeFireberrySummary, toReportRow, filterLeads, fireberryConfigFor } from '../../../../lib/crm/fireberry-summary.js'
import { upsertRawRecords, rebuildCompactIfChanged, loadRawRecords } from '../../../../lib/crm/raw-store.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

function currentMonth() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}
const isValidDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * סנכרון הערות מצטבר, לפרויקט אחד. רץ מ-prefetch-daily ולא מכל חלון של prefetch-crm:
 * הוא יקר (קריאה לכל הערה — ראה lib/crm/fireberry-api.js), וחלונות הטווחים רצים
 * עשרה במקביל.
 *
 * אילו לידים נבדקים:
 *   • ליד שמעולם לא נבדק — תמיד. זו השליפה הראשונה (~1,200 הערות לאקספו), שנפרשת
 *     על כמה ריצות לפי budgetMs. החדשים ביותר קודם, כי זמני התגובה שלהם הכי רלוונטיים.
 *   • ליד מ-windowDays האחרונים שנבדק לפני יותר מ-50 דקות — אצלו עוד נכתבות הערות.
 * ליד ישן שכבר נבדק לא נבדק שוב. הערה חדשה עליו תיכנס רק אם הוא בחלון; זה המחיר
 * של לא לעבור על כל הלידים בכל שעה, ולזמני תגובה הוא לא משנה — שם קובעת ההערה
 * הראשונה.
 *
 * ליד נרשם ב-note_index רק אם *כל* ההערות שלו נשלפו. ליד שחלק מההערות שלו נכשלו
 * (או שהתקציב נגמר באמצע) לא נרשם, ולכן ייבדק שוב בריצה הבאה.
 */
// windowDays=7 ו-recheck של 6 שעות: בקצב של 60 קריאות לדקה (lib/crm/fireberry-api.js)
// כל ריצה עושה ~45 קריאות. בדיקה חוזרת של לידי 45 הימים האחרונים כל שעה הייתה
// ~270 קריאות לשעה רק על רשימות, בלי לשלוף אף הערה חדשה.
async function syncNotes(supabase, proj, leads, { budgetMs = 45000, windowDays = 7, recheckHours = 6, concurrency = 2 } = {}) {
  const t0 = Date.now()
  const deadline = t0 + budgetMs
  const stop = () => Date.now() > deadline
  const snap = await loadRawRecords(supabase, proj.id, 'fireberry')
  const known = new Set((snap.entities?.notes || []).map(n => String(n.noteid)))
  const index = new Map((snap.entities?.note_index || []).map(r => [String(r.accountid), r]))
  const cutoff = Date.now() - windowDays * 86400000
  const ts = (s) => new Date(String(s || '').replace(' ', 'T')).getTime()

  const todo = leads.filter(l => {
    const id = String(l.accountid || '')
    if (!id) return false
    const ix = index.get(id)
    if (!ix) return true
    return ts(l.createdon) >= cutoff && (Date.now() - ts(ix.checkedAt)) > recheckHours * 3600000
  }).sort((a, b) =>
    (index.has(String(a.accountid)) - index.has(String(b.accountid))) ||
    String(b.createdon).localeCompare(String(a.createdon)))

  // רשימות והערות מתחלפות ליד-ליד ולא "כל הרשימות ואז כל ההערות": אחרת ריצה
  // שנגמר לה התקציב אחרי הרשימות לא הייתה משלימה אף ליד, ואף ליד לא היה נרשם.
  const listed = [], fetched = []
  let rateLimited = false
  for (const l of todo) {
    if (stop() || rateLimited) break
    const [lr] = await pool([l], 1, async (x) => ({ id: String(x.accountid), ids: await listLeadNoteIds(x.accountid) }))
    listed.push(lr)
    if (!lr?.ok) { if (/429/.test(lr?.error || '')) rateLimited = true; continue }
    const fresh = lr.value.ids.filter(id => !known.has(id))
    const fr = await pool(fresh, concurrency, (id) => getNote(id), stop)
    fetched.push(...fr.filter(Boolean))
    if (fr.rateLimited) rateLimited = true
  }
  const done = listed.filter(x => x?.ok).map(x => x.value)
  const notes = fetched.filter(x => x?.ok).map(x => x.value)

  const nowKnown = new Set([...known, ...notes.map(n => n.noteid)])
  const checkedAt = new Date().toISOString()
  const indexRows = done.filter(d => d.ids.every(id => nowKnown.has(id)))
    .map(d => ({ accountid: d.id, noteCount: d.ids.length, checkedAt }))

  const [nu, iu] = await Promise.all([
    notes.length ? upsertRawRecords(supabase, proj.id, 'fireberry', 'notes', notes) : { count: 0, changed: false },
    indexRows.length ? upsertRawRecords(supabase, proj.id, 'fireberry', 'note_index', indexRows) : { count: 0, changed: false },
  ])
  let compact = null
  if (nu.changed || iu.changed) {
    try { compact = await rebuildCompactIfChanged(supabase, proj.id, 'fireberry', [nu, iu]) }
    catch (e) { compact = { error: String(e?.message || e) } }
  }
  const indexedNow = new Set([...index.keys(), ...indexRows.map(r => r.accountid)])
  const firstErr = [...listed, ...fetched].find(x => x && !x.ok)?.error || null
  return {
    project: proj.name, ok: true, ms: Date.now() - t0,
    leadsToCheck: todo.length, leadsListed: done.length,
    newNotes: notes.length, notesKnown: nowKnown.size, indexed: indexRows.length,
    remainingNeverChecked: leads.filter(l => !indexedNow.has(String(l.accountid))).length,
    budgetHit: stop(), rateLimited, firstError: firstErr, compact,
  }
}

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

  // ── מצב סנכרון הערות (prefetch-daily): לא כותב דוחות, רק ממלא את crm_raw ──────
  if (opts.notesSync) {
    const perProjectBudget = Math.max(10000, Math.floor((Number(opts.budgetMs) || 45000) / targets.length))
    const out = []
    for (const proj of targets) {
      try { out.push(await syncNotes(supabase, proj, filterLeads(rawLeads, fireberryConfigFor(proj.name)), { budgetMs: perProjectBudget })) }
      catch (err) { out.push({ project: proj.name, ok: false, error: String(err?.message || err).slice(0, 300) }) }
    }
    return { status: 200, body: { ok: out.every(r => r.ok), mode: 'notes', projects: out } }
  }

  // ההערות השמורות — מהן זמני התגובה. נקראות מ-crm_raw ולא מ-Fireberry: השליפה שלהן
  // יקרה ורצה בנפרד (syncNotes), וכל חלון של הקרון רק קורא את מה שכבר נאסף.
  const loadNotes = async (projectId) => {
    const out = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('crm_raw').select('payload')
        .eq('project_id', projectId).eq('crm_type', 'fireberry').eq('entity', 'notes')
        .order('ext_id').range(from, from + 999)
      if (error) throw new Error('notes load: ' + error.message)
      for (const r of (data || [])) out.push(r.payload)
      if (!data || data.length < 1000) return out
    }
  }

  const results = []
  for (const proj of targets) {
    const cfg = fireberryConfigFor(proj.name)
    const t0 = Date.now()
    try {
      const leads = filterLeads(rawLeads, cfg)
      const leadIds = new Set(leads.map(l => String(l.accountid || '')))
      const meetings = rawMeetings.filter(m => leadIds.has(String(m?.objectid || '')))
      // כישלון בטעינת ההערות לא מפיל את הדוח — הוא רק משאיר את זמני התגובה ריקים.
      const notes = await loadNotes(proj.id).catch(() => [])

      const R = computeFireberrySummary({ leads, meetings, notes }, { since, until })
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
        pool: { leadsInCrm: rawLeads.length, leadsForProject: leads.length, meetingsForProject: meetings.length, notesStored: notes.length },
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
      // סנכרון ההערות יקר (מאות קריאות) — אדמין וקרון בלבד, לא לקוח.
      notesSync: gate.admin && body.notesSync === true,
      budgetMs: gate.admin ? Math.min(Number(body.budgetMs) || 45000, 240000) : undefined,
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
