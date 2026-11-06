/**
 * GET /api/ad-images?projectId=…&ids=a,b,c — תמונות קטנות (טריות ממטא) של מודעות פייסבוק, לחלון
 * "אילו מודעות בקבוצה" ב"מה עובד במודעות" (app/components/report-ui/CreativeTests.jsx).
 *
 * למה דרך השרת (ויטלי, 6.11: "כל המודעות לא מוצגות"): הקישורים לתמונות ששמורים בדוח פגים אחרי כמה
 * ימים, ולמודעה שכבר לא פעילה אין קישור בכלל. כאן מבקשים ממטא את התמונה של המודעה לפי המזהה,
 * מורידים אותה בשרת ומחזירים data URL — כך גם אין תלות במדיניות הקישורים של פייסבוק בדפדפן.
 *
 * הרשאה: requireProjectAccess, ורק מודעות שמופיעות בדוחות הפייסבוק של הפרויקט (כמו /api/ad-tags).
 * עד 12 מודעות בבקשה. מחזיר { images: { [adId]: 'data:image/...' } } — מודעה שלא נמצאה פשוט חסרה.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireProjectAccess } from '../../../lib/auth'
import { fetchImage } from '../../../lib/ad-tags.js'
import { META_GRAPH_VERSION, metaTokenFor } from '../../../lib/ads/meta-api.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'private, max-age=3600' } })

async function thumbFor(adId, account) {
  const token = metaTokenFor(account || '')
  if (!token) return null
  const u = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adId}?fields=creative{thumbnail_url,image_url}&thumbnail_width=240&thumbnail_height=240&access_token=${encodeURIComponent(token)}`
  const r = await fetch(u).then(x => x.json()).catch(() => null)
  const c = r?.creative
  if (!c) return null
  const img = await fetchImage(c.thumbnail_url, { maxBytes: 600 * 1024 }) || await fetchImage(c.image_url, { maxBytes: 600 * 1024 })
  return img ? `data:${img.media_type};base64,${img.data}` : null
}

export async function GET(req) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const gate = await requireProjectAccess(req, projectId)
  if (!gate.ok) return gate.res
  const ids = [...new Set(String(url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(s => /^\d{5,25}$/.test(s)))].slice(0, 12)
  if (!ids.length) return J({ images: {} })
  const sb = adminClient()
  // רק מודעות של הפרויקט — מהחודשים האחרונים קודם, כדי לא לטעון את כל ההיסטוריה
  const { data: reps, error } = await sb.from('reports').select('data, summary->activeAds').eq('project_id', projectId).eq('source', 'facebook').order('month', { ascending: false }).limit(24)
  if (error) return J({ error: error.message }, 500)
  const own = new Set(), accountOf = {}
  for (const r of reps || []) {
    for (const d of Array.isArray(r.data) ? r.data : []) if (d && d.adId) own.add(String(d.adId))
    for (const a of Array.isArray(r.activeAds) ? r.activeAds : []) if (a && a.id && a.account && !accountOf[a.id]) accountOf[String(a.id)] = String(a.account)
  }
  const allowed = ids.filter(id => own.has(id))
  if (!allowed.length) return J({ images: {} })
  // החשבון של כל מודעה (לטוקן הנכון): מ-activeAds, ואם אין — מ-ad_daily
  const missing = allowed.filter(id => !accountOf[id])
  if (missing.length) {
    const { data: acc } = await sb.from('ad_daily').select('ad_id, account').eq('source', 'facebook').in('ad_id', missing).limit(500)
    for (const x of acc || []) if (!accountOf[x.ad_id]) accountOf[String(x.ad_id)] = String(x.account || '')
  }
  const out = {}
  await Promise.all(allowed.map(async id => { const d = await thumbFor(id, accountOf[id]).catch(() => null); if (d) out[id] = d }))
  return J({ images: out })
}
