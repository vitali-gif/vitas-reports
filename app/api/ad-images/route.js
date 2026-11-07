/**
 * GET /api/ad-images?projectId=…&ids=a,b,c — תמונות קטנות (טריות ממטא) של מודעות פייסבוק, לחלון
 * "אילו מודעות בקבוצה" ב"מה עובד במודעות" (app/components/report-ui/CreativeTests.jsx).
 *
 * למה דרך השרת (ויטלי, 6.11: "כל המודעות לא מוצגות"): הקישורים לתמונות ששמורים בדוח פגים אחרי כמה
 * ימים, ולמודעה שכבר לא פעילה אין קישור בכלל. כאן מבקשים ממטא את התמונה של המודעה לפי המזהה,
 * מורידים אותה בשרת ומחזירים data URL — כך גם אין תלות במדיניות הקישורים של פייסבוק בדפדפן.
 *
 * הרשאה: requireProjectAccess, ורק מודעות שמופיעות בדוחות הפייסבוק של הפרויקט ב-13 החודשים האחרונים.
 * עד 12 מודעות בבקשה. מחזיר { images: { [adId]: 'data:image/...' } } — מודעה שלא נמצאה פשוט חסרה.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireProjectAccess } from '../../../lib/auth'
import { fetchImage, fetchMetaCreative } from '../../../lib/ad-tags.js'
import { META_GRAPH_VERSION, metaTokenFor } from '../../../lib/ads/meta-api.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'private, max-age=3600' } })

async function thumbFor(adId, account) {
  const token = metaTokenFor(account || '')
  if (!token) return null
  const c = await fetchMetaCreative(`https://graph.facebook.com/${META_GRAPH_VERSION}`, adId, token, 320).catch(() => null)
  if (!c) return null
  // לתצוגה: התמונה הממוזערת (320) קודם — התמונה המקורית יכולה לעבור את 600KB
  const img = await fetchImage(c.thumbUrl, { maxBytes: 600 * 1024 }) || await fetchImage(c.imageUrl, { maxBytes: 600 * 1024 })
  return img ? `data:${img.media_type};base64,${img.data}` : null
}

// המודעות של הפרויקט (מזהה → חשבון), במטמון של 10 דקות לכל instance: חלון אחד טוען 12 תמונות בכל
// בקשה, ודוחות הפייסבוק של שנה שלמה הם עד ~11MB (KLOSS) — לא לקרוא אותם שוב בכל בקשה.
const _own = new Map()
async function ownedAds(sb, projectId) {
  const hit = _own.get(projectId)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit
  // עד 6.11: 24 הדוחות האחרונים — אבל רובם טווחים יומיים ושבועיים של החודשיים האחרונים, ולכן מודעות
  // מ"12 החודשים האחרונים" נפסלו ולא הוצגו (ויטלי: "אני לא רואה את רוב המודעות"). עכשיו: חודשים
  // ('2026-05') וטווחים שמתחילים ב-1 לחודש (חודש מלא, רבעון), 13 חודשים אחורה.
  const now = new Date()
  const since = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
  const { data: reps, error } = await sb.from('reports').select('data, summary->activeAds').eq('project_id', projectId).eq('source', 'facebook')
    .gte('month', since).or('month.like.____-__,month.like.____-__-01_*').limit(80)
  if (error) throw new Error(error.message)
  const ids = new Set(), accountOf = {}
  for (const r of reps || []) {
    for (const d of Array.isArray(r.data) ? r.data : []) if (d && d.adId) { ids.add(String(d.adId)); if (d.account && !accountOf[d.adId]) accountOf[String(d.adId)] = String(d.account) }
    for (const a of Array.isArray(r.activeAds) ? r.activeAds : []) if (a && a.id && a.account && !accountOf[a.id]) accountOf[String(a.id)] = String(a.account)
  }
  const out = { ids, accountOf, at: Date.now() }
  _own.set(projectId, out)
  return out
}

export async function GET(req) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const gate = await requireProjectAccess(req, projectId)
  if (!gate.ok) return gate.res
  const ids = [...new Set(String(url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(s => /^\d{5,25}$/.test(s)))].slice(0, 12)
  if (!ids.length) return J({ images: {} })
  const sb = adminClient()
  const own = await ownedAds(sb, projectId).catch(e => ({ error: e.message }))
  if (own.error) return J({ error: own.error }, 500)
  const accountOf = own.accountOf
  const allowed = ids.filter(id => own.ids.has(id))
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
