/**
 * GET /api/ad-tags/year?projectId=…&key=… — "מה עבד ב-12 החודשים האחרונים" לפרויקט (lib/ad-tags.js,
 * loadYearCreativeTests), לייצוא הדוח ולניתוח מהדשבורד. key = התקופה שעל המסך; השנה מסתיימת בחודש שלה.
 * הרשאה: requireProjectAccess. החישוב בשרת — הדפדפן לא טוען 12 חודשי נתונים.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireProjectAccess } from '../../../../lib/auth'
import { loadYearCreativeTests } from '../../../../lib/ad-tags.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'private, max-age=600' } })

export async function GET(req) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId')
  const gate = await requireProjectAccess(req, projectId)
  if (!gate.ok) return gate.res
  try {
    return J({ year: await loadYearCreativeTests(adminClient(), projectId, url.searchParams.get('key') || new Date().toISOString().slice(0, 7)) })
  } catch (e) {
    return J({ year: null, error: String(e?.message || e).slice(0, 200) })
  }
}
