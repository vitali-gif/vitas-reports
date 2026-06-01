'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import dynamic from 'next/dynamic'

const AdminPage = dynamic(() => import('../admin/page'), { ssr: false })

// ─── Anon key (for client-access API auth) ────────────────────────────────
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ═══════════════════════════════════════════════════════════════════════════
// ClientPage — handles magic-link auth, then renders AdminPage (client view)
// ═══════════════════════════════════════════════════════════════════════════
export default function ClientPage() {
  const [step, setStep]             = useState('email')
  const [emailInput, setEmailInput] = useState('')
  const [loading, setLoading]       = useState(true)
  const [toast, setToast]           = useState('')
  const [accessList, setAccessList] = useState([])
  const [accessInfo, setAccessInfo] = useState(null)

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

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
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showToast('שגיאה: ' + (err.error || 'נסה שוב'))
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
  return <AdminPage isClientView={true} allowedProjectIds={allowedProjectIds} />
}
