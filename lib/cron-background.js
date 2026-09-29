/**
 * lib/cron-background.js — קרון שעונה מיד וממשיך לעבוד ברקע (B16).
 *
 * הבעיה: cron-job.org מנתק כל בקשה אחרי 30 שניות, בלי קשר ל-requestTimeout שמוגדר
 * במשימה. prefetch-ads, prefetch-crm ו-prefetch-daily רצים 3–4 דקות, ולכן אצלו
 * *כל* ריצה נרשמה כ-timeout (lastStatus 5, בדיוק ~30,000ms) — גם כשהפונקציה ב-Vercel
 * סיימה בהצלחה. התוצאה: כל התראת כשל משם הייתה חסרת ערך, וכשל אמיתי לא היה נבדל.
 *
 * הפתרון: בדיקת ההרשאה רצה מיד; אם עברה — העבודה נרשמת ב-waitUntil של Vercel
 * (מאריך את חיי הפונקציה עד maxDuration של ה-route) והתשובה חוזרת מיד עם 200.
 * כשלים אמיתיים ממשיכים להגיע מהמקומות שכבר מדווחים עליהם: job_log, מייל ההתראה של
 * כל קרון, ושומר הקרונים (heartbeat) ב-/api/cron/health. קריסה של העבודה ברקע, או
 * תשובת 5xx שלה, נרשמות ב-job_log בשם `<job>:background`.
 *
 * `?wait=1` מריץ כמו פעם — ממתין לסיום ומחזיר את התוצאה המלאה. GitHub Actions
 * (vitas-cron.yml, המתזמן הגיבוי) משתמש בזה, כי הוא ממתין עד 10 דקות ובודק את הקוד.
 * ככה אין צורך לשנות שום דבר בהגדרות של cron-job.org.
 */
import { waitUntil } from '@vercel/functions'
import { adminClient } from './auth.js'
import { logJob } from './job-log.js'

const unauthorized = () => Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

/** אותה בדיקה שכל קרון עשה בעצמו: Bearer שווה ל-CRON_SECRET. */
export function cronAuthorized(request) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET
}

/**
 * @param {Request} request
 * @param {string} job שם הקרון, לרישום
 * @param {(request: Request) => Promise<Response>} handler העבודה עצמה (בודקת הרשאה בעצמה גם כן)
 */
export async function runCron(request, job, handler) {
  if (!cronAuthorized(request)) return unauthorized()
  if (new URL(request.url).searchParams.get('wait') === '1') return handler(request)

  const startedAt = Date.now()
  const work = (async () => {
    let failure = null
    try {
      const res = await handler(request)
      if (res.status >= 500) failure = { status: res.status, body: (await res.text().catch(() => '')).slice(0, 300) }
    } catch (err) {
      failure = { error: String(err?.message || err).slice(0, 300) }
    }
    if (failure) {
      console.error(`[${job}] background run failed`, failure)
      try { await logJob(adminClient(), `${job}:background`, false, Date.now() - startedAt, failure) } catch { /* הרישום לא מפיל */ }
    }
  })()
  waitUntil(work)

  return Response.json({ ok: true, accepted: true, job, note: 'running in background — results in job_log; add ?wait=1 to wait for them' })
}
