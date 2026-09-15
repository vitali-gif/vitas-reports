/**
 * lib/rate-limit.js — הגבלת קצב לנקודות קצה רגישות.
 *
 * למה בבסיס הנתונים ולא בזיכרון: על Vercel כל בקשה עשויה לנחות במופע אחר,
 * ומונה בזיכרון נספר מחדש בכל מופע. תוקף שמסובב בקשות פשוט עוקף אותו.
 * טבלה משותפת סופרת נכון בלי קשר למי טיפל בבקשה.
 *
 * fail-open בכוונה: אם הטבלה חסרה או השאילתה נכשלת, הבקשה עוברת ונרשמת
 * אזהרה. הגבלת קצב שנופלת ונועלת את כל הלקוחות בחוץ גרועה מהבעיה שהיא פותרת.
 * המיגרציה: scripts/migrations/002_rate_limits.sql
 */
import { adminClient } from './auth'

/**
 * @param {string} bucket  שם הפעולה, למשל 'client-auth'
 * @param {string} key     המזהה שנספר — מייל, IP וכו'
 * @param {number} limit   כמה פעולות מותרות בחלון
 * @param {number} windowSec  אורך החלון בשניות
 * @returns {Promise<{ok: boolean, retryAfterSec?: number}>}
 */
export async function rateLimit(bucket, key, limit, windowSec) {
  if (!key) return { ok: true }
  const id = `${bucket}:${String(key).toLowerCase().trim()}`.slice(0, 200)
  const windowStart = new Date(Date.now() - windowSec * 1000).toISOString()

  try {
    const sb = adminClient()

    const { data: row, error } = await sb
      .from('rate_limits')
      .select('hits, window_started_at')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.warn(`[rate-limit] בדיקה נכשלה עבור ${bucket} — מעביר את הבקשה:`, error.message)
      return { ok: true }
    }

    // אין שורה, או שהחלון הקודם פג — מתחילים חלון חדש.
    if (!row || row.window_started_at < windowStart) {
      await sb.from('rate_limits').upsert({
        id, hits: 1, window_started_at: new Date().toISOString(),
      })
      return { ok: true }
    }

    if (row.hits >= limit) {
      const elapsed = (Date.now() - new Date(row.window_started_at).getTime()) / 1000
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(windowSec - elapsed)) }
    }

    await sb.from('rate_limits').update({ hits: row.hits + 1 }).eq('id', id)
    return { ok: true }
  } catch (e) {
    console.warn(`[rate-limit] שגיאה בבדיקה עבור ${bucket} — מעביר את הבקשה:`, e?.message || e)
    return { ok: true }
  }
}

/** תשובת 429 סטנדרטית. */
export function tooManyRequests(retryAfterSec = 60) {
  return Response.json(
    { error: 'יותר מדי בקשות. נסה שוב בעוד כדקה.', retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec), 'Cache-Control': 'no-store' } },
  )
}
