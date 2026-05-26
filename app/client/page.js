'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import {
  formatCurrency, formatCurrencyCompact, formatNum, formatMonth,
  mapFacebookRows, mapGoogleRows, mapCrmRows,
  aggregateRows, aggregateCrmRows, changePercent, COLORS
} from '../../lib/helpers'
import Chart from 'chart.js/auto'

// ─── helpers ───────────────────────────────────────────────────────────────
const toYMD = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')

function presetToPayload(preset) {
  const today = new Date()
  if (preset === 'currentMonth') {
    const s = toYMD(new Date(today.getFullYear(), today.getMonth(), 1)), e = toYMD(today)
    return { payload: { since: s, until: e }, key: s + '_' + e }
  }
  if (preset === 'lastMonth') {
    const y = today.getMonth() === 0 ? today.getFullYear()-1 : today.getFullYear()
    const m = today.getMonth() === 0 ? 12 : today.getMonth()
    const mm = String(m).padStart(2,'0')
    return { payload: { month: `${y}-${mm}` }, key: `${y}-${mm}` }
  }
  if (preset === 'last7') {
    const end = new Date(today); end.setDate(end.getDate()-1)
    const start = new Date(today); start.setDate(start.getDate()-7)
    const s = toYMD(start), e = toYMD(end)
    return { payload: { since: s, until: e }, key: s + '_' + e }
  }
  if (preset === 'last30') {
    const end = new Date(today); end.setDate(end.getDate()-1)
    const start = new Date(today); start.setDate(start.getDate()-30)
    const s = toYMD(start), e = toYMD(end)
    return { payload: { since: s, until: e }, key: s + '_' + e }
  }
  return null
}

