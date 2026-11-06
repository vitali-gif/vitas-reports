/**
 * GET /api/admin/creative-cross?key=YYYY-MM&projects=id1,id2 — "מה עובד במודעות" על כל הלקוחות יחד
 * (ויטלי, 6.11): 12 החודשים שמסתיימים ב-key, לכל פרויקט ולכולם ביחד, ובכמה פרויקטים כל ממצא חוזר.
 * אדמין בלבד — לקוח לא רואה נתונים של לקוחות אחרים. projects ריק = כל הפרויקטים שאינם הדגמה.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../../../../lib/auth'
import { loadYearRows, loadAdTags, adsFromRows, creativeTests, crossCreative } from '../../../../lib/ad-tags.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'private, max-age=600' } })

export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const url = new URL(req.url)
  const key = url.searchParams.get('key') || new Date().toISOString().slice(0, 7)
  const only = new Set(String(url.searchParams.get('projects') || '').split(',').filter(Boolean))
  const sb = adminClient()
  const { data: projects, error } = await sb.from('projects').select('id, name, is_demo, clients(name)')
  if (error) return J({ error: error.message }, 500)
  const list = (projects || []).filter(p => !p.is_demo && (!only.size || only.has(p.id)))
  const loaded = (await Promise.all(list.map(async p => ({ p, y: await loadYearRows(sb, p.id, key).catch(() => null) })))).filter(x => x.y)
  const allRows = loaded.flatMap(x => x.y.rows)
  const tags = await loadAdTags(sb, allRows)
  const perProject = loaded.map(({ p, y }) => {
    const ads = adsFromRows(y.rows)
    return { id: p.id, name: p.name, client: p.clients?.name || null, ads: ads.filter(a => tags[a.adId]).length, tests: creativeTests(ads, tags), _ads: ads }
  }).filter(x => x.ads > 0)
  const allAds = perProject.flatMap(x => x._ads)
  const { combined, consistency } = crossCreative(perProject, allAds, tags)
  return J({
    key, from: loaded[0]?.y.from || null, to: loaded[0]?.y.to || null,
    projects: perProject.map(({ _ads, ...x }) => x), combined, consistency,
    allProjects: (projects || []).filter(p => !p.is_demo).map(p => ({ id: p.id, name: p.name })),
  })
}
