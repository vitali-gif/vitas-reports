/**
 * /api/onboarding — קליטת לקוח חדש (lib/onboarding-steps.js, מיגרציה 030). אדמין בלבד.
 *
 * GET              → { projects: [{ id, name, client, created_at, summary, updated_at }] }  — כל הפרויקטים
 * GET ?projectId=… → { project, states: { [step]: {...} }, auto: { users, meta, google, crm, adid, history, login }, detail }
 * POST { projectId, step, status?, owner?, note? } → שומר שלב אחד
 *
 * auto — מה שאפשר לזהות מהנתונים בלי לשאול אף אחד: יש גישות לדשבורד, יש דוחות מטא / גוגל / CRM,
 * מזהה המודעה עובר ל-CRM (80% מלידי פייסבוק ומעלה), יש 3 חודשי נתונים, והלקוח נכנס בעצמו.
 */
import { NextResponse } from 'next/server'
import { requireAdmin, adminClient } from '../../../lib/auth'
import { STEP_KEYS, STATUSES, OWNERS, onboardingSummary } from '../../../lib/onboarding-steps.js'

export const dynamic = 'force-dynamic'
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })
const ym = (d) => d.toISOString().slice(0, 7)
const FB = /face|fb|insta|meta|פייסבוק|אינסטגרם/i

// בדיקות אוטומטיות לכל הפרויקטים בבת אחת
async function autoChecks(sb, projectIds) {
  const out = Object.fromEntries(projectIds.map(id => [id, { users: false, meta: false, google: false, crm: false, adid: false, history: false, login: false }]))
  const detail = Object.fromEntries(projectIds.map(id => [id, {}]))
  if (!projectIds.length) return { out, detail }

  const { data: reps } = await sb.from('reports').select('project_id, source, month').in('project_id', projectIds).limit(20000)
  const months = {}
  for (const r of reps || []) {
    const o = out[r.project_id]; if (!o) continue
    if (r.source === 'facebook') o.meta = true
    if (String(r.source || '').startsWith('google')) o.google = true
    if (r.source === 'crm') o.crm = true
    if (/^\d{4}-\d{2}$/.test(r.month || '')) (months[r.project_id] = months[r.project_id] || new Set()).add(r.month)
  }
  for (const id of projectIds) { const n = months[id]?.size || 0; out[id].history = n >= 3; detail[id].months = n }

  const { data: acc } = await sb.from('client_access').select('project_id, email').in('project_id', projectIds)
  const emailsBy = {}
  for (const a of acc || []) (emailsBy[a.project_id] = emailsBy[a.project_id] || new Set()).add(String(a.email || '').toLowerCase())
  for (const id of projectIds) { out[id].users = (emailsBy[id]?.size || 0) > 0; detail[id].users = emailsBy[id]?.size || 0 }

  const allEmails = [...new Set((acc || []).map(a => String(a.email || '').toLowerCase()).filter(Boolean))]
  if (allEmails.length) {
    const { data: ss } = await sb.from('client_sessions').select('email, project_ids, logged_in_at').in('email', allEmails).order('logged_in_at', { ascending: false }).limit(5000)
    for (const id of projectIds) {
      const em = emailsBy[id]; if (!em) continue
      const hit = (ss || []).find(x => em.has(String(x.email || '').toLowerCase()) && (!Array.isArray(x.project_ids) || !x.project_ids.length || x.project_ids.includes(id)))
      if (hit) { out[id].login = true; detail[id].lastLogin = hit.logged_in_at }
    }
  }

  // מזהה מודעה ב-CRM: מהחודש הזה ומהקודם — חלק לידי הפייסבוק שיש עליהם מזהה מודעה
  const now = new Date(), prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15))
  const { data: crm } = await sb.from('reports').select('project_id, month, ab:summary->adBreakdown').eq('source', 'crm').in('project_id', projectIds).in('month', [ym(now), ym(prev)])
  const fb = {}
  for (const r of crm || []) {
    for (const nd of Array.isArray(r.ab) ? r.ab : []) {
      if (!FB.test(`${nd.source || ''} ${nd.platform || ''}`)) continue
      const f = (fb[r.project_id] = fb[r.project_id] || { withId: 0, all: 0 })
      const l = Number(nd.leads) || 0
      f.all += l
      if (String(nd.adId || '').replace(/[^0-9]/g, '')) f.withId += l
    }
  }
  for (const id of projectIds) {
    const f = fb[id]
    if (f && f.all > 0) { detail[id].adIdPct = Math.round((f.withId / f.all) * 100); out[id].adid = f.withId / f.all >= 0.8 }
  }
  return { out, detail }
}

export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const sb = adminClient()
  const projectId = new URL(req.url).searchParams.get('projectId')

  const pq = sb.from('projects').select('id, name, created_at, is_demo, clients(name)')
  const { data: projects, error } = projectId ? await pq.eq('id', projectId) : await pq.order('created_at', { ascending: false })
  if (error) return J({ error: error.message }, 500)
  const list = (projects || []).filter(p => !p.is_demo)
  const ids = list.map(p => p.id)

  const { data: rows, error: rErr } = ids.length ? await sb.from('project_onboarding').select('*').in('project_id', ids) : { data: [] }
  const ready = !rErr
  const statesBy = {}
  for (const r of rows || []) (statesBy[r.project_id] = statesBy[r.project_id] || {})[r.step] = r
  const { out: auto, detail } = await autoChecks(sb, ids)

  if (projectId) {
    const p = list[0]
    if (!p) return J({ error: 'not found' }, 404)
    return J({ ready, project: { id: p.id, name: p.name, client: p.clients?.name || null }, states: statesBy[p.id] || {}, auto: auto[p.id], detail: detail[p.id] })
  }
  return J({
    ready,
    projects: list.map(p => {
      const st = statesBy[p.id] || {}
      const last = Object.values(st).map(x => x.updated_at).sort().pop() || null
      return { id: p.id, name: p.name, client: p.clients?.name || null, created_at: p.created_at, summary: onboardingSummary(st, auto[p.id]), updated_at: last }
    }),
  })
}

export async function POST(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  if (!b.projectId || !STEP_KEYS.has(b.step)) return J({ error: 'projectId and a known step required' }, 400)
  const row = { project_id: b.projectId, step: b.step, updated_by: gate.user?.email || 'system', updated_at: new Date().toISOString() }
  if (b.status !== undefined) { if (!STATUSES[b.status]) return J({ error: 'bad status' }, 400); row.status = b.status }
  if (b.owner !== undefined) { if (b.owner !== null && !OWNERS[b.owner]) return J({ error: 'bad owner' }, 400); row.owner = b.owner }
  if (b.note !== undefined) row.note = b.note == null ? null : String(b.note).slice(0, 2000)
  const sb = adminClient()
  const { data: cur } = await sb.from('project_onboarding').select('status').eq('project_id', b.projectId).eq('step', b.step).maybeSingle()
  if (!cur && row.status === undefined) row.status = 'todo'
  const { data, error } = await sb.from('project_onboarding').upsert(row, { onConflict: 'project_id,step' }).select('*').single()
  if (error) return J({ error: error.message }, 500)
  return J({ ok: true, row: data })
}
