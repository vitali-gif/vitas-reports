/**
 * קישורים טריים ממטא לסרטון / לתמונה של מודעות פייסבוק של פרויקט (ויטלי, 8.11). הקישורים ששמורים בדוח
 * פגים אחרי כ-5 ימים (lib/fb-url.js). משמש את /api/ad-media (הדשבורד) ואת הדוח החודשי (lib/monthly-report.js).
 * רק מודעות שמופיעות בדוחות הפייסבוק של הפרויקט (lib/ad-ownership.js).
 */
import { fetchMetaCreative } from './ad-tags.js'
import { META_GRAPH_VERSION, metaTokenFor } from './ads/meta-api.js'
import { ownedAds, fillAccounts } from './ad-ownership.js'

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`

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

/** { [adId]: { videoUrl, imageUrl, permalink } } — מודעה שלא שייכת לפרויקט או שלא נמצאה חסרה. */
export async function freshAdMedia(sb, projectId, adIds) {
  const ids = [...new Set((adIds || []).map(String).filter(s => /^\d{5,25}$/.test(s)))]
  if (!ids.length) return {}
  const own = await ownedAds(sb, projectId)
  const allowed = ids.filter(id => own.ids.has(id))
  if (!allowed.length) return {}
  await fillAccounts(sb, own, allowed)
  const out = {}
  await Promise.all(allowed.map(async id => { const m = await mediaFor(id, own).catch(() => null); if (m) out[id] = m }))
  return out
}
