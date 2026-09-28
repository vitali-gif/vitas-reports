/**
 * /api/cron/fireberry-notes — סנכרון ההערות על לידים מ-Fireberry (אלפא / אקספו חיפה).
 * מההערות מחושבים זמני התגובה ושעות הטיפול (lib/crm/fireberry-summary.js).
 *
 * למה קרון משלו ולא עוד שלב ב-prefetch-daily: Fireberry מגביל ל-100 קריאות לדקה לטוקן,
 * ואנחנו רצים ב-60 כדי להשאיר מקום לאינטגרציות של אלפא עצמם. כל הערה היא קריאה
 * נפרדת, והשליפה הראשונה היא ~1,600 קריאות. ב-prefetch-daily כל קריאה פנימית מוגבלת
 * ל-60 שניות (~45 קריאות), כלומר השליפה הראשונה הייתה נמשכת כיומיים. כאן יש 240 שניות
 * לריצה (~230 קריאות), והשליפה הראשונה נגמרת בכשבע ריצות. אחריה כל ריצה שולפת רק
 * הערות חדשות ונגמרת תוך שניות.
 *
 * העבודה עצמה ב-/api/fireberry/fetch (notesSync) — כאן רק ההפעלה והרישום ל-job_log.
 * מתוזמן מ-.github/workflows/vitas-cron.yml.
 */
import { createClient } from '@supabase/supabase-js'
import { logJob } from '../../../../lib/job-log.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const BUDGET_MS = 240000

export async function GET(request) {
  const startedAt = Date.now()
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://reports.vitas.co.il'
  let data = {}, ok = false, error = null
  try {
    const res = await fetch(`${base}/api/fireberry/fetch`, {
      method: 'POST', cache: 'no-store', next: { revalidate: 0 },
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.CRON_SECRET },
      body: JSON.stringify({ notesSync: true, budgetMs: BUDGET_MS }),
      signal: AbortSignal.timeout(BUDGET_MS + 45000),
    })
    data = await res.json().catch(() => ({}))
    ok = res.ok && data.ok !== false
    if (!res.ok) error = `HTTP ${res.status}`
  } catch (err) {
    error = String(err?.name === 'TimeoutError' ? 'timeout' : (err?.message || err)).slice(0, 200)
  }

  // pending = אין FIREBERRY_TOKEN. מצב תצורה ולא כישלון — לא נרשם, כדי לא להתריע.
  if (!data.pending) {
    try {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      await logJob(sb, 'fireberry-notes', ok, Date.now() - startedAt, { error, projects: data.projects })
    } catch {}
  }
  return Response.json({ ok, error, ...data, elapsedMs: Date.now() - startedAt })
}
