/**
 * /api/cron/prefetch  — daily cron that pre-populates Supabase cache
 * for the current month, previous month, and 2 months ago.
 *
 * Vercel cron calls this with:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * It internally POSTs to each /api/{source}/fetch route using the
 * Supabase anon key (x-client-key), which those routes already accept.
 */

function monthsBack(n) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function GET(request) {
  // Validate cron secret
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (!process.env.CRON_SECRET || bearer !== process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const months = [0, 1, 2].map(monthsBack)   // current, -1, -2
  const sources = ['meta', 'google', 'bmby']

  // Determine base URL: prefer VERCEL_URL env, fall back to localhost
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const results = []

  for (const month of months) {
    for (const source of sources) {
      const url = `${base}/api/${source}/fetch`
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-client-key': anonKey,
          },
          body: JSON.stringify({ month }),
        })
        const data = await res.json().catch(() => ({}))
        results.push({ month, source, status: res.status, ok: res.ok, ...data })
      } catch (err) {
        results.push({ month, source, ok: false, error: String(err) })
      }
    }
  }

  const failed = results.filter(r => !r.ok)
  return Response.json({
    ok: failed.length === 0,
    months,
    total: results.length,
    failed: failed.length,
    results,
  })
}
