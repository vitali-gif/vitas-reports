/**
 * /api/ads/daily-sync — מילוי טבלת העובדות היומיות ad_daily (מיגרציה 007).
 * שלב 2 של docs/daily-ranges-plan.md. הליבה ב-lib/ads/daily-sync.js (משותפת לקרון prefetch-daily).
 *
 * POST body: { mode: 'recent' | 'backfill' | 'range', since?, until?, sources? } — ראה lib/ads/daily-sync.js.
 * GET: כיסוי נוכחי (לבדיקה). הרשאה: אדמין או קריאה פנימית (קרון).
 */
import { requireAdmin, adminClient } from '../../../../lib/auth'
import { runDailySync, BACKFILL_SINCE } from '../../../../lib/ads/daily-sync.js'
import { coverage } from '../../../../lib/ads/daily-store.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

export async function POST(request) {
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.res
  let body = {}
  try { body = await request.json() } catch {}
  const { status, body: out } = await runDailySync(adminClient(), { mode: body.mode, sources: body.sources, since: body.since, until: body.until })
  return Response.json(out, { status })
}

export async function GET(request) {
  const gate = await requireAdmin(request)
  if (!gate.ok) return gate.res
  try {
    const cov = await coverage(adminClient())
    return Response.json({ ok: true, floor: BACKFILL_SINCE(), coverage: cov })
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
