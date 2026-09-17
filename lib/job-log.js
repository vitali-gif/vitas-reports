/**
 * lib/job-log.js — רישום ריצות של עבודות רקע לטבלת job_log (מיגרציה 008).
 * לעולם לא זורק: כישלון ברישום לא מפיל את העבודה שנרשמה.
 */

/** @param detail אובייקט קטן, בלי PII. נחתך ל-8KB כדי לא לנפח את הטבלה. */
export async function logJob(sb, job, ok, ms, detail) {
  try {
    let d = detail ?? null
    if (d !== null) {
      const txt = JSON.stringify(d)
      if (txt.length > 8000) d = { truncated: true, head: txt.slice(0, 7900) }
    }
    const { error } = await sb.from('job_log').insert({ job, ok: !!ok, ms: Number.isFinite(ms) ? Math.round(ms) : null, detail: d })
    if (error) console.warn('[job-log] insert failed:', error.message)
  } catch (e) {
    console.warn('[job-log] failed:', e?.message || e)
  }
}

/** הריצות האחרונות של עבודה (לחיישני health). */
export async function lastRuns(sb, job, limit = 5) {
  try {
    const { data, error } = await sb.from('job_log').select('ran_at, ok, ms, detail').eq('job', job).order('ran_at', { ascending: false }).limit(limit)
    if (error) return []
    return data || []
  } catch {
    return []
  }
}

/** גיזום: משאיר 30 יום. נקרא מדי פעם מהקרון. */
export async function pruneJobLog(sb, days = 30) {
  try {
    await sb.from('job_log').delete().lt('ran_at', new Date(Date.now() - days * 86400000).toISOString())
  } catch { /* לא קריטי */ }
}
