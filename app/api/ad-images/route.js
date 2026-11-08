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
import { ownedAds, fillAccounts } from '../../../lib/ad-ownership.js'

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
  await fillAccounts(sb, own, allowed)  // החשבון של כל מודעה (לטוקן הנכון)
  const out = {}
  await Promise.all(allowed.map(async id => { const d = await thumbFor(id, accountOf[id]).catch(() => null); if (d) out[id] = d }))
  return J({ images: out })
}
