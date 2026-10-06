// כניסה עם Google דרך Google Identity Services (GIS), ישירות מהדף שלנו.
//
// למה לא signInWithOAuth: בזרימת ה-redirect של Supabase גוגל מציגה ללקוח את הדומיין של ה-callback,
// hemxbbiuwtpuxunxmukd.supabase.co — נראה חשוד (B7b). ב-GIS הכפתור והחלון נפתחים מ-reports.vitas.co.il,
// גוגל מחזירה ID token לדפדפן, ו-supabase.auth.signInWithIdToken מאמת אותו בשרת של Supabase.
//
// דרישות (חד-פעמיות): הדומיין ב-"Authorized JavaScript origins" של ה-OAuth client ב-Google Cloud,
// ו-NEXT_PUBLIC_GOOGLE_CLIENT_ID ב-Vercel — אותו Client ID שמוגדר בספק Google ב-Supabase.

const GIS_SRC = 'https://accounts.google.com/gsi/client'
let loading = null

/** טוען את הסקריפט של גוגל פעם אחת. נדחה אם לא נטען בתוך timeoutMs (חסימת רשת, תוסף פרטיות). */
export function loadGis(timeoutMs = 8000) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.google?.accounts?.id) return Promise.resolve(window.google)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error('GIS load timeout')), timeoutMs)
    function fail(err) { clearTimeout(timer); loading = null; reject(err) }
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.onload = () => {
      clearTimeout(timer)
      if (window.google?.accounts?.id) resolve(window.google)
      else fail(new Error('GIS missing after load'))
    }
    s.onerror = () => fail(new Error('GIS load error'))
    document.head.appendChild(s)
  })
  return loading
}

/**
 * nonce לכל ניסיון כניסה: לגוגל עובר ה-SHA-256 (hex), ול-Supabase הערך הגולמי. Supabase מחשב את
 * ה-hash בעצמו ומשווה ל-nonce שבתוך ה-ID token — כך טוקן שנגנב מדף אחר לא יעבוד כאן.
 */
export async function makeNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const raw = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hashed = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
  return { raw, hashed }
}
