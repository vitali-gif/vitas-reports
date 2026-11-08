/**
 * GET /api/ad-media?projectId=…&ids=a,b,c — קישורים טריים ממטא לסרטון / לתמונה של מודעות פייסבוק,
 * לכרטיסי "המודעות הכי מובילות".
 *
 * למה (ויטלי, 8.11: "אני לא רואה שמודעות נטענות" ב-HI PARK, רבעון 3): הקישורים לקבצים ששמורים בדוח
 * (videoUrl / imageUrl מ-fbcdn) פגים אחרי כ-5 ימים, ודוח של תקופה סגורה לא נמשך שוב — אז הסרטון
 * נשאר אפור. הדפדפן מבקש כאן קישור חדש רק למודעה שהקישור שלה פג (או שאין לה קובץ לנגן).
 *
 * הרשאה: requireProjectAccess, ורק מודעות שמופיעות בדוחות הפייסבוק של הפרויקט (lib/ad-ownership.js).
 * עד 10 מודעות בבקשה. מחזיר { media: { [adId]: { videoUrl, imageUrl, permalink } } } — מודעה שלא
 * נמצאה חסרה. הקישורים עצמם תקפים כמה ימים, לכן נשמרים במטמון של שעה לכל instance.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireProjectAccess } from '../../../lib/auth'
import { fetchMetaCreative } from '../../../lib/ad-tags.js'
import { META_GRAPH_VERSION, metaTokenFor } from '../../../lib/ads/meta-api.js'
import { ownedAds, fillAccounts } from '../../../lib/ad-ownership.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'private, max-age=1800' } })

const _cache = new Map()   // adId → { at, v }
const HOUR = 60 * 60 * 1000

async function videoMedia(vid, token) {
  const u = (fields) => `${GRAPH}/${vid}?fields=${fields}&access_token=${encodeURIComponent(token)}`
  // סרטון של עמוד הפייסבוק: Meta לא מוסר את source, וכל הבקשה נכשלת — אז שוב בלי source (פוסטר + קישור)
  let r = await fetch(u('source,permalink_url,picture,thumbnails{uri,width,is_preferred}')).catch(() => null)
  if (!r || !r.ok) r = await fetch(u('permalink_url,picture,thumbnails{uri,width,is_preferred}')).catch(() => null)
  if (!r || !r.ok) return null
  const j = await r.json().catch(() => ({}))
  const th = (j.thumbnails && j.thumbnails.data) || []
  const best = th.find(t => t.is_preferred && t.uri) || [...th].sort((a, b) => (b.width || 0) - (a.width || 0))[0]
  const permalink = j.permalink_url ? (String(j.permalink_url).startsWith('http') ? j.permalink_url : 'https://www.facebook.com' + j.permalink_url) : ''
  return { videoUrl: j.source || '', imageUrl: (best && best.uri) || j.picture || '', permalink }
}

async function mediaFor(adId, own) {
  const hit = _cache.get(adId)
  if (hit && Date.now() - hit.at < HOUR) return hit.v
  const token = metaTokenFor(own.accountOf[adId] || '')
  if (!token) return null
  let v = null
  if (own.videoOf[adId]) v = await videoMedia(own.videoOf[adId], token)
  if (!v || !v.imageUrl) {
    const c = await fetchMetaCreative(GRAPH, adId, token, 800).catch(() => null)
    if (c && (c.imageUrl || c.thumbUrl)) v = { videoUrl: '', permalink: '', ...(v || {}), imageUrl: c.imageUrl || c.thumbUrl }
  }
  if (v) _cache.set(adId, { at: Date.now(), v })
  return v
}

export async function GET(req) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const gate = await requireProjectAccess(req, projectId)
  if (!gate.ok) return gate.res
  const ids = [...new Set(String(url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(s => /^\d{5,25}$/.test(s)))].slice(0, 10)
  if (!ids.length) return J({ media: {} })
  const sb = adminClient()
  const own = await ownedAds(sb, projectId).catch(e => ({ error: e.message }))
  if (own.error) return J({ error: own.error }, 500)
  const allowed = ids.filter(id => own.ids.has(id))
  if (!allowed.length) return J({ media: {} })
  await fillAccounts(sb, own, allowed)
  const out = {}
  await Promise.all(allowed.map(async id => { const m = await mediaFor(id, own).catch(() => null); if (m) out[id] = m }))
  return J({ media: out })
}
