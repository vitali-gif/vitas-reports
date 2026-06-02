'use client'
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import dynamic from 'next/dynamic'

const AdminPage = dynamic(() => import('../admin/page'), { ssr: false })

// ─── Anon key (for client-access API auth) ────────────────────────────────
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ═══════════════════════════════════════════════════════════════════════════
// ClientPage — handles magic-link auth, then renders AdminPage (client view)
// ═══════════════════════════════════════════════════════════════════════════
// Build clients[] shape for AdminPage from accessList (from /api/client-access)
function buildClients(accessList) {
  const map = new Map();
  for (const a of accessList) {
    const cName  = a.projects?.clients?.name  || 'לקוח';
    const cColor = a.projects?.clients?.color || '#5B5EF4';
    const cId    = a.projects?.client_id;
    if (!map.has(cName)) map.set(cName, { id: cId, name: cName, color: cColor, projects: [] });
    map.get(cName).projects.push({ id: a.project_id, name: a.projects?.name, is_demo: false });
  }
  return Array.from(map.values());
}

export default function ClientPage() {
  const [step, setStep]             = useState('email')
  const [emailInput, setEmailInput] = useState('')
  const [loading, setLoading]       = useState(true)
  const [toast, setToast]           = useState('')
  const [accessList, setAccessList] = useState([])
  const [accessInfo, setAccessInfo] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [installPrompt, setInstallPrompt] = useState(null)
  const sessionStartRef = useRef(Date.now())
  const sessionStart = sessionStartRef.current

  // ── PWA: register service worker + capture install prompt ──────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
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
    const hb = setInterval(() => {
      fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'heartbeat', sessionId })
      }).catch(() => {})
    }, 60000)
    const handleUnload = () => {
      const dur = Math.round((Date.now() - start) / 1000)
      navigator.sendBeacon('/api/client-log',
        JSON.stringify({ event: 'logout', sessionId, durationSec: dur }))
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => { clearInterval(hb); window.removeEventListener('beforeunload', handleUnload) }
  }, [sessionId]) // eslint-disable-line

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let handled = false

    const finish = (email) => {
      if (handled) return
      handled = true
      if (email) handleSessionReady(email)
      else setLoading(false)
    }

    // Step 1: parse magic-link hash manually — avoids Next.js/Supabase race condition
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    if (hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.slice(1))
      const accessToken  = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      if (accessToken && refreshToken) {
        window.history.replaceState(null, '', window.location.pathname)
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ data: { session } }) => finish(session?.user?.email || null))
          .catch(() => finish(null))
      }
    }

    // Step 2: onAuthStateChange
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.email) {
        finish(session.user.email)
      }
    })

    // Step 3: existing session
    supabase.auth.getSession()
      .then(({ data: { session } }) => finish(session?.user?.email || null))
      .catch(() => finish(null))

    // Step 4: safety timeout
    const safetyTimer = setTimeout(() => finish(null), 6000)

    return () => { subscription.unsubscribe(); clearTimeout(safetyTimer) }
  }, [])

  const handleSessionReady = async (userEmail) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/client-access?email=${encodeURIComponent(userEmail)}`, {
        headers: { 'x-client-key': ANON_KEY }
      })
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
      fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'login',
          email: userEmail,
          clientName: list[0]?.projects?.clients?.name || '',
          projectIds: list.map(a => a.project_id),
        })
      }).then(r => r.json()).then(d => { if (d.sessionId) { setSessionId(d.sessionId); if (typeof window !== 'undefined') window.__vitasSessionId = d.sessionId } }).catch(() => {})

      // Show onboarding — up to 10 times
      if (typeof window !== 'undefined') {
        const remaining = parseInt(localStorage.getItem('vitas_onboarding_remaining') ?? '10', 10)
        if (remaining > 0) setShowOnboarding(true)
      }
    } catch {
      setStep('error')
    } finally {
      setLoading(false)
    }
  }

  const handleSendOTP = async () => {
    if (!emailInput.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/client-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput.trim().toLowerCase() })
      })
      const data = await res.json().catch(() => ({}))
      if (data.noAccess) {
        setStep('noAccess')
        return
      }
      if (!res.ok) {
        showToast('שגיאה: ' + (data.error || 'נסה שוב'))
        return
      }
    } catch {
      showToast('שגיאת רשת — נסה שוב')
      return
    } finally {
      setLoading(false)
    }
    setStep('sent')
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setStep('email')
    setAccessInfo(null)
    setAccessList([])
  }

  // ── Auth screens ──────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg,#fff)'}}>
      <div style={{textAlign:'center'}}>
        <div style={{width:44,height:44,border:'3px solid var(--indigo,#5B5EF4)',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite',margin:'0 auto 16px'}}/>
        <p style={{color:'var(--text-3)',fontSize:14}}>טוען...</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )

  if (step === 'error') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg,#fff)',fontFamily:'var(--font)'}}>
      <div style={{textAlign:'center',maxWidth:320,padding:'0 24px'}}>
        <div style={{fontSize:48,marginBottom:16}}>🔒</div>
        <h2 style={{margin:'0 0 8px',fontSize:20,fontWeight:800,color:'var(--text)'}}>אין גישה</h2>
        <p style={{margin:'0 0 24px',fontSize:14,color:'var(--text-3)'}}>לכתובת המייל הזו אין גישה לאף פרויקט. צור קשר עם VITAS.</p>
        <button onClick={() => setStep('email')} style={{padding:'10px 24px',background:'var(--indigo,#5B5EF4)',color:'white',border:'none',borderRadius:8,fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'var(--font)'}}>חזרה</button>
      </div>
    </div>
  )

  if (step === 'sent') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg,#fff)',fontFamily:'var(--font)'}}>
      <div style={{textAlign:'center',maxWidth:340,padding:'0 24px'}}>
        <div style={{fontSize:48,marginBottom:16}}>📬</div>
        <h2 style={{margin:'0 0 8px',fontSize:20,fontWeight:800,color:'var(--text)'}}>קישור נשלח!</h2>
        <p style={{margin:'0 0 8px',fontSize:14,color:'var(--text-3)'}}>שלחנו קישור כניסה ל:</p>
        <p style={{margin:'0 0 24px',fontSize:15,fontWeight:700,color:'var(--text)'}}>{emailInput}</p>
        <p style={{margin:'0 0 24px',fontSize:13,color:'var(--text-3)'}}>לחץ על הקישור במייל כדי להיכנס. בדוק גם בספאם.</p>
        <button onClick={() => setStep('email')} style={{color:'var(--indigo)',background:'none',border:'none',fontSize:13,cursor:'pointer',fontFamily:'var(--font)',textDecoration:'underline'}}>שלח שוב</button>
      </div>
    </div>
  )

  if (step === 'picker') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg,#fff)',fontFamily:'var(--font)'}}>
      <div style={{maxWidth:400,width:'100%',padding:'0 24px'}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <img src="/brand/vitas-logo-black.png" alt="VITAS" style={{height:28,marginBottom:20}} />
          <h2 style={{margin:'0 0 6px',fontSize:20,fontWeight:800,color:'var(--text)'}}>בחר פרויקט</h2>
          <p style={{margin:0,fontSize:14,color:'var(--text-3)'}}>יש לך גישה למספר פרויקטים</p>
        </div>
        {accessList.map(a => (
          <button key={a.id} onClick={() => { setAccessInfo(a); setStep('dashboard') }}
            style={{display:'block',width:'100%',background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'16px 20px',marginBottom:10,cursor:'pointer',fontFamily:'var(--font)',textAlign:'right',transition:'all .15s'}}
            onMouseEnter={e => e.currentTarget.style.borderColor='var(--indigo)'}
            onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}
          >
            <div style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{a.projects?.name}</div>
            {a.projects?.clients?.name && <div style={{fontSize:12,color:'var(--text-3)',marginTop:2}}>{a.projects.clients.name}</div>}
          </button>
        ))}
      </div>
    </div>
  )

  if (step === 'noAccess') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg,#fff)',fontFamily:'var(--font)'}}>
      <div style={{textAlign:'center',maxWidth:360,padding:'0 24px'}}>
        <div style={{fontSize:48,marginBottom:16}}>🔒</div>
        <h2 style={{margin:'0 0 12px',fontSize:20,fontWeight:800,color:'var(--text)'}}>אין גישה לכתובת זו</h2>
        <p style={{margin:'0 0 6px',fontSize:14,color:'var(--text-3)',lineHeight:1.6}}>
          לכתובת <strong style={{color:'var(--text)',direction:'ltr',display:'inline-block'}}>{emailInput}</strong> אין גישה למערכת.
        </p>
        <p style={{margin:'0 0 28px',fontSize:14,color:'var(--text-3)',lineHeight:1.6}}>
          לתמיכה וקבלת גישה צרו קשר:<br/>
          <a href="mailto:vitali@vitas.co.il" style={{color:'var(--indigo)',fontWeight:600,textDecoration:'none'}}>vitali@vitas.co.il</a>
        </p>
        <button onClick={() => setStep('email')} style={{padding:'10px 28px',background:'var(--indigo,#5B5EF4)',color:'white',border:'none',borderRadius:8,fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'var(--font)'}}>
          נסה כתובת אחרת
        </button>
      </div>
    </div>
  )

  if (step === 'email') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg,#fff)',fontFamily:'var(--font)'}}>
      <div style={{maxWidth:380,width:'100%',padding:'0 24px'}}>
        <div style={{textAlign:'center',marginBottom:36}}>
          <img src="/brand/vitas-logo-black.png" alt="VITAS" style={{height:28,marginBottom:24}} />
          <h2 style={{margin:'0 0 8px',fontSize:22,fontWeight:800,color:'var(--text)'}}>כניסה לדוח</h2>
          <p style={{margin:0,fontSize:14,color:'var(--text-3)'}}>הכנס את כתובת המייל שלך וישלח לך קישור כניסה</p>
        </div>
        <input
          type="email" value={emailInput} onChange={e => setEmailInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSendOTP()}
          placeholder="your@email.com" dir="ltr"
          style={{display:'block',width:'100%',padding:'12px 14px',border:'1px solid var(--border)',borderRadius:10,fontSize:15,fontFamily:'var(--font)',outline:'none',marginBottom:12,boxSizing:'border-box',background:'var(--card)',color:'var(--text)'}}
        />
        <button onClick={handleSendOTP} disabled={loading || !emailInput.trim()}
          style={{display:'block',width:'100%',padding:'13px',background:'var(--indigo,#5B5EF4)',color:'white',border:'none',borderRadius:10,fontSize:15,fontWeight:700,cursor:'pointer',fontFamily:'var(--font)',opacity:loading||!emailInput.trim()?0.6:1}}>
          {loading ? 'שולח...' : 'שלח קישור כניסה'}
        </button>
        {toast && <p style={{marginTop:12,fontSize:13,color:'var(--danger)',textAlign:'center'}}>{toast}</p>}
      </div>
    </div>
  )

  // ── Dashboard — render AdminPage with client-view props ───────────────────
  const allowedProjectIds = accessList.map(a => a.project_id)
  const onboardingRemaining = typeof window !== 'undefined'
    ? parseInt(localStorage.getItem('vitas_onboarding_remaining') ?? '10', 10)
    : 10

  const dismissOnboarding = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('vitas_onboarding_remaining', String(Math.max(0, onboardingRemaining - 1)))
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
      <AdminPage isClientView={true} allowedProjectIds={allowedProjectIds} initialClients={buildClients(accessList)} />

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
            style={{ background: '#5B5EF4', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
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
            padding: '36px 32px 28px', direction: 'rtl', textAlign: 'right',
            boxShadow: '0 24px 60px rgba(11,15,30,0.3)',
            maxHeight: '90vh', overflowY: 'auto',
          }}>

            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <img src="/brand/vitas-logo-black.png" alt="VITAS" style={{ height: 24, marginBottom: 14 }} />
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

            {/* Countdown */}
            {onboardingRemaining > 1 && (
              <p style={{ margin: '0 0 12px', textAlign: 'center', fontSize: 13, color: '#059669', fontWeight: 600 }}>
                ההודעה הזאת תופיע עוד {onboardingRemaining - 1} פעמים
              </p>
            )}

            {/* CTA */}
            <button
              onClick={dismissOnboarding}
              style={{
                display: 'block', width: '100%', padding: '13px',
                background: '#5B5EF4', color: '#fff', border: 'none',
                borderRadius: 10, fontSize: 15, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 6px 20px rgba(91,94,244,0.35)',
              }}>
              הבנתי, קדימה! →
            </button>


          </div>
        </div>
      )}
    </>
  )
}
