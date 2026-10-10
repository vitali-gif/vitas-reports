'use client'
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { apiFetch, accessToken } from '../../lib/api-fetch'
import dynamic from 'next/dynamic'
import { GoogleMark, MicrosoftMark } from '../components/auth/ProviderMarks'
import GoogleGisButton from '../components/auth/GoogleGisButton'
import BrandLoader from '../components/BrandLoader'

const AdminPage = dynamic(() => import('../admin/page'), { ssr: false })

// אילו ספקי OAuth באמת מוגדרים ב-Supabase Auth. ריק = לא מוצג כלום, וזו ברירת המחדל:
// כפתור "המשך עם Google" בלי ספק מוגדר נכשל בלחיצה, וזו בדיוק ההבטחה שאסור לתת.
// הערכים הם שמות הספקים של supabase-js: 'google', 'azure' (זה שמו של Microsoft שם).
const OAUTH_PROVIDERS = (process.env.NEXT_PUBLIC_OAUTH_PROVIDERS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
// כש-NEXT_PUBLIC_GOOGLE_CLIENT_ID מוגדר, Google עובר דרך GIS ומסך ההסכמה מציג את reports.vitas.co.il
// במקום הדומיין של Supabase (B7b, lib/google-gis.js). ריק = הכפתור הישן, דרך Supabase.
const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim()

// ═══════════════════════════════════════════════════════════════════════════
// ClientPage — handles magic-link auth, then renders AdminPage (client view)
// ═══════════════════════════════════════════════════════════════════════════
// Build clients[] shape for AdminPage from accessList (from /api/client-access)
function buildClients(accessList) {
  const map = new Map();
  for (const a of accessList) {
    const cName  = a.projects?.clients?.name  || 'לקוח';
    const cColor = a.projects?.clients?.color || '#315CF5';
    const cId    = a.projects?.client_id;
    // plan — מנוי הלקוח (מיגרציה 020). משמש לתגית PRO ולמסך השדרוג בלבד; האכיפה
    // היא בשרת. ערך חסר = basic, כמו בשרת.
    const cPlan  = a.projects?.clients?.plan === 'pro' ? 'pro' : 'basic';
    if (!map.has(cName)) map.set(cName, { id: cId, name: cName, color: cColor, plan: cPlan, projects: [] });
    map.get(cName).projects.push({ id: a.project_id, name: a.projects?.name, is_demo: !!a.projects?.is_demo });
  }
  return Array.from(map.values());
}

export default function ClientPage() {
  const [step, setStep]             = useState('login')
  const [emailInput, setEmailInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [loading, setLoading]       = useState(true)
  const [toast, setToast]           = useState('')
  const [loginError, setLoginError] = useState('')
  // ?setpw=1 — הגעה מקישור כניסה (הזמנה / "שכחתי סיסמה"): אחרי שהסשן נוצר מציעים לבחור סיסמה.
  const wantsSetPw = useRef(typeof window !== 'undefined' && /[?&]setpw=1/.test(window.location.search))
  const pendingEmailRef = useRef(null)
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [linkSending, setLinkSending] = useState(false)   // נשאר על המסך עד שמתקנים, בניגוד ל-toast שנעלם אחרי 3 שניות
  const [accessList, setAccessList] = useState([])
  const [accessInfo, setAccessInfo] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [installPrompt, setInstallPrompt] = useState(null)
  // טופס הסיסמה מוסתר כברירת מחדל כשיש ספקי OAuth, ונפתח בלחיצה על "כניסה עם סיסמה".
  const [showPwForm, setShowPwForm] = useState(OAUTH_PROVIDERS.length === 0)
  const [oauthBusy, setOauthBusy] = useState('')
  // הכפתור של גוגל (GIS) לא נטען או שהטוקן נדחה — חוזרים לכפתור הישן, שתמיד עובד.
  const [gisFailed, setGisFailed] = useState(false)
  const [initialProjectId, setInitialProjectId] = useState(null)
  const sessionStartRef = useRef(Date.now())
  const sessionStart = sessionStartRef.current

  // ── PWA: register service worker + capture install prompt ──────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__vitasHydrated = true;   // הסקריפט ה-inline במסך הטעינה בודק את זה אחרי 15 שניות
    // Register SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    // Capture native install prompt
    const handleInstall = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handleInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleInstall);
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // ── Heartbeat + logout tracking (must be before any return) ─────────────────
  useEffect(() => {
    if (!sessionId) return
    const start = sessionStart
    // הטוקן נשמר כאן כי sendBeacon (למטה) חייב לרוץ סינכרונית ולא יכול להמתין
    // ל-getSession. מתרענן בכל פעימה כדי שלא יפוג במהלך סשן ארוך.
    let token = null
    accessToken().then(t => { token = t })
    const hb = setInterval(() => {
      accessToken().then(t => { token = t })
      apiFetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'heartbeat', sessionId })
      }).catch(() => {})
    }, 60000)
    const handleUnload = () => {
      const dur = Math.round((Date.now() - start) / 1000)
      // sendBeacon לא יכול לשאת כותרות — השרת מקבל את הטוקן מגוף הבקשה.
      navigator.sendBeacon('/api/client-log',
        JSON.stringify({ event: 'logout', sessionId, durationSec: dur, accessToken: token }))
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => { clearInterval(hb); window.removeEventListener('beforeunload', handleUnload) }
  }, [sessionId]) // eslint-disable-line

  // ── חזרה מספק OAuth עם שגיאה ─────────────────────────────────────────────
  // כש-Supabase נכשל ב-callback הוא מחזיר ל-/client עם ?error=…&error_description=… (או ב-hash).
  // עד 6.10 זה נבלע: הלקוח חזר למסך הכניסה בלי שום הסבר, וחשב שהכפתור "לא עושה כלום".
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const desc = params.get('error_description') || hash.get('error_description')
    if (!desc && !params.get('error') && !hash.get('error')) return
    const noEmail = /email/i.test(desc || '')
    setLoginError(noEmail
      ? 'החשבון לא מסר כתובת מייל, ולכן לא ניתן לזהות אותך. אפשר להיכנס עם מייל וסיסמה, או לפנות ל-VITAS.'
      : 'הכניסה דרך Google / Microsoft לא הושלמה. נסה שוב, או היכנס עם מייל וסיסמה.')
    setShowPwForm(true)
    try { window.history.replaceState(null, '', window.location.pathname) } catch {}
  }, [])

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let handled = false

    const finish = (email) => {
      if (handled) return
      handled = true
      if (email) handleSessionReady(email)
      else setLoading(false)
    }

    // Step 2: onAuthStateChange
    // 🔴 18.9: הקריאה ל-finish רצה *בתוך* ה-callback, ו-handleSessionReady קורא ל-supabase.auth.getSession()
    // (דרך apiFetch). ב-supabase-js 2.x ה-callback רץ בזמן שנעילת ה-Auth תפוסה, ו-getSession מחכה לאותה
    // נעילה — deadlock: הספינר "טוען..." לנצח, בלי שגיאה. קרה ברענון העמוד באפליקציה (אחרי מעבר
    // בין לקוחות), כשהאירוע SIGNED_IN הקדים את getSession של שלב 3. הפתרון המתועד: לצאת מה-callback
    // עם setTimeout לפני כל קריאה נוספת לספרייה.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.email) {
        const email = session.user.email
        setTimeout(() => finish(email), 0)
      }
      // התנתקות מכל מקור (הכפתור, לשונית אחרת, טוקן שבוטל) מחזירה למסך הכניסה. עד 23.9 האירוע
      // נבלע, והדשבורד נשאר על המסך אחרי שהחיבור כבר נסגר. רק setState — בלי קריאה לספרייה
      // מתוך ה-callback, מאותה סיבה של ה-deadlock שמתואר למעלה.
      if (event === 'SIGNED_OUT') {
        setStep('login')
        setAccessInfo(null)
        setAccessList([])
      }
    })

    // Step 3a: קישור כניסה במייל/וואטסאפ — ?th=<hashed_token> על הדומיין שלנו (lib/login-link.js).
    // מאמתים את הקוד כאן במקום שהלקוח יעבור דרך הכתובת של Supabase. הפרמטר נמחק מה-URL מיד,
    // כדי שרענון או שיתוף צילום מסך לא יחשפו אותו (הוא חד-פעמי בכל מקרה).
    const th = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('th') : null
    if (th) {
      try { window.history.replaceState(null, '', window.location.pathname + (wantsSetPw.current ? '?setpw=1' : '')) } catch {}
      supabase.auth.verifyOtp({ token_hash: th, type: 'magiclink' })
        .then(({ data, error }) => {
          if (error) {
            wantsSetPw.current = false
            setLoginError('קישור הכניסה כבר נוצל או שפג תוקפו. אפשר לבקש קישור חדש או להיכנס עם סיסמה.')
            setShowPwForm(true)
            finish(null)
          } else {
            finish(data?.session?.user?.email || data?.user?.email || null)
          }
        })
        .catch(() => finish(null))
    } else {
      // Step 3b: existing session
      supabase.auth.getSession()
        .then(({ data: { session } }) => finish(session?.user?.email || null))
        .catch(() => finish(null))
    }

    // Step 4: safety timeout — ארוך יותר כשמאמתים קישור, כדי לא לחתוך אימות איטי באמצע.
    const safetyTimer = setTimeout(() => finish(null), th ? 15000 : 6000)

    return () => { subscription.unsubscribe(); clearTimeout(safetyTimer) }
  }, [])

  const handleSessionReady = async (userEmail) => {
    if (wantsSetPw.current) {
      // פעם אחת: מסך "בחר סיסמה". הפרמטר נמחק מה-URL כדי שרענון לא יחזיר לכאן.
      wantsSetPw.current = false
      pendingEmailRef.current = userEmail
      try { window.history.replaceState(null, '', window.location.pathname) } catch {}
      setLoading(false)
      setStep('setpw')
      return
    }
    setLoading(true)
    try {
      // תקרת זמן: מסך "טוען..." בלי סוף הוא הכשל הגרוע ביותר מבחינת הלקוח (אין מה ללחוץ).
      // אם משהו נתקע (רשת, נעילת Auth) — חוזרים למסך הכניסה עם הסבר במקום ספינר נצחי.
      const res = await apiFetch(`/api/client-access?email=${encodeURIComponent(userEmail)}`, {
        headers: {}, signal: AbortSignal.timeout(20000),
      })
      // 401 כאן (אחרי שה-apiFetch כבר ניסה לרענן) = ההתחברות באמת פגה, לא "אין גישה".
      // מחזירים למסך הכניסה עם הסבר, במקום מסך מנעול שמרמז שהגישה בוטלה.
      if (res.status === 401) {
        await supabase.auth.signOut().catch(() => {})
        setStep('login')
        showToast('החיבור פג תוקף — התחבר שוב')
        return
      }
      if (!res.ok) { setStep('error'); return }
      const list = await res.json()
      if (!Array.isArray(list) || list.length === 0) { setStep('error'); return }
      setAccessList(list)
      if (list.length === 1) {
        setAccessInfo(list[0])
        setStep('dashboard')
      } else {
        setStep('picker')
      }
      // Log session start
      apiFetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'login',
          email: userEmail,
          clientName: list[0]?.projects?.clients?.name || '',
          projectIds: list.map(a => a.project_id),
        })
      }).then(r => r.json()).then(d => { if (d.sessionId) { setSessionId(d.sessionId); if (typeof window !== 'undefined') window.__vitasSessionId = d.sessionId } }).catch(() => {})

      // האונבורדינג מוצג פעם אחת בלבד. קודם הוא חזר עשר פעמים והציג ספירה
      // לאחור ("ההודעה תופיע עוד N פעמים") — מודאל חוסם שחוזר מתפרש כתקלה,
      // לא כעזרה. מי שרוצה לראות אותו שוב לוחץ על כפתור העזרה הקבוע.
      if (typeof window !== 'undefined') {
        try {
          if (!localStorage.getItem('vitas_onboarding_seen')) setShowOnboarding(true)
        } catch { /* דפדפן שחוסם אחסון — פשוט לא מציגים */ }
      }
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        setStep('login')
        showToast('הטעינה נתקעה — נסה להיכנס שוב')
      } else {
        setStep('error')
      }
    } finally {
      setLoading(false)
    }
  }

  const saveNewPassword = async () => {
    setLoginError('')
    if (newPw.length < 8) { setLoginError('הסיסמה צריכה להיות באורך 8 תווים לפחות.'); return }
    if (newPw !== newPw2) { setLoginError('שתי הסיסמאות לא זהות.'); return }
    setPwSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw })
      if (error) { setLoginError('לא הצלחנו לשמור את הסיסמה: ' + error.message); return }
      setNewPw(''); setNewPw2('')
      showToast('✓ הסיסמה נשמרה')
      await handleSessionReady(pendingEmailRef.current)
    } finally { setPwSaving(false) }
  }
  const skipNewPassword = async () => { setLoginError(''); await handleSessionReady(pendingEmailRef.current) }

  // "שלחו לי קישור כניסה" — מחליף "שכחתי סיסמה": קישור חד-פעמי במייל שמוביל למסך בחירת סיסמה.
  const requestLoginLink = async () => {
    const em = emailInput.trim().toLowerCase()
    if (!em) { setLoginError('הכנס את כתובת המייל ואז לחץ "שלחו לי קישור כניסה".'); return }
    setLinkSending(true); setLoginError('')
    try {
      const res = await fetch('/api/client-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em }) })
      const d = await res.json().catch(() => ({}))
      if (res.status === 429) setLoginError('נשלחו יותר מדי בקשות. נסה שוב בעוד כמה דקות.')
      else if (d.noAccess) setLoginError('לכתובת המייל הזו אין גישה לאף דוח. פנה ל-VITAS.')
      else if (!res.ok || !d.ok) setLoginError('לא הצלחנו לשלוח את הקישור. נסה שוב.')
      else showToast('✓ נשלח קישור כניסה למייל. בדוק גם בספאם.')
    } catch { setLoginError('שגיאת רשת. בדוק את החיבור לאינטרנט ונסה שוב.') }
    finally { setLinkSending(false) }
  }

  /**
   * כניסה עם Google / Microsoft.
   *
   * אימות זהות אינו הרשאת גישה: אחרי החזרה מהספק, onAuthStateChange מפעיל את
   * handleSessionReady, שבודק ב-client_access לאילו פרויקטים המייל הזה מורשה. מי שנכנס
   * בלי שיוך מגיע למסך "אין גישה" ולא לרשימת כל הלקוחות — הדרישה ב-UX-SPEC סעיף 1א.
   */
  const signInWithProvider = async (provider) => {
    setLoginError(''); setOauthBusy(provider)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        // Microsoft (azure): בלי scope של email מיקרוסופט מבקשת רק openid, ובחשבונות רבים
        // ה-ID token מגיע בלי מייל — ואז Supabase לא יודע מי נכנס ו-client_access לא נמצא.
        // prompt=select_account: בלי זה הספק נכנס אוטומטית עם החשבון שכבר מחובר בדפדפן, ומי שיש
        // לו כמה חשבונות (פרטי + עבודה) לא יכול לבחור את זה שיש לו גישה לדוח.
        options: {
          redirectTo: window.location.origin + '/client',
          queryParams: { prompt: 'select_account' },
          ...(provider === 'azure' ? { scopes: 'email' } : {}),
        },
      })
      if (error) {
        setOauthBusy('')
        setLoginError('הכניסה דרך הספק אינה זמינה כרגע. אפשר להיכנס עם סיסמה.')
        setShowPwForm(true)
      }
      // בהצלחה הדפדפן עובר לספק; אין מה לאפס כאן.
    } catch {
      setOauthBusy('')
      setLoginError('שגיאת רשת. בדוק את החיבור לאינטרנט ונסה שוב.')
    }
  }

  // Google דרך GIS: גוגל מחזירה ID token לדף, Supabase מאמת אותו ופותח סשן. כמו בכניסה עם
  // סיסמה, handleSessionReady נקרא ישירות — ה-listener של onAuthStateChange כבר סיים (handled).
  const signInWithGoogleIdToken = async (idToken, rawNonce) => {
    setLoginError(''); setOauthBusy('google')
    try {
      const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: rawNonce })
      if (error || !data?.user?.email) {
        // לרוב: ה-Client ID לא מוגדר בספק Google ב-Supabase. הכפתור הישן עדיין עובד.
        setGisFailed(true)
        setLoginError('הכניסה עם Google לא הצליחה. נסה שוב בכפתור Google.')
        return
      }
      await handleSessionReady(data.user.email)
    } catch {
      setLoginError('שגיאת רשת. בדוק את החיבור לאינטרנט ונסה שוב.')
    } finally {
      setOauthBusy('')
    }
  }

  const handlePasswordLogin = async () => {
    if (!emailInput.trim() || !passwordInput.trim()) return
    setLoading(true)
    setLoginError('')
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailInput.trim().toLowerCase(),
        password: passwordInput.trim(),
      })
      if (error) {
        setLoginError('מייל או סיסמה שגויים. בדוק את הפרטים ונסה שוב.')
        return
      }
      if (data?.user?.email) {
        await handleSessionReady(data.user.email)
      }
    } catch {
      setLoginError('שגיאת רשת. בדוק את החיבור לאינטרנט ונסה שוב.')
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setStep('login')
    setPasswordInput('')
    setAccessInfo(null)
    setAccessList([])
  }

  // ── Auth screens ──────────────────────────────────────────────────────────
  // הדף הסטטי (לפני hydration) מציג את הספינר הזה. אם ה-JS לא נטען בכלל (קובץ chunk שחזר 502 ברשת
  // רעועה — נמדד 19.9), React לא עולה ואף קוד שלנו לא רץ: הספינר נשאר לנצח בלי מוצא. לכן סקריפט
  // inline קטן, שרץ ישר מה-HTML, חושף אחרי 15 שניות כפתור "טען מחדש" אם ה-hydration לא סומן.
  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg,#fff)'}}>
      <div style={{textAlign:'center'}}>
        <BrandLoader hint="טוען את הדוח…" />
        <div id="vitas-stuck" style={{display:'none',marginTop:18}}>
          <p style={{color:'var(--text-3)',fontSize:13,margin:'0 0 10px'}}>הטעינה לוקחת יותר מהרגיל.</p>
          <button type="button" onClick={() => window.location.reload()}
            style={{padding:'10px 22px',background:'var(--indigo,#5B5EF4)',color:'#fff',border:'none',borderRadius:10,fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            טען מחדש
          </button>
        </div>
        <script dangerouslySetInnerHTML={{ __html:
          "setTimeout(function(){if(window.__vitasHydrated)return;var e=document.getElementById('vitas-stuck');if(!e)return;e.style.display='block';var b=e.querySelector('button');if(b)b.onclick=function(){location.reload()}},15000);" }} />
      </div>
    </div>
  )

  if (step === 'error') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg,#fff)',fontFamily:'var(--font)'}}>
      <div style={{textAlign:'center',maxWidth:320,padding:'0 24px'}}>
        <div style={{fontSize:48,marginBottom:16}}>🔒</div>
        <h2 style={{margin:'0 0 8px',fontSize:20,fontWeight:800,color:'var(--text)'}}>אין גישה</h2>
        <p style={{margin:'0 0 20px',fontSize:14,color:'var(--text-3)',lineHeight:1.6}}>לכתובת המייל הזו אין גישה לאף פרויקט.</p>
        {/* קודם היה כתוב "צור קשר עם VITAS" בלי שום דרך ליצור קשר — מסך ללא מוצא. */}
        <a
          href="mailto:vitali@vitas.co.il?subject=בקשת%20גישה%20לדוח%20Cluzo"
          style={{display:'block',marginBottom:12,padding:'10px 24px',background:'var(--indigo,#5B5EF4)',color:'#fff',borderRadius:8,fontSize:14,fontWeight:700,textDecoration:'none',fontFamily:'var(--font)'}}
        >
          בקש גישה במייל
        </a>
        {/* מתנתק ולא רק חוזר למסך: אחרת הסשן של החשבון הלא-נכון נשאר, וכניסה חוזרת נוחתת שוב כאן. */}
        <button onClick={logout} style={{padding:'10px 24px',background:'var(--indigo,#5B5EF4)',color:'white',border:'none',borderRadius:8,fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'var(--font)'}}>כניסה עם חשבון אחר</button>
      </div>
    </div>
  )

  if (step === 'setpw') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg,#fff)',fontFamily:'var(--font)'}}>
      <div style={{maxWidth:380,width:'100%',padding:'0 24px'}}>
        <div style={{textAlign:'center',marginBottom:28}}>
          <img src="/brand/cluzo/cluzo-logo-light.svg" alt="Cluzo by Vitas" style={{height:42,marginBottom:20}} />
          <h2 style={{margin:'0 0 8px',fontSize:22,fontWeight:800,color:'var(--text)'}}>בחר סיסמה</h2>
          <p style={{margin:0,fontSize:14,color:'var(--text-3)',lineHeight:1.6}}>
            נכנסת בקישור. כדי להיכנס בפעם הבאה עם מייל וסיסמה, בחר סיסמה משלך.
            <br /><span dir="ltr" style={{unicodeBidi:'isolate'}}>{pendingEmailRef.current}</span>
          </p>
        </div>
        <input type="password" value={newPw} onChange={e => { setNewPw(e.target.value); if (loginError) setLoginError('') }}
          placeholder="סיסמה חדשה (8 תווים לפחות)" dir="ltr" autoComplete="new-password"
          style={{display:'block',width:'100%',padding:'12px 14px',border:'1px solid var(--border)',borderRadius:10,fontSize:15,fontFamily:'var(--font)',outline:'none',marginBottom:12,boxSizing:'border-box',background:'var(--card)',color:'var(--text)'}} />
        <input type="password" value={newPw2} onChange={e => { setNewPw2(e.target.value); if (loginError) setLoginError('') }}
          onKeyDown={e => e.key === 'Enter' && saveNewPassword()}
          placeholder="אותה סיסמה שוב" dir="ltr" autoComplete="new-password"
          style={{display:'block',width:'100%',padding:'12px 14px',border:'1px solid var(--border)',borderRadius:10,fontSize:15,fontFamily:'var(--font)',outline:'none',marginBottom:12,boxSizing:'border-box',background:'var(--card)',color:'var(--text)'}} />
        <button onClick={saveNewPassword} disabled={pwSaving || !newPw || !newPw2}
          style={{display:'block',width:'100%',padding:'13px',background:'var(--indigo,#5B5EF4)',color:'white',border:'none',borderRadius:10,fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'var(--font)',opacity:pwSaving||!newPw||!newPw2?0.6:1}}>
          {pwSaving ? 'שומר...' : 'שמור והמשך לדוח'}
        </button>
        <button onClick={skipNewPassword} type="button"
          style={{display:'block',width:'100%',marginTop:10,padding:'10px',background:'transparent',color:'var(--text-3)',border:'none',fontSize:13,cursor:'pointer',fontFamily:'var(--font)'}}>
          לא עכשיו, המשך לדוח
        </button>
        {loginError && <p role="alert" style={{marginTop:12,fontSize:13,color:'var(--danger,#B92A46)',textAlign:'center',lineHeight:1.5}}>{loginError}</p>}
        {toast && <p style={{marginTop:12,fontSize:13,color:'var(--text-3)',textAlign:'center'}}>{toast}</p>}
      </div>
    </div>
  )

  // מסך הכניסה לפי design/01. סדר המסך: ספקים, מפריד, ואז כניסה עם סיסמה — הדרך הקיימת
  // נשמרת במלואה ואינה מוחלפת, כפי ש-START-HERE-CLAUDE.md דורש ("שימור דרך הכניסה הקיימת").
  // כפתורי הספקים מופיעים רק כשהספק באמת מוגדר ב-Supabase (NEXT_PUBLIC_OAUTH_PROVIDERS):
  // כפתור שנראה פעיל ונכשל בלחיצה הוא בדיוק ה-success המדומה שהחבילה אוסרת.
  if (step === 'login') return (
    <div className="vsign">
      <div className="vsign-card">
        <img src="/brand/cluzo/cluzo-logo-light.svg" alt="Cluzo by Vitas" />
        <h1>ברוכים הבאים</h1>
        <p>נכנסים לחשבון וממשיכים לפרויקטים שלכם.</p>

        {OAUTH_PROVIDERS.includes('google') && GOOGLE_CLIENT_ID && !gisFailed && (
          <GoogleGisButton
            clientId={GOOGLE_CLIENT_ID}
            onCredential={signInWithGoogleIdToken}
            onUnavailable={() => setGisFailed(true)}
            disabled={oauthBusy !== ''}
          />
        )}
        {/* שגיאה בחלון של גוגל (למשל origin שלא הוגדר ב-Google Cloud) לא חוזרת לדף — אין callback.
            לכן תמיד יש מוצא ידני לכפתור הישן, דרך Supabase. */}
        {OAUTH_PROVIDERS.includes('google') && GOOGLE_CLIENT_ID && !gisFailed && (
          <button type="button" className="vsign-gis-alt" onClick={() => setGisFailed(true)}>
            לא מצליח להיכנס עם Google?
          </button>
        )}
        {OAUTH_PROVIDERS.includes('google') && (!GOOGLE_CLIENT_ID || gisFailed) && (
          <button type="button" className="vsign-provider" onClick={() => signInWithProvider('google')} disabled={oauthBusy !== ''}>
            <span>{oauthBusy === 'google' ? 'מעביר ל-Google…' : 'המשך עם Google'}</span>
            <GoogleMark />
          </button>
        )}
        {OAUTH_PROVIDERS.includes('azure') && (
          <button type="button" className="vsign-provider" onClick={() => signInWithProvider('azure')} disabled={oauthBusy !== ''}>
            <span>{oauthBusy === 'azure' ? 'מעביר ל-Microsoft…' : 'המשך עם Microsoft'}</span>
            <MicrosoftMark />
          </button>
        )}
        {OAUTH_PROVIDERS.length > 0 && (
          showPwForm
            ? <div className="vsign-or">או</div>
            : <>
                <div className="vsign-or">או</div>
                <button type="button" className="vsign-link" onClick={() => setShowPwForm(true)}>כניסה עם סיסמה</button>
              </>
        )}

        {(showPwForm || OAUTH_PROVIDERS.length === 0) && (
          <div className="vsign-form">
            <input
              type="email" value={emailInput} onChange={e => { setEmailInput(e.target.value); if (loginError) setLoginError('') }}
              placeholder="your@email.com" dir="ltr" autoComplete="email"
            />
            <input
              type="password" value={passwordInput} onChange={e => { setPasswordInput(e.target.value); if (loginError) setLoginError('') }}
              onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
              placeholder="סיסמה" dir="ltr" autoComplete="current-password"
            />
            <button type="button" className="vsign-submit" onClick={handlePasswordLogin}
              disabled={loading || !emailInput.trim() || !passwordInput.trim()}>
              {loading ? 'נכנס...' : 'כניסה'}
            </button>
            <button type="button" className="vsign-quiet" onClick={requestLoginLink} disabled={linkSending}>
              {linkSending ? 'שולח...' : 'שכחת סיסמה? שלחו לי קישור כניסה'}
            </button>
          </div>
        )}

        {loginError && <p role="alert" className="vsign-err">{loginError}</p>}
        {toast && <p className="vsign-toast">{toast}</p>}

        <p className="vsign-note">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
          הגישה לפרויקטים נקבעת לפי ההרשאות שלך.
        </p>
      </div>
    </div>
  )

  // ── Dashboard — render AdminPage with client-view props ───────────────────
  const allowedProjectIds = accessList.map(a => a.project_id)
  const dismissOnboarding = () => {
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('vitas_onboarding_seen', '1') } catch {}
    }
    setShowOnboarding(false)
  }

  const STEPS = [
    {
      icon: '📂',
      title: 'בחר פרויקט',
      desc: 'בסרגל הצד הימני תמצא את הפרויקטים שלך. לחץ על שם הפרויקט כדי לפתוח את הדוח.',
    },
    {
      icon: '📅',
      title: 'בחר תקופה',
      desc: 'בחר חודש, שבוע אחרון, או טווח תאריכים מותאם דרך בורר התאריכים בראש המסך.',
    },
    {
      icon: '🗂',
      title: 'טאבים',
      desc: '"הכל" — סיכום כולל. "CRM" — לידים ופגישות. "Facebook" ו-"Google" — פירוט לפי פלטפורמה.',
    },
    {
      icon: '📊',
      title: 'מדדים מרכזיים',
      desc: 'כרטיסיות ה-KPI בראש הדוח מציגות: תקציב, לידים, עלות לליד, פגישות וחוזים.',
    },
  ]

  return (
    <>
      <AdminPage isClientView={true} allowedProjectIds={allowedProjectIds} initialClients={buildClients(accessList)} initialProjectId={initialProjectId} onLogout={logout} onHelp={() => setShowOnboarding(true)} />

      {installPrompt && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9998, background: '#0B0F1E', color: '#fff', borderRadius: 14,
          padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 8px 28px rgba(11,15,30,0.45)', fontFamily: 'var(--font, Heebo, sans-serif)',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 20 }}>📲</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>הוסף לסרגל הבית</span>
          <button
            onClick={() => { installPrompt.prompt(); installPrompt.userChoice.then(() => setInstallPrompt(null)); }}
            style={{ background: 'var(--tv-brand, #315CF5)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            התקן
          </button>
          <button onClick={() => setInstallPrompt(null)}
            style={{ background: 'none', border: 'none', color: '#98A0B2', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>
            ×
          </button>
        </div>
      )}

      {showOnboarding && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(11,15,30,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '16px', fontFamily: 'var(--font, Heebo, sans-serif)',
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, maxWidth: 520, width: '100%',
            direction: 'rtl', textAlign: 'right',
            boxShadow: '0 24px 60px rgba(11,15,30,0.3)',
            maxHeight: '90vh', position: 'relative', display: 'flex', flexDirection: 'column',
          }}>
            {/* סגירה. עד 28.9 היה רק "הבנתי" בתחתית, ובמובייל צריך היה לגלול עד אליו.
                ה-X יושב מחוץ לאזור הגלילה, כך שהוא נשאר במקום גם כשגוללים. */}
            <button
              type="button"
              onClick={dismissOnboarding}
              aria-label="סגור את המדריך"
              style={{
                position: 'absolute', top: 12, left: 12, zIndex: 1,
                width: 36, height: 36, borderRadius: '50%', border: 'none',
                background: '#F1F3F9', color: '#5E6478', cursor: 'pointer',
                fontSize: 22, lineHeight: 1, fontFamily: 'inherit',
              }}
            >×</button>
          <div style={{ padding: '36px clamp(18px, 5vw, 32px) 28px', overflowY: 'auto' }}>

            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <img src="/brand/cluzo/cluzo-logo-light.svg" alt="Cluzo by Vitas" style={{ height: 42, width: 'auto', marginBottom: 12 }} />
              <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: '#0B0F1E', letterSpacing: '-0.02em' }}>
                ברוכים הבאים לדוח הביצועים 👋
              </h2>
              <p style={{ margin: 0, fontSize: 14, color: '#5E6478', lineHeight: 1.6 }}>
                מדריך קצר שיעזור לך להתמצא במערכת
              </p>
            </div>

            {/* Steps */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
              {STEPS.map((s, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                  background: '#F8F9FF', borderRadius: 12, padding: '14px 16px',
                  border: '1px solid #E8EAFB',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: 'rgba(91,94,244,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20,
                  }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0B0F1E', marginBottom: 3 }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: 13, color: '#5E6478', lineHeight: 1.6 }}>
                      {s.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tip */}
            <div style={{
              background: 'rgba(91,94,244,0.06)', border: '1px solid rgba(91,94,244,0.2)',
              borderRadius: 10, padding: '11px 14px', marginBottom: 24,
              fontSize: 13, color: '#3B3ECC', lineHeight: 1.6,
            }}>
              💡 <strong>טיפ:</strong> הנתונים מתעדכנים אוטומטית. אין צורך ללחוץ על "רענן".
            </div>

            <p style={{ margin: '0 0 12px', textAlign: 'center', fontSize: 12.5, color: '#98A0B2' }}>
              אפשר לפתוח את המדריך שוב בכל רגע מכפתור העזרה (?) בראש העמוד.
            </p>

            {/* CTA */}
            <button
              onClick={dismissOnboarding}
              style={{
                display: 'block', width: '100%', padding: '13px',
                background: 'var(--tv-brand, #315CF5)', color: '#fff', border: 'none',
                borderRadius: 10, fontSize: 15, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 6px 20px rgba(91,94,244,0.35)',
              }}>
              הבנתי, קדימה! →
            </button>

          </div>
          </div>
        </div>
      )}
    </>
  )
}
