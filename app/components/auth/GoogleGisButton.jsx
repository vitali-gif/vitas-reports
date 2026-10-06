'use client'
/**
 * app/components/auth/GoogleGisButton.jsx — הכפתור הרשמי של "המשך עם Google" (Google Identity Services).
 *
 * גוגל מציירת את הכפתור בעצמה (iframe), ולכן החלון שנפתח שייך ל-reports.vitas.co.il ולא לדומיין
 * של Supabase. ההסבר המלא ב-lib/google-gis.js.
 *
 * onCredential(idToken, rawNonce) — אחרי שהמשתמש בחר חשבון. onUnavailable() — הסקריפט של גוגל לא
 * נטען (רשת, חוסם פרסומות); הדף חוזר אז לכפתור הישן של Supabase, כדי שתמיד תהיה דרך להיכנס.
 */
import { useEffect, useRef } from 'react'
import { loadGis, makeNonce } from '../../../lib/google-gis'

export default function GoogleGisButton({ clientId, onCredential, onUnavailable, disabled }) {
  const boxRef = useRef(null)
  // ה-callback של גוגל נקבע פעם אחת ב-initialize; ה-refs שומרים עליו מעודכן בלי לאתחל מחדש.
  const cbRef = useRef(onCredential)
  const failRef = useRef(onUnavailable)
  cbRef.current = onCredential
  failRef.current = onUnavailable

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [google, nonce] = await Promise.all([loadGis(), makeNonce()])
        if (cancelled || !boxRef.current) return
        google.accounts.id.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          context: 'signin',
          ux_mode: 'popup',
          auto_select: false,
          itp_support: true,
          use_fedcm_for_button: true,
          callback: (resp) => {
            if (resp?.credential) cbRef.current(resp.credential, nonce.raw)
          },
        })
        // רוחב הכפתור של גוגל בפיקסלים, 200–400. ממלאים את הכרטיס כמו כפתור Microsoft שמתחתיו.
        const width = Math.max(200, Math.min(400, Math.floor(boxRef.current.offsetWidth || 360)))
        google.accounts.id.renderButton(boxRef.current, {
          type: 'standard', theme: 'outline', size: 'large', text: 'continue_with',
          shape: 'rectangular', logo_alignment: 'center', locale: 'he', width,
        })
      } catch {
        if (!cancelled) failRef.current?.()
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  return (
    <div
      ref={boxRef}
      className="vsign-gis"
      aria-busy={disabled ? 'true' : undefined}
      style={disabled ? { opacity: .55, pointerEvents: 'none' } : undefined}
    />
  )
}
