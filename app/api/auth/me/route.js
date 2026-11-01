/**
 * GET /api/auth/me — מי מחובר, והאם הוא אדמין.
 *
 * מסך /admin נטען לכל מי שמחובר; הנתונים עצמם מוגנים בשרת (requireAdmin בכל route), אבל לקוח
 * שנכנס לשם ראה מסך ניהול חלקי ומבלבל (1.11: ויטלי פתח בטלפון קישור הזמנה של משתמש צפייה,
 * החיבור הוחלף, ומסך הניהול הראה "(0/0) פרויקטים"). הדף שואל כאן ומעביר לקוח ל-/client.
 */
import { NextResponse } from 'next/server'
import { requireUser, isAdminEmail } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req) {
  const gate = await requireUser(req)
  if (!gate.ok) return gate.res
  const user = gate.user
  const admin = await isAdminEmail(user.email)
  return NextResponse.json({ email: user.email, admin }, { headers: { 'Cache-Control': 'no-store' } })
}
