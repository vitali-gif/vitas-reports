/**
 * GET /api/reports/range?projectId=…&since=YYYY-MM-DD&until=YYYY-MM-DD[&compare=1]
 *
 * שלב 1 של docs/daily-ranges-plan.md: שורת דוח CRM לטווח *כלשהו*, מחושבת מתמונת
 * המצב הגולמית (crm_raw) עם אותה פונקציה שה-route של BMBY מריץ על משיכה חיה
 * (lib/crm/bmby-summary.js). בלי BMBY, בלי המתנה, בלי הגבלת קצב.
 *
 * תשובה: { rows: [שורת crm בצורת reports, עם synthetic:true], missing: ['facebook','google'], snapshot }
 *   מזהה השורה קבוע — range:<project>:crm:<since>_<until> — כי הדשבורד ממזג שורות לפי id.
 *   בשלב 2 יתווספו כאן שורות המודעות, ו-missing יתרוקן.
 *
 * compare=1: השוואה מול הדוח השמור לאותו מפתח (אם קיים) — סכומים בלבד, בלי PII.
 *   מותר גם לטוקן הניטור ('*'), כדי שהסוכן היומי יוכל לאמת שהחישוב מהתמונה זהה
 *   למשיכה החיה. זו "השוואת הזהב" של השלב הזה, רצה בפרודקשן ולא פעם אחת.
 *
 * הרשאות: requireProjectAccess (לקוח על הפרויקט שלו, אדמין, קרון). הרשומות הגולמיות
 * עצמן לעולם לא מוחזרות — רק תוצרי החישוב, אותם שדות שהדשבורד כבר מקבל היום.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireProjectAccess, monitorTokenOf } from '../../../../lib/auth'
import { loadRawRecords } from '../../../../lib/crm/raw-store.js'
import { computeBmbySummary, toReportRow } from '../../../../lib/crm/bmby-summary.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store, max-age=0' } })
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime())
const MAX_SPAN_DAYS = 400

// שדות הסכום שמשווים ב-compare — מספריים בלבד, בלי שמות/טלפונים.
const TOTAL_KEYS = ['totalLeads', 'relevantLeads', 'nonRelevantLeads', 'meetingsScheduled', 'meetingsCompleted', 'meetingsCancelled', 'meetingsUpcoming', 'leadsToHandle', 'registrations', 'registrationValue', 'contracts', 'contractValue']

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const since = searchParams.get('since'), until = searchParams.get('until')
  const compare = searchParams.get('compare') === '1'

  if (!projectId) return J({ error: 'projectId required' }, 400)
  if (!isDate(since) || !isDate(until)) return J({ error: 'since/until must be YYYY-MM-DD' }, 400)
  if (since > until) return J({ error: 'since must be <= until' }, 400)
  const spanDays = Math.round((new Date(until) - new Date(since)) / 86400000) + 1
  if (spanDays > MAX_SPAN_DAYS) return J({ error: `range too long (max ${MAX_SPAN_DAYS} days)` }, 400)

  // הרשאה: גישה לפרויקט. במצב compare מתקבל גם טוקן ניטור (אגרגטים בלבד).
  let gate = await requireProjectAccess(request, projectId)
  if (!gate.ok) {
    const mon = compare ? await monitorTokenOf(request) : null
    if (!mon) return gate.res
    gate = { ok: true, user: null, internal: false, monitor: true }
  }

  const sb = adminClient()
  let raw
  try {
    raw = await loadRawRecords(sb, projectId, 'bmby')
  } catch (e) {
    return J({ error: 'snapshot_load_failed', detail: String(e?.message || e) }, 500)
  }
  if (!raw.total) {
    return J({ error: 'no_snapshot', hint: 'crm_raw has no records for this project yet — the next BMBY cron run fills it' }, 404)
  }

  const key = `${since}_${until}`
  const R = computeBmbySummary(raw, { since, until, monthKey: key })
  const shaped = toReportRow(R)
  const stamp = raw.fetchedAt || new Date().toISOString()
  const snapshot = { fetchedAt: raw.fetchedAt, counts: raw.counts }

  if (compare) {
    const { data: stored } = await sb.from('reports')
      .select('summary, row_count, updated_at, created_at')
      .eq('project_id', projectId).eq('source', 'crm').eq('month', key).maybeSingle()
    const diff = {}
    let differing = 0
    if (stored?.summary) {
      for (const k of TOTAL_KEYS) {
        const a = stored.summary[k] ?? null, b = shaped.summary[k] ?? null
        if (JSON.stringify(a) !== JSON.stringify(b)) { diff[k] = { stored: a, computed: b }; differing++ }
      }
      const a = stored.row_count ?? null, b = shaped.row_count
      if (a !== b) { diff.row_count = { stored: a, computed: b }; differing++ }
    }
    return J({
      key, spanDays, snapshot,
      stored: stored ? { updatedAt: stored.updated_at || stored.created_at, rowCount: stored.row_count } : null,
      computed: Object.fromEntries(TOTAL_KEYS.map(k => [k, shaped.summary[k] ?? null])),
      differing, diff,
      identical: !!stored && differing === 0,
      note: 'stored = last live BMBY fetch for this exact key (if any); computed = same function over the crm_raw snapshot. ' +
            'Expected drift only in live-state fields (leadsToHandle, relevant flags, upcoming meetings) when the snapshot is newer/older than the stored row.',
    })
  }

  const row = {
    id: `range:${projectId}:crm:${key}`,
    project_id: projectId,
    source: 'crm',
    month: key,
    ...shaped,
    file_name: 'BMBY snapshot (computed)',
    created_at: stamp,
    updated_at: stamp,
    synthetic: true,
  }
  return J({ rows: [row], missing: ['facebook', 'google'], snapshot })
}