function kpiCard(label, value, color = 'indigo', sub = null) {
  const colorMap = {
    indigo: '#6366f1', emerald: '#10b981', amber: '#f59e0b',
    rose: '#f43f5e', sky: '#0ea5e9', violet: '#8b5cf6', orange: '#f97316'
  }
  const c = colorMap[color] || colorMap.indigo
  return (
    <div key={label} style={{
      background: 'white', border: '1px solid #e5e7eb', borderRadius: 12,
      padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
    }}>
      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: c, letterSpacing: '-0.5px' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#9ca3af' }}>{sub}</div>}
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────
export default function ClientPage() {
  const [step, setStep] = useState('email') // email | sent | dashboard | error
  const [email, setEmail] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [sendingLink, setSendingLink] = useState(false)
  const [accessInfo, setAccessInfo] = useState(null) // { project_id, projects: { name, clients: { name } } }
  const [reports, setReports] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [activePreset, setActivePreset] = useState('lastMonth')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState('summary') // summary | crm | leads
  const [toast, setToast] = useState('')
  const chartRef = useRef(null)
  const chartInstance = useRef(null)
  const funnelRef = useRef(null)
  const funnelInstance = useRef(null)
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  // Show toast
  const showToast = useCallback((msg, ms = 3000) => {
    setToast(msg)
    setTimeout(() => setToast(''), ms)
  }, [])

  // ── Auth listener ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user?.email) {
        await handleSessionReady(session.user.email)
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user?.email) {
        await handleSessionReady(session.user.email)
      }
    })
    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line

  const handleSessionReady = async (userEmail) => {
    setEmail(userEmail)
    try {
      const res = await fetch(`/api/client-access?email=${encodeURIComponent(userEmail)}`)
      if (!res.ok) {
        setStep('error')
        setLoading(false)
        return
      }
      const info = await res.json()
      setAccessInfo(info)
      // Load cached reports for this project
      const { data } = await supabase
        .from('reports')
        .select('*')
        .eq('project_id', info.project_id)
        .order('month', { ascending: false })
      if (data && data.length > 0) {
        setReports(data)
        setSelectedMonth(data[0].month)
      }
      setStep('dashboard')
    } catch {
      setStep('error')
    } finally {
      setLoading(false)
    }
  }

  // ── Send magic link ────────────────────────────────────────────────────
  const sendLink = async (e) => {
    e.preventDefault()
    if (!emailInput.trim()) return
    setSendingLink(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: emailInput.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/client` }
    })
    setSendingLink(false)
    if (error) {
      showToast('שגיאה: ' + error.message, 5000)
    } else {
      setStep('sent')
    }
  }

  // ── Data fetch ─────────────────────────────────────────────────────────
  const triggerFetch = useCallback(async (payload) => {
    if (refreshing || !accessInfo) return
    const targetKey = payload.month || (payload.since + '_' + payload.until)
    const haveFb = reports.some(r => r.month === targetKey && r.source === 'facebook')
    const GOOGLE_SV = 2
    const haveGoog = reports.some(r => r.month === targetKey && r.source?.startsWith('google') && (r.summary?.schemaVersion || 0) >= GOOGLE_SV)
    const CRM_SV = 5
    const crmRow = reports.find(r => r.month === targetKey && r.source === 'crm')
    const haveCrm = !!crmRow && (crmRow.summary?.schemaVersion || 0) >= CRM_SV

    const today = new Date().toISOString().slice(0,10)
    const currentYM = today.slice(0,7)
    let isOpen = payload.month ? payload.month >= currentYM : (payload.until ? payload.until >= today : true)

    if (haveFb && haveGoog && haveCrm && !isOpen) {
      showToast('✓ נתונים סופיים מהמטמון')
      return
    }

    setRefreshing(true)
    const fullPayload = { ...payload, projectId: accessInfo.project_id }
    const headers = { 'Content-Type': 'application/json', 'x-client-key': ANON_KEY }
    try {
      const needed = { fb: !haveFb || isOpen, gg: !haveGoog || isOpen, crm: !haveCrm || isOpen }
      const callList = []
      if (needed.fb)  callList.push('/api/meta/fetch')
      if (needed.gg)  callList.push('/api/google/fetch')
      if (needed.crm) callList.push('/api/bmby/fetch')
      if (callList.length > 0) {
        await Promise.allSettled(
          callList.map(url => fetch(url, { method: 'POST', headers, body: JSON.stringify(fullPayload) }).then(r => r.json()))
        )
      }
      const { data } = await supabase
        .from('reports')
        .select('*')
        .eq('project_id', accessInfo.project_id)
        .order('month', { ascending: false })
      if (data) setReports(data)
      showToast('✓ נתונים עודכנו')
    } catch (err) {
      showToast('שגיאה: ' + (err.message || ''))
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, accessInfo, reports, showToast, ANON_KEY])

  const applyPreset = useCallback(async (preset) => {
    setActivePreset(preset)
    const r = presetToPayload(preset)
    if (!r) return
    setSelectedMonth(r.key)
    await triggerFetch(r.payload)
  }, [triggerFetch])

  // Auto-load last month on first mount once we have accessInfo
  useEffect(() => {
    if (step !== 'dashboard' || !accessInfo) return
    applyPreset('lastMonth')
  }, [step, accessInfo]) // eslint-disable-line

  // ── Derived data ───────────────────────────────────────────────────────
  const currentReports = reports.filter(r => r.month === selectedMonth)
  const fbRows = currentReports.filter(r => r.source === 'facebook').flatMap(r => mapFacebookRows(r.rows || []))
  const ggRows = currentReports.filter(r => r.source?.startsWith('google')).flatMap(r => mapGoogleRows(r.rows || [], r.summary))
  const crmReport = currentReports.find(r => r.source === 'crm')
  const crmRows = crmReport ? mapCrmRows(crmReport.rows || []) : []
  const crmTotals = crmReport ? aggregateCrmRows(crmRows) : null

  const fbTotals = aggregateRows(fbRows)
  const ggTotals = aggregateRows(ggRows)
  const totalSpend = (fbTotals?.spend || 0) + (ggTotals?.spend || 0)
  const totalLeads = (fbTotals?.leads || 0) + (ggTotals?.leads || 0)
  const totalImps = (fbTotals?.impressions || 0) + (ggTotals?.impressions || 0)
  const totalClicks = (fbTotals?.clicks || 0) + (ggTotals?.clicks || 0)
  const cpl = totalLeads > 0 && totalSpend > 0 ? totalSpend / totalLeads : 0
  const cpMeeting = crmTotals && crmTotals.meetingsCompleted > 0 && totalSpend > 0
    ? totalSpend / crmTotals.meetingsCompleted : 0
  const cpContract = crmTotals && crmTotals.contracts > 0 && totalSpend > 0
    ? totalSpend / crmTotals.contracts : 0

  // ── Funnel chart ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!funnelRef.current || tab !== 'summary') return
    const leads = totalLeads || 0
    const meetings = crmTotals?.meetingsCompleted || 0
    const contracts = crmTotals?.contracts || 0
    if (funnelInstance.current) { funnelInstance.current.destroy(); funnelInstance.current = null }
    if (leads === 0 && meetings === 0 && contracts === 0) return
    funnelInstance.current = new Chart(funnelRef.current, {
      type: 'bar',
      data: {
        labels: ['לידים', 'פגישות שבוצעו', 'חוזים'],
        datasets: [{
          data: [leads, meetings, contracts],
          backgroundColor: ['rgba(99,102,241,0.85)', 'rgba(245,158,11,0.85)', 'rgba(16,185,129,0.85)'],
          borderRadius: 8,
          borderSkipped: false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          callbacks: { label: ctx => ' ' + formatNum(ctx.parsed.x) }
        }},
        scales: {
          x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { family: 'Heebo', size: 12 } } },
          y: { grid: { display: false }, ticks: { font: { family: 'Heebo', size: 13 }, color: '#374151' } }
        }
      }
    })
    return () => { if (funnelInstance.current) { funnelInstance.current.destroy(); funnelInstance.current = null } }
  }, [tab, totalLeads, crmTotals])

  // ── Source pie chart ───────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current || tab !== 'summary') return
    if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null }
    const fbL = fbTotals?.leads || 0
    const ggL = ggTotals?.leads || 0
    if (fbL === 0 && ggL === 0) return
    chartInstance.current = new Chart(chartRef.current, {
      type: 'doughnut',
      data: {
        labels: ['Facebook', 'Google'],
        datasets: [{ data: [fbL, ggL],
          backgroundColor: ['#3b82f6', '#ef4444'],
          borderWidth: 2, borderColor: '#fff', hoverOffset: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Heebo', size: 12 }, padding: 16 } },
          tooltip: { callbacks: { label: ctx => ' ' + formatNum(ctx.parsed) + ' לידים' } }
        }
      }
    })
    return () => { if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null } }
  }, [tab, fbTotals, ggTotals])

  const logout = async () => {
    await supabase.auth.signOut()
    setStep('email')
    setAccessInfo(null)
    setReports([])
    setEmailInput('')
  }

  // ─── Render states ──────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Heebo,sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e5e7eb', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ color: '#6b7280', fontSize: 14 }}>טוען...</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (step === 'error') return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Heebo,sans-serif', background: '#f9fafb' }}>
      <div style={{ textAlign: 'center', maxWidth: 400, padding: 32 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8 }}>אין גישה</h2>
        <p style={{ color: '#6b7280', marginBottom: 24 }}>כתובת המייל שלך אינה מורשית לגשת למערכת.<br/>פנה ל-VITAS לקבלת גישה.</p>
        <button onClick={logout} style={{ padding: '10px 24px', background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, fontFamily: 'Heebo,sans-serif', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}>
          חזרה
        </button>
      </div>
    </div>
  )

  if (step === 'sent') return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Heebo,sans-serif', background: '#f9fafb' }}>
      <div style={{ textAlign: 'center', maxWidth: 400, padding: 32 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>📧</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#111827', marginBottom: 8 }}>קישור נשלח!</h2>
        <p style={{ color: '#6b7280', lineHeight: 1.7 }}>
          שלחנו קישור כניסה לכתובת<br/>
          <strong style={{ color: '#111827' }}>{emailInput}</strong><br/>
          לחץ על הקישור במייל כדי להיכנס לדאשבורד.
        </p>
        <button onClick={() => setStep('email')} style={{ marginTop: 24, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, fontFamily: 'Heebo,sans-serif', textDecoration: 'underline' }}>
          שלח שוב
        </button>
      </div>
    </div>
  )

  if (step === 'email') return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg,#0b0f1e 0%,#1e1b4b 100%)', fontFamily: 'Heebo,sans-serif' }}>
      <div style={{ background: 'white', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', textAlign: 'center' }}>
        <img src="/brand/vitas-logo-black.png" alt="VITAS" style={{ height: 32, marginBottom: 28, display: 'block', margin: '0 auto 28px' }} />
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#111827', marginBottom: 8 }}>כניסה לדאשבורד</h2>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>הזן את כתובת המייל שלך ונשלח לך קישור כניסה</p>
        <form onSubmit={sendLink} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email" required value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            placeholder="your@email.com"
            style={{ padding: '12px 16px', border: '1px solid #d1d5db', borderRadius: 10, fontSize: 15, fontFamily: 'Heebo,sans-serif', textAlign: 'center', outline: 'none', direction: 'ltr' }}
          />
          <button type="submit" disabled={sendingLink} style={{ padding: '12px', background: sendingLink ? '#a5b4fc' : '#6366f1', color: 'white', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: 'Heebo,sans-serif', cursor: sendingLink ? 'default' : 'pointer' }}>
            {sendingLink ? 'שולח...' : 'שלח קישור כניסה'}
          </button>
        </form>
      </div>
    </div>
  )

  // ─── DASHBOARD ──────────────────────────────────────────────────────────
  const projectName = accessInfo?.projects?.name || ''
  const clientName = accessInfo?.projects?.clients?.name || ''
  const hasData = currentReports.length > 0

  const PRESETS = [
    { key: 'currentMonth', label: 'חודש נוכחי' },
    { key: 'lastMonth', label: 'חודש קודם' },
    { key: 'last7', label: '7 ימים' },
    { key: 'last30', label: '30 ימים' },
  ]

  const TABS = [
    { key: 'summary', label: 'סיכום' },
    { key: 'crm', label: 'CRM' },
    { key: 'leads', label: 'לידים' },
  ]

  return (
    <div dir="rtl" style={{ fontFamily: 'Heebo,sans-serif', background: '#f9fafb', minHeight: '100vh' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        * { box-sizing: border-box; }
        body { margin: 0; }
        .client-kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px,1fr)); gap: 14px; }
        .client-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .client-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .client-table th { background: #f3f4f6; padding: 10px 12px; text-align: right; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; }
        .client-table td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; color: #374151; }
        .client-table tr:hover td { background: #f9fafb; }
        .client-card { background: white; border: 1px solid #e5e7eb; border-radius: 14px; padding: 22px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); }
        @media (max-width: 640px) {
          .client-two-col { grid-template-columns: 1fr !important; }
          .client-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      {/* Header */}
      <header style={{ background: 'white', borderBottom: '1px solid #e5e7eb', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/brand/vitas-logo-black.png" alt="VITAS" style={{ height: 26 }} />
          <div style={{ borderRight: '1px solid #e5e7eb', paddingRight: 14, marginRight: -4 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{projectName}</div>
            {clientName && <div style={{ fontSize: 12, color: '#9ca3af' }}>{clientName}</div>}
          </div>
        </div>
        <button onClick={logout} style={{ padding: '7px 16px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'Heebo,sans-serif', cursor: 'pointer', color: '#374151', fontWeight: 600 }}>
          יציאה
        </button>
      </header>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#111827', color: 'white', padding: '10px 20px', borderRadius: 24, fontSize: 13, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', fontWeight: 500 }}>
          {toast}
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
        {/* Preset selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 600 }}>תקופה:</span>
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key)} style={{
              padding: '7px 14px', border: '1px solid ' + (activePreset === p.key ? '#6366f1' : '#d1d5db'),
              background: activePreset === p.key ? '#ede9fe' : 'white', color: activePreset === p.key ? '#4f46e5' : '#374151',
              borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'Heebo,sans-serif', fontWeight: activePreset === p.key ? 700 : 500,
              transition: 'all 0.15s'
            }}>{p.label}</button>
          ))}
          {refreshing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#6366f1', fontWeight: 600 }}>
              <div style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              מושך נתונים...
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #e5e7eb', marginBottom: 24 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'Heebo,sans-serif', fontSize: 14, fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? '#4f46e5' : '#6b7280',
              borderBottom: tab === t.key ? '2px solid #6366f1' : '2px solid transparent',
              marginBottom: -2, transition: 'all 0.15s'
            }}>{t.label}</button>
          ))}
        </div>

        {!hasData && !refreshing && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>אין נתונים לתקופה זו</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>בחר תקופה אחרת או לחץ על לחצן הרענון</div>
          </div>
        )}

        {/* ── SUMMARY TAB ─────────────────────────────────────────────── */}
        {hasData && tab === 'summary' && (
          <>
            <div className="client-kpi-grid" style={{ marginBottom: 24 }}>
              {kpiCard('תקציב כולל', formatCurrencyCompact(totalSpend), 'indigo')}
              {kpiCard('לידים', formatNum(totalLeads), 'sky')}
              {kpiCard('עלות לליד', cpl > 0 ? formatCurrencyCompact(cpl) : '—', 'violet')}
              {crmTotals && kpiCard('פגישות', formatNum(crmTotals.meetingsCompleted || 0), 'amber')}
              {cpMeeting > 0 && kpiCard('עלות לפגישה', formatCurrencyCompact(cpMeeting), 'orange')}
              {crmTotals && kpiCard('חוזים', formatNum(crmTotals.contracts || 0), 'emerald')}
              {cpContract > 0 && kpiCard('עלות לחוזה', formatCurrencyCompact(cpContract), 'rose')}
              {crmTotals && (crmTotals.contractValue || 0) > 0 && kpiCard('שווי חוזים', formatCurrencyCompact(crmTotals.contractValue), 'emerald')}
            </div>

            <div className="client-two-col">
              <div className="client-card">
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>משפך שיווקי</div>
                <div style={{ height: 180, position: 'relative' }}>
                  <canvas ref={funnelRef} />
                </div>
              </div>
              <div className="client-card">
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>לידים לפי מקור</div>
                <div style={{ height: 180, position: 'relative' }}>
                  {(fbTotals?.leads || 0) === 0 && (ggTotals?.leads || 0) === 0
                    ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: 13 }}>אין נתונים</div>
                    : <canvas ref={chartRef} />
                  }
                </div>
              </div>
            </div>

            {/* Ad platform breakdown */}
            {(totalSpend > 0 || totalLeads > 0) && (
              <div className="client-card" style={{ marginTop: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>פירוט לפי פלטפורמה</div>
                <table className="client-table">
                  <thead>
                    <tr>
                      <th>פלטפורמה</th>
                      <th>תקציב</th>
                      <th>לידים</th>
                      <th>עלות לליד</th>
                      <th>חשיפות</th>
                      <th>קליקים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fbTotals && (
                      <tr>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} />Facebook</span></td>
                        <td>{formatCurrencyCompact(fbTotals.spend || 0)}</td>
                        <td>{formatNum(fbTotals.leads || 0)}</td>
                        <td>{fbTotals.leads > 0 ? formatCurrencyCompact((fbTotals.spend || 0) / fbTotals.leads) : '—'}</td>
                        <td>{formatNum(fbTotals.impressions || 0)}</td>
                        <td>{formatNum(fbTotals.clicks || 0)}</td>
                      </tr>
                    )}
                    {ggTotals && (
                      <tr>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />Google</span></td>
                        <td>{formatCurrencyCompact(ggTotals.spend || 0)}</td>
                        <td>{formatNum(ggTotals.leads || 0)}</td>
                        <td>{ggTotals.leads > 0 ? formatCurrencyCompact((ggTotals.spend || 0) / ggTotals.leads) : '—'}</td>
                        <td>{formatNum(ggTotals.impressions || 0)}</td>
                        <td>{formatNum(ggTotals.clicks || 0)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── CRM TAB ──────────────────────────────────────────────────── */}
        {hasData && tab === 'crm' && crmTotals && (
          <>
            <div className="client-kpi-grid" style={{ marginBottom: 24 }}>
              {kpiCard('לידים', formatNum(crmTotals.leads || 0), 'sky')}
              {kpiCard('פגישות שנקבעו', formatNum(crmTotals.meetings || 0), 'indigo')}
              {kpiCard('פגישות שבוצעו', formatNum(crmTotals.meetingsCompleted || 0), 'amber')}
              {kpiCard('חוזים', formatNum(crmTotals.contracts || 0), 'emerald')}
              {(crmTotals.contractValue || 0) > 0 && kpiCard('שווי חוזים', formatCurrencyCompact(crmTotals.contractValue), 'emerald')}
              {crmTotals.leads > 0 && kpiCard('יחס המרה לחוזה', Math.round((crmTotals.contracts / crmTotals.leads) * 100) + '%', 'violet')}
            </div>

            {crmTotals.objections && Object.keys(crmTotals.objections).length > 0 && (
              <div className="client-card" style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>התנגדויות עיקריות</div>
                <table className="client-table">
                  <thead><tr><th>התנגדות</th><th>כמות</th><th>%</th></tr></thead>
                  <tbody>
                    {Object.entries(crmTotals.objections)
                      .sort(([,a],[,b]) => b - a)
                      .slice(0, 8)
                      .map(([k, v]) => (
                        <tr key={k}>
                          <td>{k}</td>
                          <td>{v}</td>
                          <td>{crmTotals.leads > 0 ? Math.round(v / crmTotals.leads * 100) + '%' : '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {crmTotals.cities && Object.keys(crmTotals.cities).length > 0 && (
              <div className="client-card">
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>לידים לפי יישוב</div>
                <table className="client-table">
                  <thead><tr><th>יישוב</th><th>לידים</th></tr></thead>
                  <tbody>
                    {Object.entries(crmTotals.cities)
                      .sort(([,a],[,b]) => b - a)
                      .slice(0, 10)
                      .map(([city, count]) => (
                        <tr key={city}><td>{city}</td><td>{count}</td></tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {hasData && tab === 'crm' && !crmTotals && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
            <div>אין נתוני CRM לתקופה זו</div>
          </div>
        )}

        {/* ── LEADS TAB ────────────────────────────────────────────────── */}
        {hasData && tab === 'leads' && (() => {
          const namedLeads = crmReport?.summary?.namedLeads?.all || crmReport?.summary?.namedLeads || []
          if (!namedLeads || namedLeads.length === 0) return (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
              <div>אין נתוני לידים מפורטים</div>
            </div>
          )
          return (
            <div className="client-card">
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>
                רשימת לידים ({namedLeads.length})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="client-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>שם</th>
                      <th>מקור</th>
                      <th>סטטוס</th>
                      <th>פגישה</th>
                      <th>חוזה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {namedLeads.map((lead, i) => (
                      <tr key={i}>
                        <td style={{ color: '#9ca3af' }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{lead.name || '—'}</td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            background: lead.source === 'facebook' ? '#dbeafe' : lead.source === 'google' ? '#fee2e2' : '#f3f4f6',
                            color: lead.source === 'facebook' ? '#1d4ed8' : lead.source === 'google' ? '#b91c1c' : '#374151'
                          }}>
                            {lead.source === 'facebook' ? 'Facebook' : lead.source === 'google' ? 'Google' : lead.source || '—'}
                          </span>
                        </td>
                        <td>{lead.status || '—'}</td>
                        <td>{lead.hasMeeting ? '✓' : '—'}</td>
                        <td>{lead.hasContract ? <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}

      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '32px 0 20px', color: '#9ca3af', fontSize: 12 }}>
        VITAS Reports · {projectName}
      </div>
    </div>
  )
}
