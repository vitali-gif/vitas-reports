'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import {
  formatCurrency, formatCurrencyCompact, formatNum, formatMonth,
  mapFacebookRows, mapGoogleRows, mapCrmRows,
  aggregateRows, aggregateCrmRows, changePercent, COLORS
} from '../../lib/helpers'
import DatePicker from '../components/shell/DatePicker'
import Chart from 'chart.js/auto'

// ─── Anon key (injected at build time) ────────────────────────────────────
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ─── Preset → fetch payload ────────────────────────────────────────────────
function presetToPayload(key) {
  const t = new Date()
  const ago = n => { const d = new Date(t); d.setDate(d.getDate() - n); return d }
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
  const ym  = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')
  if (key === 'today')       { const s = ymd(t); return { payload: { since: s, until: s }, key: s+'_'+s } }
  if (key === 'yesterday')   { const s = ymd(ago(1)); return { payload: { since: s, until: s }, key: s+'_'+s } }
  if (key === 'last7')       return { payload: { since: ymd(ago(7)),  until: ymd(ago(1)) }, key: ymd(ago(7))+'_'+ymd(ago(1)) }
  if (key === 'last14')      return { payload: { since: ymd(ago(14)), until: ymd(ago(1)) }, key: ymd(ago(14))+'_'+ymd(ago(1)) }
  if (key === 'last28')      return { payload: { since: ymd(ago(28)), until: ymd(ago(1)) }, key: ymd(ago(28))+'_'+ymd(ago(1)) }
  if (key === 'last30')      return { payload: { since: ymd(ago(30)), until: ymd(ago(1)) }, key: ymd(ago(30))+'_'+ymd(ago(1)) }
  if (key === 'last90')      return { payload: { since: ymd(ago(90)), until: ymd(ago(1)) }, key: ymd(ago(90))+'_'+ymd(ago(1)) }
  if (key === 'currentMonth') {
    const s = ymd(new Date(t.getFullYear(), t.getMonth(), 1))
    return { payload: { since: s, until: ymd(t) }, key: s+'_'+ymd(t) }
  }
  if (key === 'lastMonth') {
    const y = t.getMonth() === 0 ? t.getFullYear()-1 : t.getFullYear()
    const m = t.getMonth() === 0 ? 12 : t.getMonth()
    const mm = String(m).padStart(2,'0')
    return { payload: { month: `${y}-${mm}` }, key: `${y}-${mm}` }
  }
  if (key === 'currentYear') return { payload: { since: ymd(new Date(t.getFullYear(),0,1)), until: ymd(t) }, key: ymd(new Date(t.getFullYear(),0,1))+'_'+ymd(t) }
  if (key === 'lastYear') {
    const y = t.getFullYear()-1
    return { payload: { since: `${y}-01-01`, until: `${y}-12-31` }, key: `${y}-01-01_${y}-12-31` }
  }
  return null
}

