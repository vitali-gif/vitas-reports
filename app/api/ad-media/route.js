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
import { freshAdMedia } from '../../../lib/ad-media.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'private, max-age=1800' } })

export async function GET(req) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const gate = await requireProjectAccess(req, projectId)
  if (!gate.ok) return gate.res
  const ids = [...new Set(String(url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(s => /^\d{5,25}$/.test(s)))].slice(0, 10)
  if (!ids.length) return J({ media: {} })
  try {
    return J({ media: await freshAdMedia(adminClient(), projectId, ids) })
  } catch (e) {
    return J({ error: String(e.message || e).slice(0, 200) }, 500)
  }
}
