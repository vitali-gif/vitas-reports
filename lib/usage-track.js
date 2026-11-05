/**
 * lib/usage-track.js — מה לקוחות עושים בדשבורד (ויטלי, 6.11; מיגרציה 029).
 *
 * פועל רק בכניסת לקוח (app/client, אחרי שנרשמה כניסה ב-client_sessions): startUsage(sessionId).
 * באדמין לא נקרא startUsage, ולכן track() לא עושה כלום — הצפייה של ויטלי לא נספרת.
 *
 * - track(name, detail): פעולה (טאב, תקופה, סעיף שנצפה, "איך זה עוזר לך?" ...). נאסף בתור ונשלח
 *   בקבוצות כל 15 שניות, וביציאה דרך sendBeacon (flushUsage(token)).
 * - activeSeconds(): זמן פעיל — המסך גלוי והייתה פעולה (גלילה, לחיצה, מקלדת) בשתי הדקות האחרונות.
 *   נשלח עם ה-heartbeat. כך לשונית שנשארה פתוחה כל הלילה לא נספרת כשעות שימוש.
 * - בלי פרטי לידים: רק שם הפעולה ושם הסעיף / הטאב / התקופה. השרת מסנן שוב (app/api/client-log).
 */
import { apiFetch } from './api-fetch'

let sid = null
let ctx = { project: null }
let queue = []
let timer = null
let active = 0
let lastInteract = 0
let ticker = null
let last = ''

const TICK = 15

export function deviceKind() {
  if (typeof window === 'undefined') return null
  const w = Math.min(window.screen?.width || window.innerWidth, window.innerWidth || 9999)
  const touch = (navigator.maxTouchPoints || 0) > 0
  return w < 640 ? 'mobile' : (touch && w < 1100 ? 'tablet' : 'desktop')
}

export function startUsage(sessionId) {
  if (typeof window === 'undefined' || !sessionId || sid === sessionId) return
  sid = sessionId
  lastInteract = Date.now()
  const poke = () => { lastInteract = Date.now() }
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart']) window.addEventListener(ev, poke, { passive: true, capture: true })
  clearInterval(ticker)
  ticker = setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastInteract < 120000) active += TICK
  }, TICK * 1000)
  window.__vitasTrack = track   // לרכיבים שלא מייבאים (SectionHelp)
  // בטלפון היציאה היא בדרך כלל מעבר לאפליקציה אחרת, בלי beforeunload — שולחים כשהמסך מוסתר
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUsage() })
}

export const usageOn = () => !!sid
export const activeSeconds = () => active
export function setUsageContext(c) { ctx = { ...ctx, ...c } }

export function track(name, detail = {}) {
  if (!sid || !name) return
  const key = name + JSON.stringify(detail) + (ctx.project || '')
  if (key === last) return   // אותה פעולה פעמיים ברצף (רינדור כפול) — פעם אחת
  last = key
  queue.push({ name, detail, project: ctx.project, at: new Date().toISOString() })
  if (queue.length >= 30) flushUsage()
  else if (!timer) timer = setTimeout(() => flushUsage(), 15000)
}

export function flushUsage(token) {
  clearTimeout(timer); timer = null
  if (!sid || !queue.length) return
  const items = queue.splice(0, 60)
  const body = { event: 'actions', sessionId: sid, items }
  if (token && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon('/api/client-log', JSON.stringify({ ...body, accessToken: token }))
    return
  }
  apiFetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
}