// ─── KPI card ──────────────────────────────────────────────────────────────
function KpiCard({ label, value, color = 'indigo', trend, icon }) {
  return (
    <div className={`kpi ${color}`}>
      <div className="kpi-top">
        <div className="kpi-icon">{icon}</div>
        {trend != null && (
          <span className={`kpi-trend${trend === 0 ? ' flat' : ''}`}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  )
}

// ─── Section head ──────────────────────────────────────────────────────────
function SHead({ ico, title, sub, color = 'indigo', children }) {
  return (
    <div className="section-head">
      <div className={`ico ${color}`}>{ico}</div>
      <h2>{title}</h2>
      {sub && <span className="sub">{sub}</span>}
      {children && <div className="head-right">{children}</div>}
    </div>
  )
}

// ─── Campaign table ────────────────────────────────────────────────────────
function CampTable({ campaigns, platform }) {
  const entries = Object.entries(campaigns || {})
    .map(([name, d]) => ({ name, ...d, cpl: d.leads > 0 ? d.spend / d.leads : 0 }))
    .filter(d => d.leads > 0 || d.spend > 0)
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 10)

  if (!entries.length) return <div className="welcome-center" style={{padding:'32px 0'}}><div className="icon">📭</div><p>אין נתונים</p></div>

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead><tr>
          <th>קמפיין</th>
          <th>לידים</th>
          <th>תקציב</th>
          <th>עלות/ליד</th>
          {platform === 'facebook' && <th>קליקים</th>}
          {platform === 'facebook' && <th>CTR</th>}
        </tr></thead>
        <tbody>
          {entries.map(d => {
            const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0
            const cplClass = d.cpl > 0 && d.cpl < 80 ? 'tag-green' : d.cpl < 120 ? 'tag-blue' : d.cpl < 150 ? 'tag-purple' : 'tag-red'
            return (
              <tr key={d.name}>
                <td style={{fontWeight:600, maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{d.name}</td>
                <td style={{fontWeight:700, color:'var(--indigo)'}}>{formatNum(d.leads)}</td>
                <td>{formatCurrency(d.spend)}</td>
                <td><span className={`cpl-tag ${cplClass}`}>{formatCurrency(d.cpl)}</span></td>
                {platform === 'facebook' && <td>{formatNum(d.clicks)}</td>}
                {platform === 'facebook' && <td>{ctr.toFixed(2)}%</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════════
export default function ClientPage() {
  const [step, setStep]           = useState('email')
  const [emailInput, setEmailInput] = useState('')
  const [loading, setLoading]     = useState(true)  // true until session check completes
  const [toast, setToast]         = useState('')
  const [accessList, setAccessList] = useState([])
  const [accessInfo, setAccessInfo] = useState(null)
  const [reports, setReports]     = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab]             = useState('summary')
  const [activePreset, setActivePreset] = useState('last30')
  const [since, setSince]         = useState('')
  const [until, setUntil]         = useState('')
  const [selectedMonth, setSelectedMonth] = useState('')

  const chartSrcRef  = useRef(null)
  const chartSrcInst = useRef(null)
  const chartFbRef   = useRef(null)
  const chartFbInst  = useRef(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }, [])

  // ── Auth ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let handled = false

    const finish = (email) => {
      if (handled) return
      handled = true
      if (email) {
        handleSessionReady(email)
      } else {
        setLoading(false)
      }
    }

    // ── Step 1: Handle magic link hash (#access_token=...) ──────────────
    // Supabase processes the hash asynchronously after client init, causing
    // a race condition with getSession(). We parse the hash ourselves and
    // call setSession() directly to avoid missing the SIGNED_IN event.
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    if (hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.slice(1))
      const accessToken  = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      if (accessToken && refreshToken) {
        // Remove hash from URL so it doesn't persist across refreshes
        window.history.replaceState(null, '', window.location.pathname)
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ data: { session } }) => finish(session?.user?.email || null))
          .catch(() => finish(null))
        // setSession is async — let it run, getSession below will also catch it
      }
    }

    // ── Step 2: onAuthStateChange (catches SIGNED_IN from any source) ───
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.email) {
        finish(session.user.email)
      }
    })

    // ── Step 3: getSession — for existing / restored sessions ───────────
    supabase.auth.getSession()
      .then(({ data: { session } }) => finish(session?.user?.email || null))
      .catch(() => finish(null))

    // ── Step 4: 6s safety net ────────────────────────────────────────────
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
    } catch (e) {
      console.error('[client-auth] handleSessionReady error:', e)
      setStep('error')
    } finally {
      setLoading(false)  // ALWAYS called — no spinner gets stuck
    }
  }

  const handleSendOTP = async () => {
    if (!emailInput.trim()) return
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: emailInput.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/client` }
    })
    setLoading(false)
    if (error) { showToast('שגיאה: ' + error.message); return }
    setStep('sent')
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setStep('email')
    setAccessInfo(null)
    setReports([])
    setAccessList([])
  }

  // ── Data fetch ────────────────────────────────────────────────────────────
  const triggerFetch = useCallback(async (payload) => {
    if (refreshing || !accessInfo) return
    const targetKey = payload.month || (payload.since + '_' + payload.until)
    const haveFb  = reports.some(r => r.month === targetKey && r.source === 'facebook')
    const haveGoog = reports.some(r => r.month === targetKey && r.source?.startsWith('google') && (r.summary?.schemaVersion || 0) >= 2)
    const crmRow  = reports.find(r => r.month === targetKey && r.source === 'crm')
    const haveCrm = !!crmRow && (crmRow.summary?.schemaVersion || 0) >= 5
    const today   = new Date().toISOString().slice(0,10)
    const currentYM = today.slice(0,7)
    const isOpen  = payload.month ? payload.month >= currentYM : (payload.until ? payload.until >= today : true)
    if (haveFb && haveGoog && haveCrm && !isOpen) { showToast('✓ נתונים מהמטמון'); return }

    setRefreshing(true)
    const fullPayload = { ...payload, projectId: accessInfo.project_id }
    const headers = { 'Content-Type': 'application/json', 'x-client-key': ANON_KEY }
    try {
      const needed = { fb: !haveFb || isOpen, gg: !haveGoog || isOpen, crm: !haveCrm || isOpen }
      const calls = []
      if (needed.fb)  calls.push('/api/meta/fetch')
      if (needed.gg)  calls.push('/api/google/fetch')
      if (needed.crm) calls.push('/api/bmby/fetch')
      if (calls.length) await Promise.allSettled(calls.map(url => fetch(url, { method:'POST', headers, body: JSON.stringify(fullPayload) }).then(r => r.json())))
      const { data } = await supabase.from('reports').select('*').eq('project_id', accessInfo.project_id).order('month', { ascending: false })
      if (data) setReports(data)
      showToast('✓ נתונים עודכנו')
    } catch (err) { showToast('שגיאה: ' + (err.message || '')) }
    finally { setRefreshing(false) }
  }, [refreshing, accessInfo, reports, showToast])

  const applyPreset = useCallback(async (key) => {
    setActivePreset(key)
    const r = presetToPayload(key)
    if (!r) return
    setSelectedMonth(r.key)
    setSince(r.payload.since || '')
    setUntil(r.payload.until || '')
    await triggerFetch(r.payload)
  }, [triggerFetch])

  const applyRange = useCallback(async (s, u) => {
    setActivePreset('custom')
    const key = s + '_' + u
    setSelectedMonth(key)
    setSince(s)
    setUntil(u)
    await triggerFetch({ since: s, until: u })
  }, [triggerFetch])

  // Load data when accessInfo is set — fetch last 30 days which is always fresh
  useEffect(() => {
    if (!accessInfo) return
    applyPreset('last30')
  }, [accessInfo?.project_id])

  // ── Derived data ──────────────────────────────────────────────────────────
  const currentReports = reports.filter(r => r.month === selectedMonth)
  const fbRows    = currentReports.filter(r => r.source === 'facebook').flatMap(r => mapFacebookRows(r.rows || []))
  const ggRows    = currentReports.filter(r => r.source?.startsWith('google')).flatMap(r => mapGoogleRows(r.rows || [], r.summary))
  const crmReport = currentReports.find(r => r.source === 'crm')
  const crmRows   = crmReport ? mapCrmRows(crmReport.rows || []) : []
  const crmData   = crmReport ? aggregateCrmRows(crmRows) : null
  const crmTotals = crmData?.totals || null
  const fbTotals  = aggregateRows(fbRows)
  const ggTotals  = aggregateRows(ggRows)
  const totalSpend = (fbTotals?.totals?.spend || 0) + (ggTotals?.totals?.spend || 0)
  const totalLeads = (fbTotals?.totals?.leads || 0) + (ggTotals?.totals?.leads || 0)
  const cpl = totalLeads > 0 && totalSpend > 0 ? totalSpend / totalLeads : 0
  const hasData = totalLeads > 0 || totalSpend > 0 || (crmTotals?.totalLeads || 0) > 0
  const projectName = accessInfo?.projects?.name || accessInfo?.label || ''
  const clientName  = accessInfo?.projects?.clients?.name || ''

  // Chart: leads by source
  useEffect(() => {
    if (!chartSrcRef.current || tab !== 'summary') return
    const fb = fbTotals?.totals?.leads || 0
    const gg = ggTotals?.totals?.leads || 0
    if (fb === 0 && gg === 0) return
    if (chartSrcInst.current) chartSrcInst.current.destroy()
    chartSrcInst.current = new Chart(chartSrcRef.current, {
      type: 'doughnut',
      data: {
        labels: ['Facebook', 'Google'],
        datasets: [{ data: [fb, gg], backgroundColor: ['#5B5EF4', '#10B981'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    })
    return () => { if (chartSrcInst.current) chartSrcInst.current.destroy() }
  }, [tab, selectedMonth, reports])

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
      </div>
    </div>
  )

  // ═══════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════
  const TABS = [
    { key: 'summary', label: '📊 סיכום' },
    { key: 'leads',   label: '📣 לידים' },
    { key: 'crm',     label: '🏠 CRM' },
    { key: 'monthly', label: '📋 סיכום חודשי' },
  ]

  const iconSvg = (path) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
  )

  return (
    <div dir="rtl" className="app-layout" style={{gridTemplateColumns:'1fr'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Toast */}
      {toast && (
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'#0B0F1E',color:'white',padding:'10px 20px',borderRadius:24,fontSize:13,zIndex:9999,boxShadow:'0 4px 20px rgba(0,0,0,0.3)',fontWeight:500,whiteSpace:'nowrap'}}>
          {toast}
        </div>
      )}

      {/* ── Header ── */}
      <header className="header" style={{position:'sticky',top:0,zIndex:100}}>
        <div className="h-brand">
          <img src="/brand/vitas-logo-black.png" alt="VITAS" style={{height:22}} />
          <span className="pipe"/>
          <span style={{fontSize:13,fontWeight:700,color:'var(--text-2)'}}>{projectName}</span>
          {clientName && <span style={{fontSize:12,color:'var(--text-4)',marginRight:4}}>· {clientName}</span>}
        </div>
        <div className="h-spacer"/>
        <div className="h-actions" style={{display:'flex',alignItems:'center',gap:10}}>
          {refreshing && (
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--indigo)',fontWeight:600}}>
              <div style={{width:12,height:12,border:'2px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
              מושך נתונים...
            </div>
          )}
          <DatePicker
            activePreset={activePreset}
            since={since}
            until={until}
            onApplyPreset={applyPreset}
            onApplyRange={applyRange}
          />
          {accessList.length > 1 && (
            <button onClick={() => { setStep('picker'); setReports([]); setAccessInfo(null) }}
              className="btn btn-outline" style={{fontSize:13}}>החלף</button>
          )}
          <button onClick={logout} className="btn btn-outline" style={{fontSize:13}}>יציאה</button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="main-content">

        {/* Tabs */}
        <div className="client-tabs" style={{marginBottom:24}}>
          {TABS.map(t => (
            <button key={t.key} className={`client-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* No data state */}
        {!hasData && !refreshing && (
          <div className="welcome-center">
            <div className="icon">📊</div>
            <h3>אין נתונים לתקופה זו</h3>
            <p>בחר תקופה אחרת</p>
          </div>
        )}

        {/* ── Tab: סיכום ── */}
        {tab === 'summary' && hasData && (
          <>
            {/* KPI grid */}
            <div className="kpi-grid" style={{marginBottom:28}}>
              <KpiCard label="לידים" value={formatNum(totalLeads)} color="indigo"
                icon={iconSvg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>)}
              />
              <KpiCard label="עלות לליד" value={cpl > 0 ? formatCurrency(cpl) : '—'} color="emerald"
                icon={iconSvg(<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>)}
              />
              <KpiCard label="פגישות שהתקיימו" value={formatNum(crmTotals?.meetingsCompleted || 0)} color="terra"
                icon={iconSvg(<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="8 15 11 18 16 13"/></>)}
              />
              <KpiCard label="חוזים" value={formatNum(crmTotals?.contracts || 0)} color="sky"
                icon={iconSvg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>)}
              />
              <KpiCard label="שווי חוזים" value={(crmTotals?.contractValue || 0) > 0 ? formatCurrencyCompact(crmTotals.contractValue) : '—'} color="violet"
                icon={iconSvg(<><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></>)}
              />
              <KpiCard label="תקציב כולל" value={totalSpend > 0 ? formatCurrency(totalSpend) : '—'} color="amber"
                icon={iconSvg(<><path d="M21 12V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/><path d="M21 12h-5a2 2 0 0 0 0 4h5"/></>)}
              />
            </div>

            {/* Two-col: funnel + source chart */}
            <div className="chart-grid" style={{gridTemplateColumns:'1fr 1fr',marginBottom:28}}>
              {/* Marketing funnel */}
              <div className="section">
                <SHead ico={iconSvg(<><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>)} title="משפך שיווקי" color="sky"/>
                <div className="funnel">
                  {[
                    { label: 'לידים', value: totalLeads, color: 'sky' },
                    { label: 'פגישות תואמו', value: crmTotals?.meetingsScheduled || 0, color: 'terra' },
                    { label: 'פגישות בוצעו', value: crmTotals?.meetingsCompleted || 0, color: 'emerald' },
                    { label: 'חוזים', value: crmTotals?.contracts || 0, color: 'violet' },
                  ].map((s, i, arr) => (
                    <div key={s.label} className={`fstep ${s.color}`}>
                      <div className="fvalue">{formatNum(s.value)}</div>
                      <div className="flabel">{s.label}</div>
                      <div className="frate">
                        {i > 0 && arr[i-1].value > 0 ? (s.value / arr[i-1].value * 100).toFixed(0) + '%' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Source chart */}
              <div className="section">
                <SHead ico={iconSvg(<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>)} title="לידים לפי מקור" color="indigo"/>
                <div className="chart-card">
                  <div className="chart-container" style={{height:200}}>
                    <canvas ref={chartSrcRef}/>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Tab: לידים ── */}
        {tab === 'leads' && hasData && (
          <>
            {/* Facebook */}
            <div className="section" style={{marginBottom:28}}>
              <SHead
                ico={iconSvg(<><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></>)}
                title="Facebook — קמפיינים"
                sub={`${formatNum(fbTotals?.totals?.leads||0)} לידים · ${formatCurrency(fbTotals?.totals?.spend||0)}`}
                color="indigo"
              />
              <CampTable campaigns={fbTotals?.campaigns} platform="facebook"/>
            </div>

            {/* Google */}
            <div className="section">
              <SHead
                ico={iconSvg(<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>)}
                title="Google — קמפיינים"
                sub={`${formatNum(ggTotals?.totals?.leads||0)} לידים · ${formatCurrency(ggTotals?.totals?.spend||0)}`}
                color="emerald"
              />
              <CampTable campaigns={ggTotals?.campaigns} platform="google"/>
            </div>
          </>
        )}

        {/* ── Tab: CRM ── */}
        {tab === 'crm' && (
          <>
            {crmTotals ? (
              <>
                {/* CRM KPI row */}
                <div className="kpi-grid" style={{marginBottom:28}}>
                  <KpiCard label='סה"כ לידים' value={formatNum(crmTotals.totalLeads)} color="sky"
                    icon={iconSvg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>)}
                  />
                  <KpiCard label="רלוונטיים" value={formatNum(crmTotals.relevantLeads)} color="emerald"
                    icon={iconSvg(<><polyline points="20 6 9 17 4 12"/></>)}
                  />
                  <KpiCard label="פגישות תואמו" value={formatNum(crmTotals.meetingsScheduled)} color="terra"
                    icon={iconSvg(<><rect x="3" y="4" width="18" height="18" rx="2"/><polyline points="8 15 11 18 16 13"/></>)}
                  />
                  <KpiCard label="פגישות בוצעו" value={formatNum(crmTotals.meetingsCompleted)} color="violet"
                    icon={iconSvg(<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>)}
                  />
                  <KpiCard label="חוזים" value={formatNum(crmTotals.contracts)} color="indigo"
                    icon={iconSvg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>)}
                  />
                </div>

                {/* CRM Funnel */}
                <div className="section" style={{marginBottom:28}}>
                  <SHead ico={iconSvg(<><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>)} title='משפך לידים' sub='מליד ועד חוזה' color="sky"/>
                  <div className="crm-funnel">
                    {[
                      { label: 'סה"כ לידים', value: crmTotals.totalLeads, color: 'sky' },
                      null,
                      { label: 'רלוונטיים', value: crmTotals.relevantLeads, pct: crmTotals.relevantRate },
                      null,
                      { label: 'פגישות תואמו', value: crmTotals.meetingsScheduled, pct: crmTotals.scheduledRate, color: 'terra' },
                      null,
                      { label: 'פגישות בוצעו', value: crmTotals.meetingsCompleted, pct: crmTotals.completedRate, color: 'emerald' },
                      null,
                      { label: 'חוזים', value: crmTotals.contracts, pct: crmTotals.contractRate, color: 'violet' },
                    ].map((s, i) => s === null
                      ? <div key={i} className="crm-farrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
                      : <div key={s.label} className={`crm-fstep${s.color ? ' '+s.color : ''}`}>
                          <div className="v">{formatNum(s.value)}</div>
                          <div className="l">{s.label}</div>
                          {s.pct !== undefined && <div className="pct">{s.pct.toFixed(0)}%</div>}
                        </div>
                    )}
                  </div>
                </div>

                {/* Sources table */}
                {crmData?.sources && Object.keys(crmData.sources).length > 0 && (
                  <div className="section">
                    <SHead ico={iconSvg(<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>)} title="לידים לפי מקור" color="emerald"/>
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead><tr><th>מקור</th><th>לידים</th><th>רלוונטיים</th><th>פגישות</th><th>חוזים</th></tr></thead>
                        <tbody>
                          {Object.entries(crmData.sources)
                            .sort((a,b) => b[1].totalLeads - a[1].totalLeads)
                            .slice(0,10)
                            .map(([name, d]) => (
                              <tr key={name}>
                                <td style={{fontWeight:600}}>{name}</td>
                                <td>{formatNum(d.totalLeads)}</td>
                                <td>{formatNum(d.relevantLeads)}</td>
                                <td>{formatNum(d.meetingsCompleted)}</td>
                                <td style={{fontWeight:700,color:'var(--indigo)'}}>{formatNum(d.contracts)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="welcome-center">
                <div className="icon">💭</div>
                <h3>אין נתוני CRM לתקופה זו</h3>
              </div>
            )}
          </>
        )}

        {/* ── Tab: סיכום חודשי ── */}
        {tab === 'monthly' && (
          <div className="welcome-center" style={{padding:'60px 0'}}>
            <div className="icon">🚀</div>
            <h3>סיכום חודשי — בקרוב</h3>
            <p style={{color:'var(--text-3)',fontSize:14}}>הטאב הזה יכיל סיכום ביצועים, הצלחות וכשלונות, ציר זמן אירועים והמלצות</p>
          </div>
        )}

      </main>
    </div>
  )
}
