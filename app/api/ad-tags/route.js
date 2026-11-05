/**
 * GET /api/ad-tags?projectId=…&ids=a,b,c — סיווגי הקריאייטיב (ad_creative_tags) של מודעות, לבניית
 * "מה עובד במודעות" בדוח (lib/ad-tags.js). רק מודעות שמופיעות בדוחות הפייסבוק של אותו פרויקט —
 * לקוח לא יכול לבקש מודעות של פרויקט אחר דרך ids.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireProjectAccess } from '../../../lib/auth'

export const dynamic = 'force-dynamic'
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })

export async function GET(req) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const gate = await requireProjectAccess(req, projectId)
  if (!gate.ok) return gate.res
  const ids = [...new Set(String(url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(s => /^\d{5,25}$/.test(s)))].slice(0, 500)
  if (!ids.length) return J({ tags: {} })
  const sb = adminClient()
  // רק מודעות שבאמת שייכות לפרויקט: מופיעות ב-data של דוחות הפייסבוק שלו
  const { data: reps, error: rErr } = await sb.from('reports').select('data').eq('project_id', projectId).eq('source', 'facebook')
  if (rErr) return J({ error: rErr.message }, 500)
  const own = new Set()
  for (const r of reps || []) for (const d of Array.isArray(r.data) ? r.data : []) if (d && d.adId) own.add(String(d.adId))
  const allowed = ids.filter(id => own.has(id))
  if (!allowed.length) return J({ tags: {} })
  const { data, error } = await sb.from('ad_creative_tags').select('ad_id, tags, is_video').in('ad_id', allowed)
  if (error) return error.code === '42P01' ? J({ tags: {} }) : J({ error: error.message }, 500)   // לפני מיגרציה 028 — בלי סיווגים
  return J({ tags: Object.fromEntries((data || []).map(x => [x.ad_id, { tags: x.tags, is_video: x.is_video }])) })
}
