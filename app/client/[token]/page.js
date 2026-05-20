'use client'
import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { formatCurrency, formatNum, formatMonth, aggregateRows, aggregateCrmRows, aggregateCrmReportRows, changePercent, getPrevMonth, COLORS } from '../../../lib/helpers'
import { normalizeObjections } from '../../../lib/objection-normalize.js'
import Chart from 'chart.js/auto'


// Reusable info tooltip - click ⓘ to open a styled popover with the explanation.
function InfoTip({ text }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!e.target.closest('.info-tip-wrapper')) setOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [open])
  return (
    <span className="info-tip-wrapper" style={{ position: 'relative', display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }}>
      <span
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        style={{
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: '50%',
          background: open ? 'var(--accent)' : 'rgba(59,130,246,0.1)',
          color: open ? '#fff' : 'var(--accent)',
          fontSize: 12, fontWeight: 700, fontStyle: 'normal',
          transition: 'all 0.15s ease',
        }}
        title=""
      >i</span>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: -8,
          background: '#1e293b', color: '#f1f5f9',
          padding: '14px 16px', borderRadius: 10,
          fontSize: 13, fontWeight: 400, lineHeight: 1.6,
          width: 280, maxWidth: '90vw',
          whiteSpace: 'pre-line',
          boxShadow: '0 12px 32px rgba(15,23,42,0.25)',
          zIndex: 1000, textAlign: 'right', direction: 'rtl',
        }}>
          <div style={{
            position: 'absolute', top: -6, right: 14,
            width: 12, height: 12, background: '#1e293b',
            transform: 'rotate(45deg)',
          }}></div>
          {text.split('\\n').map((line, i, arr) => (
            <span key={i}>{line}{i < arr.length - 1 && <br/>}</span>
          ))}
        </div>
      )}
    </span>
  )
}


export default function ClientPage() {
  const params = useParams()
  const token = params.token

  const [loading, setLoading] = useState(true)
  const [client, setClient] = useState(null)
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [reports, setReports] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [error, setError] = useState(false)
  const [dashTab, setDashTab] = useState('all')
  const [crmSubTab, setCrmSubTab] = useState('sources')
  const [expandedCrmSources, setExpandedCrmSources] = useState(new Set())
  const [sortConfig, setSortConfig] = useState({})
  const chartsRef = useRef([])

  const handleSort = (tableId, key) => { setSortConfig(prev => { const cur = prev[tableId]; if (cur && cur.key === key) return {...prev, [tableId]: {key, dir: cur.dir === 'desc' ? 'asc' : 'desc'}}; return {...prev, [tableId]: {key, dir: 'desc'}}; }); }

  useEffect(() => {
    async function load() {
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('token', token)
        .single()

      if (clientError || !clientData) {
        setError(true)
        setLoading(false)
        return
      }

      setClient(clientData)

      const { data: projectsData } = await supabase
        .from('projects')
        .select('*')
        .eq('client_id', clientData.id)
        .order('created_at')

      if (projectsData && projectsData.length > 0) {
        setProjects(projectsData)
        setSelectedProject(projectsData[0])
        await loadReports(projectsData[0].id)
      }

      setLoading(false)
    }
    load()
  }, [token])

  const loadReports = async (projectId) => {
    const { data } = await supabase
      .from('reports')
      .select('*')
      .eq('project_id', projectId)
      .order('month', { ascending: false })

    if (data) {
      setReports(data)
      if (data.length > 0) setSelectedMonth(data[0].month)
    } else {
      setReports([])
    }
  }

  const switchProject = async (proj) => {
    setSelectedProject(proj)
    setCompareEnabled(false)
    setDashTab('all')
    setCrmSubTab('sources')
    await loadReports(proj.id)
  }

  const destroyCharts = () => {
    chartsRef.current.forEach(c => c.destroy())
    chartsRef.current = []
  }


  const arcLabelsPlugin = {
    id: 'arcLabels',
    afterDatasetsDraw(chart) {
      if (chart.config.type !== 'doughnut' && chart.config.type !== 'pie') return;
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data) return;
      const data = chart.data.datasets[0].data;
      const total = data.reduce((a, b) => a + (Number(b) || 0), 0);
      if (total === 0) return;
      const canvasId = chart.canvas.id || '';
      const isSpend = /spend|Spend/i.test(canvasId);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 12px Heebo, sans-serif';
      meta.data.forEach((arc, i) => {
        const val = Number(data[i]) || 0;
        if (val === 0) return;
        const pct = (val / total) * 100;
        if (pct < 4) return;
        const pos = arc.tooltipPosition();
        const valText = isSpend
          ? '₪' + Math.round(val).toLocaleString('he-IL')
          : Number.isInteger(val) ? val.toLocaleString('he-IL') : val.toFixed(1);
        const pctText = pct.toFixed(1) + '%';
        const w = Math.max(ctx.measureText(valText).width, ctx.measureText(pctText).width) + 12;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        const rx = pos.x - w / 2;
        const ry = pos.y - 17;
        const rh = 34;
        ctx.beginPath();
        const r = 6;
        ctx.moveTo(rx + r, ry);
        ctx.lineTo(rx + w - r, ry);
        ctx.quadraticCurveTo(rx + w, ry, rx + w, ry + r);
        ctx.lineTo(rx + w, ry + rh - r);
        ctx.quadraticCurveTo(rx + w, ry + rh, rx + w - r, ry + rh);
        ctx.lineTo(rx + r, ry + rh);
        ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
        ctx.lineTo(rx, ry + r);
        ctx.quadraticCurveTo(rx, ry, rx + r, ry);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#1e293b';
        ctx.fillText(valText, pos.x, pos.y - 5);
        ctx.fillStyle = '#64748b';
        ctx.font = '600 10px Heebo, sans-serif';
        ctx.fillText(pctText, pos.x, pos.y + 9);
        ctx.font = '700 12px Heebo, sans-serif';
      });
      ctx.restore();
    }
  };

  const createChart = (id, type, labels, datasets, scalesConfig) => {
    const canvas = document.getElementById(id)
    if (!canvas) return
    const config = {
      type,
      data: { labels, datasets },
      plugins: [arcLabelsPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Heebo' } } } }
      }
    }
    if (type !== 'doughnut' && type !== 'pie') {
      config.options.scales = scalesConfig || { y: { beginAtZero: true, position: 'right' } }
    }
    const chart = new Chart(canvas, config)
    chartsRef.current.push(chart)
  }

  // ==================== CRM REPORTS SUB-TAB ====================
  const renderCrmReportDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null
    destroyCharts()

    // Source data: prefer crmRepRows stored in 'crm' rows' summary (BMBY API), fallback to legacy 'crm_reports' xlsx rows
    const crmRows = reports.filter(r => r.month === selectedMonth && r.source === 'crm')
    const legacyRepRows = reports.filter(r => r.month === selectedMonth && r.source === 'crm_reports')
    let allRows = []
    crmRows.forEach(r => { if (r.summary && Array.isArray(r.summary.crmRepRows)) allRows = allRows.concat(r.summary.crmRepRows) })
    legacyRepRows.forEach(r => { if (r.data) allRows = allRows.concat(r.data) })
    if (allRows.length === 0) return <div className="welcome-center"><div className="icon">💭</div><h3>אין נתוני CRM דוחות לחודש זה</h3></div>
    const repData = aggregateCrmReportRows(allRows)

    // Top 10 cities only - clean, focused view
    const cityEntries = Object.entries(repData.cities)
      .filter(([n]) => n && n !== 'לא צוין')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
    const cityNames = cityEntries.map(([n]) => n)
    const cityCounts = cityEntries.map(([, c]) => c)

    setTimeout(() => {
      destroyCharts()
      if (cityNames.length > 0) {
        createChart('crmRepCityChart', 'bar', cityNames, [{
          label: 'לידים', data: cityCounts,
          backgroundColor: COLORS.slice(0, cityNames.length),
          borderRadius: 6,
        }], {
          y: { beginAtZero: true, position: 'right' },
          indexAxis: 'y',
        })
      }
    }, 200)

    if (cityEntries.length === 0) {
      return <div className="welcome-center"><div className="icon">🏘️</div><h3>אין נתוני יישובים לתקופה זו</h3></div>
    }

    return (
      <div className="section">
        <div className="section-title">
          <div className="section-icon" style={{background:'var(--gradient-1)'}}>🏘️</div>
          Top 10 יישובים <InfoTip text="10 הערים שמהן הגיעו הכי הרבה לידים. בסיס לבחירת אזורי גיאו-טרגטינג בקמפיינים" />
        </div>
        <div className="chart-grid" style={{gridTemplateColumns: '2fr 1fr'}}>
          <div className="chart-card"><div className="chart-container" style={{height: 400}}><canvas id="crmRepCityChart"></canvas></div></div>
          <div className="chart-card" style={{padding: '20px'}}>
            <ol style={{listStyle: 'none', padding: 0, margin: 0, fontSize: '15px'}}>
              {cityEntries.map(([name, count], i) => (
                <li key={name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',borderBottom: i < cityEntries.length-1 ? '1px solid #eee' : 'none'}}>
                  <span style={{display:'flex',alignItems:'center',gap:'10px'}}>
                    <span style={{display:'inline-block',width:24,height:24,borderRadius:'50%',background:COLORS[i] || 'var(--accent)',color:'#fff',fontSize:12,fontWeight:700,textAlign:'center',lineHeight:'24px'}}>{i + 1}</span>
                    <span style={{fontWeight: 600}}>{name}</span>
                  </span>
                  <span style={{color: 'var(--accent)', fontWeight: 700}}>{count}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    )
  }, [selectedMonth, reports])

  // ==================== CRM RESPONSE TIME SUB-TAB ====================
  const renderCrmResponseDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null
    destroyCharts()

    const crmRows = reports.filter(r => r.month === selectedMonth && r.source === 'crm')
    // Merge stats across all crm rows for this period (one per project)
    let totalLids = 0, respondedCount = 0, noResponseCount = 0
    const allMins = []
    const bucketsTotal = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 }
    const bucketsBusiness = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 }
    const bucketMeetingTotals = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 }
    const bucketMeetingWith = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 }
    const byUserMerged = {}
    const dowMerged = {}
    const bySourceMerged = {}
    for (const r of crmRows) {
      const rt = r.summary && r.summary.responseTimeStats
      if (!rt) continue
      totalLids += rt.totalLids || 0
      respondedCount += rt.respondedCount || 0
      noResponseCount += rt.noResponseCount || 0
      for (const [k, v] of Object.entries(rt.buckets || {})) bucketsTotal[(k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k] = (bucketsTotal[(k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k] || 0) + v
      const bBuckets = (rt.business && rt.business.buckets) || {}
      for (const [k, v] of Object.entries(bBuckets)) bucketsBusiness[(k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k] = (bucketsBusiness[(k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k] || 0) + v
      const bRichBuckets = (rt.business && rt.business.bucketsWithMeeting) || {}
      for (const [k, v] of Object.entries(bRichBuckets)) {
        const key = (k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k
        bucketMeetingTotals[key] = (bucketMeetingTotals[key] || 0) + (v.total || 0)
        bucketMeetingWith[key] = (bucketMeetingWith[key] || 0) + (v.withMeeting || 0)
      }
      // Day of week merge (sum across projects for the selected month)
      const dow = r.summary && r.summary.dayOfWeekStats
      if (dow) {
        for (const k of Object.keys(dow)) {
          if (!dowMerged[k]) dowMerged[k] = { name: dow[k].name, leads: 0, scheduled: 0 }
          dowMerged[k].leads += dow[k].leads || 0
          dowMerged[k].scheduled += dow[k].scheduled || 0
        }
      }
      const bUser = (rt.business && rt.business.byUser) || {}
      const bSource = (rt.business && rt.business.bySource) || {}
      for (const [k, v] of Object.entries(rt.byUser || {})) {
        if (!byUserMerged[k]) byUserMerged[k] = { count: 0, sumMinutes: 0, sumBusinessMinutes: 0 }
        byUserMerged[k].count += v.count
        byUserMerged[k].sumMinutes += v.avgMinutes * v.count
        if (bUser[k]) byUserMerged[k].sumBusinessMinutes += bUser[k].avgMinutes * bUser[k].count
      }
      for (const [k, v] of Object.entries(rt.bySource || {})) {
        if (!bySourceMerged[k]) bySourceMerged[k] = { count: 0, sumMinutes: 0, sumBusinessMinutes: 0 }
        bySourceMerged[k].count += v.count
        bySourceMerged[k].sumMinutes += v.avgMinutes * v.count
        if (bSource[k]) bySourceMerged[k].sumBusinessMinutes += bSource[k].avgMinutes * bSource[k].count
      }
    }

    if (totalLids === 0) {
      return <div className="welcome-center"><div className="icon">⏱️</div><h3>אין נתוני זמני תגובה לתקופה זו</h3></div>
    }

    const avgFromBuckets = respondedCount > 0
      ? Math.round(Object.entries(byUserMerged).reduce((s, [, v]) => s + v.sumMinutes, 0) / respondedCount)
      : 0
    const bucketLabels = ['0-15m', '15m-1h', '1h-4h', '4h-8h', '8h-1d', '1d-3d', '3d+']
    const bucketHumanLabels = ['פחות מ-15 דק׳', '15 דק׳-שעה', '1-4 שעות', '4-8 שעות', '8-24 שעות', '1-3 ימים', 'יותר מ-3 ימים']
    const bucketValues = bucketLabels.map(k => bucketsTotal[k] || 0)

    setTimeout(() => {
      destroyCharts()
      const bucketBusinessValues = bucketLabels.map(k => bucketsBusiness[k] || 0)
      const bucketMeetingValues = bucketLabels.map(k => bucketMeetingWith[k] || 0)
      const conversionRates = bucketLabels.map(k => {
        const tot = bucketMeetingTotals[k] || 0
        return tot > 0 ? Math.round((bucketMeetingWith[k] || 0) / tot * 100) : 0
      })
      createChart('responseBucketsChart', 'bar', bucketHumanLabels, [
        { label: 'מספר לידים', type: 'bar', data: bucketBusinessValues, backgroundColor: '#3b82f6', borderRadius: 6, yAxisID: 'y', order: 2 },
        { label: 'מתוכם - המירו לפגישה', type: 'bar', data: bucketMeetingValues, backgroundColor: '#10b981', borderRadius: 6, yAxisID: 'y', order: 2 },
        { label: '% המרה לפגישה', type: 'line', data: conversionRates, borderColor: '#f59e0b', backgroundColor: '#f59e0b', pointRadius: 5, pointBackgroundColor: '#f59e0b', fill: false, tension: 0.3, yAxisID: 'y1', order: 1 },
      ], {
        y: { beginAtZero: true, position: 'right', title: { display: true, text: 'מספר לידים' } },
        y1: { beginAtZero: true, position: 'left', max: 100, title: { display: true, text: '% המרה' }, grid: { drawOnChartArea: false } },
      })
    }, 200)

    // Format minutes into human label (e.g. "12h 30m" or "2d 4h")
    // Day-of-week chart data prep
    const dowOrder = ['0','1','2','3','4','5','6']
    const dowHasData = dowOrder.some(k => dowMerged[k] && dowMerged[k].leads > 0)
    if (dowHasData) {
      setTimeout(() => {
        const labels = dowOrder.map(k => (dowMerged[k] && dowMerged[k].name) || k)
        const leadsData = dowOrder.map(k => (dowMerged[k] && dowMerged[k].leads) || 0)
        const schedData = dowOrder.map(k => (dowMerged[k] && dowMerged[k].scheduled) || 0)
        const conv = dowOrder.map(k => {
          const ld = (dowMerged[k] && dowMerged[k].leads) || 0
          const sc = (dowMerged[k] && dowMerged[k].scheduled) || 0
          return ld > 0 ? Math.round(sc / ld * 100) : 0
        })
        createChart('dowChart', 'bar', labels, [
          { label: 'לידים', type: 'bar', data: leadsData, backgroundColor: '#3b82f6', borderRadius: 6, yAxisID: 'y', order: 2 },
          { label: 'מתוכם - המירו לפגישה', type: 'bar', data: schedData, backgroundColor: '#10b981', borderRadius: 6, yAxisID: 'y', order: 2 },
          { label: '% המרה לפגישה', type: 'line', data: conv, borderColor: '#f59e0b', backgroundColor: '#f59e0b', pointRadius: 5, fill: false, tension: 0.3, yAxisID: 'y1', order: 1 },
        ], {
          y: { beginAtZero: true, position: 'right', title: { display: true, text: 'כמות' } },
          y1: { beginAtZero: true, position: 'left', max: 100, title: { display: true, text: '% המרה' }, grid: { drawOnChartArea: false } },
        })
      }, 300)
    }

    const fmt = (mn) => {
      if (mn == null) return '-'
      if (mn < 1) return 'מיידי'
      if (mn < 60) return mn + ' דק׳'
      if (mn < 1440) return Math.floor(mn / 60) + ' ש׳ ' + (mn % 60) + ' דק׳'
      const d = Math.floor(mn / 1440)
      const h = Math.floor((mn % 1440) / 60)
      return d + ' ימים' + (h ? ' ' + h + ' ש׳' : '')
    }

    // Compute aggregate avg/median directly from bucket distribution? No, use the summed sumMinutes/count.
    const overallAvgMin = respondedCount > 0
      ? Math.round(Object.values(byUserMerged).reduce((s, v) => s + v.sumMinutes, 0) / respondedCount)
      : 0
    const overallBusinessMin = respondedCount > 0
      ? Math.round(Object.values(byUserMerged).reduce((s, v) => s + (v.sumBusinessMinutes || 0), 0) / respondedCount)
      : 0

    // User list, sorted by count desc
    const userList = Object.entries(byUserMerged)
      .filter(([, v]) => v.count > 0)
      .map(([name, v]) => ({ name, count: v.count, avg: Math.round(v.sumMinutes / v.count), bizAvg: Math.round((v.sumBusinessMinutes || 0) / v.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const sourceList = Object.entries(bySourceMerged)
      .filter(([, v]) => v.count >= 3)
      .map(([name, v]) => ({ name, count: v.count, avg: Math.round(v.sumMinutes / v.count), bizAvg: Math.round((v.sumBusinessMinutes || 0) / v.count) }))
      .sort((a, b) => b.bizAvg - a.bizAvg)
      .slice(0, 10)

    return (
      <>
        <div className="kpi-grid" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))'}}>
          <div className="kpi-card"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(59,130,246,0.1)',color:'var(--accent)'}}>📊</div><div className="kpi-label">סה"כ לידים <InfoTip text="כמות הלידים החדשים (LID) שנכנסו ב-BMBY בתקופה הנבחרת. כל LID נספר פעם אחת - ספירה אחרי ניכוי כפילויות." /></div><div className="kpi-value">{totalLids}</div></div>
          <div className="kpi-card green"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(16,185,129,0.1)',color:'var(--success)'}}>✓</div><div className="kpi-label">קיבלו מענה <InfoTip text="לידים שאיש מכירות אנושי חזר אליהם (יצר משימה, שיחה, פעולה במערכת). תגובות אוטומטיות של BMBY (Update Info Lead) לא נספרות." /></div><div className="kpi-value">{respondedCount}</div></div>
          <div className="kpi-card orange"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(245,158,11,0.1)',color:'var(--warning)'}}>⏱️</div><div className="kpi-label">זמן מענה ממוצע <InfoTip text="ממוצע הזמן שלוקח לאיש מכירות אנושי לחזור לליד חדש. מדידה בשעות עסקים בלבד - א-ה 09:00-19:00, שישי 09:00-13:00, ללא שבת וחגי ישראל." /></div><div className="kpi-value">{fmt(overallBusinessMin)}</div></div>
          <div className="kpi-card purple"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(139,92,246,0.1)',color:'var(--purple)'}}>⚠️</div><div className="kpi-label">בלי מענה <InfoTip text="לידים שאף איש מכירות אנושי לא חזר אליהם - או שרק BMBY השיב אוטומטית, או שלא נרשמה אף פעולה. דורש מעקב." /></div><div className="kpi-value">{noResponseCount}</div></div>
        </div>

        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>📈</div>התפלגות זמני תגובה <InfoTip text="התפלגות זמני התגובה הראשונים של אנשי המכירות לכל ליד שנכנס.\n\nשיטת חישוב: בשעות עסקים בלבד - א-ה 09:00-19:00, שישי 09:00-13:00. שבת וחגי ישראל לא נספרים." /></div>
          <div className="chart-card"><div className="chart-container" style={{height: 320}}><canvas id="responseBucketsChart"></canvas></div></div>
        </div>

        {dowHasData && (
          <div className="section">
            <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-3)' || 'var(--gradient-2)'}}>📅</div>פילוח לפי יום בשבוע <InfoTip text="כמה לידים נכנסו בכל יום בשבוע, ומתוכם כמה בסופו של דבר המירו לפגישה.\n\nחשוב: המדידה היא לפי יום כניסת הליד, לא לפי יום קביעת הפגישה. דוגמה - ליד שהגיע בשבת ואחר כך נקבעה לו פגישה ביום שני, נספר תחת 'שבת'.\n\nשימושי לזיהוי באיזה יום מגיע הקהל הכי איכותי, ולתזמון של תקציבי קמפיינים." /></div>
            <div className="chart-card"><div className="chart-container" style={{height: 320}}><canvas id="dowChart"></canvas></div></div>
          </div>
        )}

        <div className="chart-grid" style={{gridTemplateColumns: '1fr 1fr'}}>
          <div className="section">
            <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-2)'}}>👤</div>זמן מענה לפי איש מכירות <InfoTip text="ממוצע הזמן שלוקח לכל איש מכירות לחזור ללידים החדשים שלו. מספרים קטנים = תגובה מהירה.\n\nשיטת חישוב: בשעות עסקים בלבד - א-ה 09:00-19:00, שישי 09:00-13:00. שבת וחגי ישראל לא נספרים." /></div>
            <div className="chart-card" style={{padding:'10px'}}>
              <table className="data-table">
                <thead><tr><th>איש מכירות</th><th>לידים</th><th>זמן מענה ממוצע</th></tr></thead>
                <tbody>
                  {userList.map(u => (
                    <tr key={u.name}>
                      <td style={{fontWeight:600}}>{u.name}</td>
                      <td>{u.count}</td>
                      <td style={{fontWeight:600,color:'var(--accent)'}}>{fmt(u.bizAvg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="section">
            <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-3)' || 'var(--gradient-2)'}}>📡</div>הכי איטיים - לפי מקור <InfoTip text="המקורות מסודרים מהאיטי ביותר למהיר ביותר. עוזר לזהות איזה מקור מקבל טיפול לקוי.\n\nשיטת חישוב: בשעות עסקים בלבד - א-ה 09:00-19:00, שישי 09:00-13:00. שבת וחגי ישראל לא נספרים." /></div>
            <div className="chart-card" style={{padding:'10px'}}>
              <table className="data-table">
                <thead><tr><th>מקור</th><th>לידים</th><th>זמן מענה ממוצע</th></tr></thead>
                <tbody>
                  {sourceList.map(s => (
                    <tr key={s.name}>
                      <td style={{fontWeight:600,fontSize:13}}>{s.name}</td>
                      <td>{s.count}</td>
                      <td style={{fontWeight:600,color:'var(--accent)'}}>{fmt(s.bizAvg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </>
    )
  }, [selectedMonth, reports])

  // ==================== CRM OBJECTIONS SUB-TAB ====================
  const renderCrmObjectionsDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null
    destroyCharts()

    const crmRows = reports.filter(r => r.month === selectedMonth && r.source === 'crm')
    let allRows = []
    crmRows.forEach(r => { if (r.summary && Array.isArray(r.summary.crmRepRows)) allRows = allRows.concat(r.summary.crmRepRows) })

    // Split + normalize objections per row, count each canonical label
    const objCounts = {}
    let rowsWithObjection = 0
    for (const row of allRows) {
      const objs = normalizeObjections(row.objections || '')
      if (objs.length > 0) rowsWithObjection++
      for (const o of objs) objCounts[o] = (objCounts[o] || 0) + 1
    }

    const objEntries = Object.entries(objCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    const total = objEntries.reduce((s, [, c]) => s + c, 0)

    if (objEntries.length === 0) {
      return <div className="welcome-center"><div className="icon">🚫</div><h3>אין נתוני התנגדויות לתקופה זו</h3></div>
    }

    const topNames = objEntries.map(([n]) => n)
    const topCounts = objEntries.map(([, c]) => c)

    setTimeout(() => {
      destroyCharts()
      createChart('crmObjChart', 'doughnut', topNames, [{
        data: topCounts,
        backgroundColor: COLORS.slice(0, topNames.length),
      }])
    }, 200)

    return (
      <div className="section">
        <div className="section-title">
          <div className="section-icon" style={{background:'var(--gradient-2)'}}>🚫</div>
          התנגדויות לידים <InfoTip text="10 הסיבות הנפוצות ביותר שלידים לא ממשיכים בתהליך. עוזר לזהות חסמי מכירה ולהתאים את המסר" /> ({rowsWithObjection} מתוך {allRows.length})
        </div>
        <div className="chart-grid" style={{gridTemplateColumns: '1fr 1fr'}}>
          <div className="chart-card"><div className="chart-container" style={{height: 400}}><canvas id="crmObjChart"></canvas></div></div>
          <div className="chart-card" style={{padding: '20px'}}>
            <ol style={{listStyle: 'none', padding: 0, margin: 0, fontSize: '14px'}}>
              {objEntries.map(([name, count], i) => {
                const pct = total > 0 ? (count / total * 100) : 0
                return (
                  <li key={name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',borderBottom: i < objEntries.length-1 ? '1px solid #eee' : 'none'}}>
                    <span style={{display:'flex',alignItems:'center',gap:'10px'}}>
                      <span style={{display:'inline-block',width:12,height:12,borderRadius:'3px',background:COLORS[i] || 'var(--accent)'}}></span>
                      <span style={{fontWeight: 600}}>{name}</span>
                    </span>
                    <span style={{color: 'var(--accent)', fontWeight: 700}}>{count} <span style={{color:'#888',fontWeight:400,fontSize:12}}>({pct.toFixed(0)}%)</span></span>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      </div>
    )
  }, [selectedMonth, reports])

  // ==================== CRM SOURCES SUB-TAB ====================
  const renderCrmDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null
    destroyCharts()

    const crmReports = reports.filter(r => r.month === selectedMonth && r.source === 'crm')
    if (crmReports.length === 0) return <div className="welcome-center"><div className="icon">💭</div><h3>אין נתוני CRM לחודש זה</h3></div>

    let allCrmRows = []
    crmReports.forEach(r => { if (r.data) allCrmRows = allCrmRows.concat(r.data) })
    const crmData = aggregateCrmRows(allCrmRows)

    // Merge Facebook campaign sources into single 'Facebook' entry - children kept for drill-down
    const _fbCrmKeys = Object.keys(crmData.sources).filter(k => k.includes('פייסבוק') || k.toLowerCase().includes('facebook'))
    if (_fbCrmKeys.length > 0) {
      const _fbMerged = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0, children: [] }
      _fbCrmKeys.forEach(k => { Object.keys(_fbMerged).forEach(f => { if (f === 'children') return; _fbMerged[f] += crmData.sources[k][f] || 0 }); _fbMerged.children.push({ name: k, ...crmData.sources[k] }); delete crmData.sources[k] })
      crmData.sources['Facebook'] = _fbMerged
    }
    // Merge Google campaign sources into single 'Google' entry - children kept for drill-down
    const _gCrmKeys = Object.keys(crmData.sources).filter(k => k.includes('גוגל') || k.toLowerCase().includes('google'))
    if (_gCrmKeys.length > 0) {
      const _gMerged = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0, children: [] }
      _gCrmKeys.forEach(k => { Object.keys(_gMerged).forEach(f => { if (f === 'children') return; _gMerged[f] += crmData.sources[k][f] || 0 }); _gMerged.children.push({ name: k, ...crmData.sources[k] }); delete crmData.sources[k] })
      crmData.sources['Google'] = _gMerged
    }

    // Add platform leads to CRM totals
    let _platformSpend = 0
    const _fbR = reports.filter(r => r.month === selectedMonth && r.source === 'facebook')
    const _gR = reports.filter(r => r.month === selectedMonth && r.source && r.source.startsWith('google'))
    const _emptySource = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0 }
    if (_fbR.length > 0) {
      let _fbRows = []; _fbR.forEach(r => { if (r.data) _fbRows = _fbRows.concat(r.data) })
      const _fbAgg = aggregateRows(_fbRows)
      _platformSpend += _fbAgg.totals.spend || 0
      const _fbLeads = _fbAgg.totals.leads || 0
      if (!crmData.sources['Facebook']) {
        crmData.totals.totalLeads += _fbLeads
        crmData.sources['Facebook'] = { ..._emptySource, totalLeads: _fbLeads }
      } else {
        crmData.totals.totalLeads -= (crmData.sources['Facebook'].totalLeads || 0)
        crmData.totals.totalLeads += _fbLeads
      }
    }
    if (_gR.length > 0) {
      let _gRows = []; _gR.forEach(r => { if (r.data) _gRows = _gRows.concat(r.data) })
      const _gAgg = aggregateRows(_gRows)
      _platformSpend += _gAgg.totals.spend || 0
      const _gLeads = _gAgg.totals.leads || 0
      if (!crmData.sources['Google']) {
        crmData.totals.totalLeads += _gLeads
        crmData.sources['Google'] = { ..._emptySource, totalLeads: _gLeads }
      } else {
        crmData.totals.totalLeads -= (crmData.sources['Google'].totalLeads || 0)
        crmData.totals.totalLeads += _gLeads
      }
    }

    let prevCrmData = null
    if (compareEnabled) {
      const prevMonth = getPrevMonth(selectedMonth)
      const prevCrmReports = reports.filter(r => r.month === prevMonth && r.source === 'crm')
      if (prevCrmReports.length > 0) {
        let prevRows = []
        prevCrmReports.forEach(r => { prevRows = prevRows.concat(r.data || []) })
        prevCrmData = aggregateCrmRows(prevRows)
      }
    }

    const ct = crmData.totals
    const cp = prevCrmData?.totals

    const crmKpi = (label, value, color, current, prev, isCost) => {
      const ch = prev != null ? changePercent(current, prev, isCost) : null
      const icons = { 'סה"כ לידים': 'בש', 'רלוונטיים': '✅', 'לא רלוונטיים': '❌', 'פגישות שתואמו': 'פג', 'פגישות שבוצעו': 'שט', 'פגישות שבוטלו': 'בט', 'הרשמות': 'הר', 'שווי הרשמות': '₪', 'חוזים': 'חז', 'שווי חוזים': '₪', 'אחוז המרה לפגישה שתואמה': '%', 'אחוז המרה לפגישות שבוצעו': '%', '% רלוונטיות': '%', 'עלות פגישה שבוצעה': '₪' }
      const icon = icons[label] || ''
      const kpiColors = { green: 'rgba(16,185,129,0.1)', purple: 'rgba(139,92,246,0.1)', orange: 'rgba(245,158,11,0.1)', pink: 'rgba(236,72,153,0.1)', cyan: 'rgba(6,182,212,0.1)', red: 'rgba(239,68,68,0.1)' }
      const kpiTextColors = { green: 'var(--success)', purple: 'var(--purple)', orange: 'var(--warning)', pink: 'var(--pink)', cyan: 'var(--cyan)', red: 'var(--danger)' }
      return <div className={`kpi-card ${color}`} key={label}><div className="kpi-accent"></div><div className="kpi-icon" style={{background: kpiColors[color] || 'rgba(59,130,246,0.1)', color: kpiTextColors[color] || 'var(--accent)'}}>{icon}</div><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{ch && <div className={`kpi-change ${ch.isGood ? 'up' : 'down'}`}><span className="arrow">{ch.pct > 0 ? '▲' : '▼'}</span> {Math.abs(ch.pct).toFixed(1)}%</div>}</div>
    }

    const sourceEntries = Object.entries(crmData.sources).sort((a, b) => b[1].totalLeads - a[1].totalLeads)
    const sourceNames = sourceEntries.map(([name]) => name)

    setTimeout(() => {
      destroyCharts()
      if (sourceNames.length > 0) {
        createChart('crmPieChart', 'doughnut', sourceNames, [{
          data: sourceNames.map(n => crmData.sources[n].totalLeads),
          backgroundColor: COLORS.slice(0, sourceNames.length)
        }])
      }
    }, 200)

    return (
      <>
        <div className="kpi-grid">
          {crmKpi('סה"כ לידים', formatNum(ct.totalLeads), '', ct.totalLeads, cp?.totalLeads)}
          {crmKpi('רלוונטיים', formatNum(ct.relevantLeads), 'green', ct.relevantLeads, cp?.relevantLeads)}
          {crmKpi('לא רלוונטיים', formatNum(ct.irrelevantLeads), 'red', ct.irrelevantLeads, cp?.irrelevantLeads, true)}
          {crmKpi('% רלוונטיות', ct.relevantRate.toFixed(1) + '%', 'cyan', ct.relevantRate, cp?.relevantRate)}
          {crmKpi('פגישות שתואמו', formatNum(ct.meetingsScheduled), 'purple', ct.meetingsScheduled, cp?.meetingsScheduled)}
          {crmKpi('פגישות שבוצעו', formatNum(ct.meetingsCompleted), 'orange', ct.meetingsCompleted, cp?.meetingsCompleted)}
          {crmKpi('אחוז המרה לפגישה שתואמה', ct.scheduledRate.toFixed(1) + '%', 'pink', ct.scheduledRate, cp?.scheduledRate)}
          {crmKpi('אחוז המרה לפגישות שבוצעו', ct.completedRate.toFixed(1) + '%', '', ct.completedRate, cp?.completedRate)}
          {crmKpi('עלות פגישה שבוצעה', ct.meetingsCompleted > 0 ? formatCurrency(_platformSpend / ct.meetingsCompleted) : '₪0', 'purple', 0, 0)}
          {crmKpi('פגישות שבוטלו', formatNum(ct.meetingsCancelled), 'red', ct.meetingsCancelled, cp?.meetingsCancelled, true)}
          {crmKpi('הרשמות', formatNum(ct.registrations), 'green', ct.registrations, cp?.registrations)}
          {crmKpi('שווי הרשמות', formatCurrency(ct.registrationValue), 'purple', ct.registrationValue, cp?.registrationValue)}
          {crmKpi('חוזים', formatNum(ct.contracts), 'cyan', ct.contracts, cp?.contracts)}
          {crmKpi('שווי חוזים', formatCurrency(ct.contractValue), 'orange', ct.contractValue, cp?.contractValue)}
        </div>

        {/* CRM Funnel */}
        <div className="section">
          <div className="section-header" style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'20px'}}>
            <div className="section-icon" style={{background:'var(--gradient-2)'}}>🗂️</div>
            <div><h2 style={{fontSize:'1.3em',fontWeight:700,color:'var(-pprimary)',margin:0}}>משפך לידים</h2><div style={{fontSize:'0.85em',color:'var(--text-secondary)'}}>מליד ועד חוזה</div></div>
          </div>
          <div className="card" style={{padding:'24px'}}>
            <div className="funnel">
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-1)'}}>{formatNum(ct.totalLeads)}</div><div className="funnel-label">סה"כ לידים</div></div>
              <div className="funnel-arrow">←</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--accent)',opacity:0.85}}>{formatNum(ct.relevantLeads)}</div><div className="funnel-label">רלוונטיים</div><div className="funnel-rate">{ct.relevantRate.toFixed(1)}%</div></div>
              <div className="funnel-arrow">←</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(-ppurple)'}}>{formatNum(ct.meetingsScheduled)}</div><div className="funnel-label">תואמו</div><div className="funnel-rate">{ct.scheduledRate.toFixed(1)}%</div></div>
              <div className="funnel-arrow">←</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-2)'}}>{formatNum(ct.meetingsCompleted)}</div><div className="funnel-label">בוצעו</div><div className="funnel-rate">{ct.completedRate.toFixed(1)}%</div></div>
              <div className="funnel-arrow">←</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-4)'}}>{formatNum(ct.registrations)}</div><div className="funnel-label">הרשמות</div></div>
              <div className="funnel-arrow">←</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-3)'}}>{formatNum(ct.contracts)}</div><div className="funnel-label">חוזים</div></div>
            </div>
            <div style={{textAlign:'center',marginTop:'10px',fontSize:'0.85em',color:'var(--text-secondary)'}}>
              שווי הרשמות: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(ct.registrationValue)}</strong> &nbsp;|&nbsp; שווי חוזים: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(ct.contractValue)}</strong>
            </div>
          </div>
        </div>

        {/* CRM Table by Source */}
        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>📊</div>נתונים לפי מקור הגעה <InfoTip text="פירוט לידים, רלוונטיים, פגישות וחוזים לפי מקור (פייסבוק/גוגל/יד2). הבסיס לחישוב ROI פר מקור" /></div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr>
                <th>מקור</th>
                <th>סה"כ לידים</th>
                <th>רלוונטיים</th>
                <th>לא רלוונטיים</th>
                <th>תואמו</th>
                <th>% תיאום</th>
                <th>בוצעו</th>
                <th>% ביצוע</th>
                <th>בוטלו</th>
                <th>הרשמות</th>
                <th>שווי הרשמות</th>
                <th>חוזים</th>
                <th>שווי חוזים</th>
              </tr></thead>
              <tbody>
                {sourceEntries.map(([name, d]) => {
                  const schedRate = d.totalLeads > 0 ? (d.meetingsScheduled / d.totalLeads * 100).toFixed(1) : '0.0'
                  const compRate = d.totalLeads > 0 ? (d.meetingsCompleted / d.totalLeads * 100).toFixed(1) : '0.0'
                  const children = Array.isArray(d.children) ? d.children : []
                  const hasChildren = children.length > 0
                  const isOpen = expandedCrmSources.has(name)
                  const toggle = () => setExpandedCrmSources(prev => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next })
                  return (<Fragment key={name}>
                    <tr style={hasChildren ? {cursor:'pointer'} : undefined} onClick={hasChildren ? toggle : undefined}>
                      <td style={{fontWeight:600,whiteSpace:'nowrap'}}>
                        {hasChildren && <span style={{display:'inline-block',width:'18px',color:'var(--accent)',userSelect:'none'}}>{isOpen ? '▼' : '◀'}</span>}
                        {name}
                        {hasChildren && <span style={{color:'#94a3b8',fontWeight:400,fontSize:'0.85em',marginRight:'6px'}}>({children.length})</span>}
                      </td>
                      <td>{formatNum(d.totalLeads)}</td>
                      <td>{formatNum(d.relevantLeads)}</td>
                      <td>{formatNum(d.irrelevantLeads)}</td>
                      <td>{formatNum(d.meetingsScheduled)}</td>
                      <td>{schedRate}%</td>
                      <td>{formatNum(d.meetingsCompleted)}</td>
                      <td>{compRate}%</td>
                      <td>{formatNum(d.meetingsCancelled)}</td>
                      <td>{formatNum(d.registrations)}</td>
                      <td>{formatCurrency(d.registrationValue)}</td>
                      <td>{formatNum(d.contracts)}</td>
                      <td>{formatCurrency(d.contractValue)}</td>
                    </tr>
                    {hasChildren && isOpen && children.map(ch => {
                      const cSched = ch.totalLeads > 0 ? (ch.meetingsScheduled / ch.totalLeads * 100).toFixed(1) : '0.0'
                      const cComp  = ch.totalLeads > 0 ? (ch.meetingsCompleted / ch.totalLeads * 100).toFixed(1) : '0.0'
                      return (
                        <tr key={`${name}::${ch.name}`} style={{background:'var(--bg-secondary)',fontSize:'0.92em'}}>
                          <td style={{paddingRight:'42px',color:'#475569',unicodeBidi:'plaintext'}}>{ch.name}</td>
                          <td>{formatNum(ch.totalLeads)}</td>
                          <td>{formatNum(ch.relevantLeads)}</td>
                          <td>{formatNum(ch.irrelevantLeads)}</td>
                          <td>{formatNum(ch.meetingsScheduled)}</td>
                          <td>{cSched}%</td>
                          <td>{formatNum(ch.meetingsCompleted)}</td>
                          <td>{cComp}%</td>
                          <td>{formatNum(ch.meetingsCancelled)}</td>
                          <td>{formatNum(ch.registrations)}</td>
                          <td>{formatCurrency(ch.registrationValue)}</td>
                          <td>{formatNum(ch.contracts)}</td>
                          <td>{formatCurrency(ch.contractValue)}</td>
                        </tr>)
                    })}
                  </Fragment>)
                })}
                <tr style={{fontWeight:700,background:'var(--bg-secondary)'}}>
                  <td>סה"כ</td>
                  <td>{formatNum(ct.totalLeads)}</td>
                  <td>{formatNum(ct.relevantLeads)}</td>
                  <td>{formatNum(ct.irrelevantLeads)}</td>
                  <td>{formatNum(ct.meetingsScheduled)}</td>
                  <td>{ct.scheduledRate.toFixed(1)}%</td>
                  <td>{formatNum(ct.meetingsCompleted)}</td>
                  <td>{ct.completedRate.toFixed(1)}%</td>
                  <td>{formatNum(ct.meetingsCancelled)}</td>
                  <td>{formatNum(ct.registrations)}</td>
                  <td>{formatCurrency(ct.registrationValue)}</td>
                  <td>{formatNum(ct.contracts)}</td>
                  <td>{formatCurrency(ct.contractValue)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* CRM Charts */}
        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-2)'}}>📈</div>גרפים <InfoTip text="הצגה ויזואלית של ההמרות, האיכות, וההתפלגות לפי מקור" /></div>
          <div className="chart-grid" style={{gridTemplateColumns: '1fr'}}>
            <div className="chart-card"><h4>🧩 התפלגות לידים</h4><div className="chart-container"><canvas id="crmPieChart"></canvas></div></div>
          </div>
        </div>
      </>
    )
  }, [selectedMonth, compareEnabled, reports, expandedCrmSources])

  // ==================== MAIN DASHBOARD (all/facebook/google tabs) ====================
  const renderDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null
    destroyCharts()

    const currentReports = reports.filter(r => r.month === selectedMonth)
    if (currentReports.length === 0) return <div className="welcome-center"><div className="icon">📭</div><h3>אין נתונים לחודש זה</h3></div>

    const displayReports = dashTab === 'all'
      ? currentReports.filter(r => r.source !== 'crm' && r.source !== 'crm_reports')
      : dashTab === 'facebook'
      ? currentReports.filter(r => r.source === 'facebook')
      : dashTab === 'google_pmax'
      ? currentReports.filter(r => r.source === 'google_pmax')
      : dashTab === 'google_search'
      ? currentReports.filter(r => r.source === 'google_search')
      : dashTab === 'google'
      ? currentReports.filter(r => r.source && r.source.startsWith('google'))
      : []
    const isPmax = dashTab === 'google_pmax' || dashTab === 'google'

    let allRows = []
    displayReports.forEach(r => { if (r.data) allRows = allRows.concat(r.data) })
    const data = aggregateRows(allRows)

    // Add CRM leads to "all" tab totals
    let crmTotalLeads = 0
    if (dashTab === 'all') {
      const crmReports = currentReports.filter(r => r.source === 'crm')
      crmReports.forEach(r => {
        if (r.data) {
          r.data.forEach(row => {
            // Skip rows whose source already counted via Meta/Google API (avoid double-counting in 'All' tab)
            const src = String(row.source || '').toLowerCase()
            if (/פייסבוק|facebook|fb\b|מטא/.test(src)) return
            if (/גוגל|google|pmax|search|adwords/.test(src)) return
            crmTotalLeads += (typeof row.totalLeads === 'number' ? row.totalLeads : parseFloat(String(row.totalLeads).replace(/[^0-9.\-]/g, '')) || 0)
          })
        }
      })
    }

    // Extract CRM totals for KPI display.
    // 'all' tab → unfiltered CRM totals.
    // FB/Google tabs → CRM rows filtered to platform-matching sources.
    let crmTotals = null
    {
      const crmReps = currentReports.filter(r => r.source === 'crm')
      if (crmReps.length > 0) {
        let allCrmR = []
        crmReps.forEach(r => { if (r.data) allCrmR = allCrmR.concat(r.data) })
        let filteredR = allCrmR
        if (dashTab === 'facebook') {
          filteredR = allCrmR.filter(r => /פייסבוק|facebook/i.test(r.source || ''))
        } else if (dashTab === 'google' || dashTab === 'google_pmax' || dashTab === 'google_search') {
          filteredR = allCrmR.filter(r => /גוגל|google|pmax|search/i.test(r.source || ''))
        }
        if (filteredR.length > 0) crmTotals = aggregateCrmRows(filteredR).totals
      }
    }

    let prevData = null
    if (compareEnabled) {
      const prevMonth = getPrevMonth(selectedMonth)
      const prevReports = reports.filter(r => r.month === prevMonth)
      const displayPrev = dashTab === 'all'
        ? prevReports.filter(r => r.source !== 'crm')
        : dashTab === 'facebook'
        ? prevReports.filter(r => r.source === 'facebook')
        : dashTab === 'google_pmax'
        ? prevReports.filter(r => r.source === 'google_pmax')
        : dashTab === 'google_search'
        ? prevReports.filter(r => r.source === 'google_search')
        : prevReports.filter(r => r.source && r.source.startsWith('google'))
      if (displayPrev.length) { let prevRows = []; displayPrev.forEach(r => { prevRows = prevRows.concat(r.data || []) }); prevData = aggregateRows(prevRows) }
    }

    const allMonths = [...new Set(reports.map(r => r.month))].sort()
    const trendData = allMonths.map(m => {
      let mRows = []
      reports.filter(r => r.month === m && r.source !== 'crm' && r.source !== 'crm_reports').forEach(r => { mRows = mRows.concat(r.data || []) })
      return { month: m, ...aggregateRows(mRows).totals }
    })

    const t = data.totals
    const p = prevData?.totals

    const kpiIcons = {}
    const kpiColors = { green: 'rgba(16,185,129,0.1)', purple: 'rgba(139,92,246,0.1)', orange: 'rgba(245,158,11,0.1)', pink: 'rgba(236,72,153,0.1)', cyan: 'rgba(6,182,212,0.1)', red: 'rgba(239,68,68,0.1)' }
    const kpiTextColors = { green: 'var(--success)', purple: 'var(--purple)', orange: 'var(--warning)', pink: 'var(--pink)', cyan: 'var(--cyan)', red: 'var(--danger)' }

    const kpi = (label, value, color, current, prev, isCost) => {
      const ch = prev != null ? changePercent(current, prev, isCost) : null
      const icon = kpiIcons[label] || ''
      return <div className={`kpi-card ${color}`} key={label}><div className="kpi-accent"></div><div className="kpi-icon" style={{background: kpiColors[color] || 'rgba(59,130,246,0.1)', color: kpiTextColors[color] || 'var(--accent)'}}>{icon}</div><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{ch && <div className={`kpi-change ${ch.isGood ? 'up' : 'down'}`}><span className="arrow">{ch.pct > 0 ? '▲' : '▼'}</span> {Math.abs(ch.pct).toFixed(1)}%</div>}</div>
    }

    const buildTable = (items, prevItems, labelName, tableId) => {
      if (!items || Object.keys(items).length === 0) return null
      const cols = [{key:'name',label:labelName,get:(_,n)=>n},{key:'clicks',label:'קליקים',get:d=>d.clicks,higher:true},{key:'impressions',label:'חשיפות',get:d=>d.impressions,higher:true},{key:'cpc',label:'עלות לקליק',get:d=>d.clicks>0?d.spend/d.clicks:0,higher:false},{key:'ctr',label:'CTR',get:d=>d.impressions>0?(d.clicks/d.impressions*100):0,higher:true},{key:'cpm',label:'CPM',get:d=>d.impressions>0?(d.spend/d.impressions*1000):0,higher:false},{key:'leads',label:'לידים',get:d=>d.leads,higher:true},{key:'cpl',label:'עלות לליד',get:d=>d.leads>0?d.spend/d.leads:0,higher:false},{key:'spend',label:'תקציב שנוצל',get:d=>d.spend}]
      const sc = sortConfig[tableId]
      let entries = Object.entries(items)
      if (sc) { const col = cols.find(c=>c.key===sc.key); if(col){entries.sort((a,b)=>{const va=col.get(a[1],a[0]),vb=col.get(b[1],b[0]);if(typeof va==='string')return sc.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);return sc.dir==='asc'?va-vb:vb-va;});}} else { entries.sort((a, b) => b[1].spend - a[1].spend) }
      const showCh = compareEnabled && prevItems
      const ch = (cur, prev, isCost) => {
        if (!showCh || prev == null) return null
        const pct = changePercent(cur, prev, isCost)
        if (!pct) return null
        const isPos = isCost ? pct.pct < 0 : pct.pct > 0
        return <span className={`change-badge ${isPos ? 'positive' : 'negative'}`}>{pct.pct > 0 ? '▲' : '▼'} {Math.abs(pct.pct).toFixed(1)}%</span>
      }
      const sortIcon = (key) => { if(!sc||sc.key!==key) return ' ⇅'; return sc.dir==='desc'?' ▼':' ▲' }
      const thStyle = {cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}
      const extremes = {}
      cols.forEach(c => { if (c.key === 'name' || c.key === 'spend') return; const vals = entries.map(([n,d]) => c.get(d,n)).filter(v => typeof v === 'number' && v > 0); if (vals.length < 2) return; extremes[c.key] = {min: Math.min(...vals), max: Math.max(...vals)} })
      const cellBg = (key, val) => { const e = extremes[key]; if (!e || val <= 0 || e.min === e.max) return {}; const col = cols.find(c=>c.key===key); if (!col || col.higher === undefined) return {}; if (val === e.max) return col.higher ? {color:'#059669',fontWeight:700} : {color:'#dc2626',fontWeight:700}; if (val === e.min) return col.higher ? {color:'#dc2626',fontWeight:700} : {color:'#059669',fontWeight:700}; return {} }
      return (<div className="table-wrapper"><table className="data-table"><thead><tr>{cols.map(c=>(<th key={c.key} style={thStyle} onClick={()=>handleSort(tableId,c.key)}>{c.label}{sortIcon(c.key)}</th>))}</tr></thead><tbody>{entries.map(([name, d]) => { const cpl = d.leads > 0 ? d.spend / d.leads : 0; const cpc = d.clicks > 0 ? d.spend / d.clicks : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; const cplClass = cpl > 0 && cpl < 80 ? 'tag-green' : cpl < 120 ? 'tag-blue' : cpl < 150 ? 'tag-purple' : 'tag-red'; return (<tr key={name}><td style={{fontWeight: 600}}>{name}</td><td style={cellBg('clicks',d.clicks)}>{formatNum(d.clicks)} {ch(d.clicks, prevItems?.[name]?.clicks, false)}</td><td style={cellBg('impressions',d.impressions)}>{formatNum(d.impressions)} {ch(d.impressions, prevItems?.[name]?.impressions, false)}</td><td style={cellBg('cpc',cpc)}>{formatCurrency(cpc)} {ch(cpc, prevItems?.[name]?.clicks > 0 ? prevItems[name].spend/prevItems[name].clicks : null, true)}</td><td style={cellBg('ctr',ctr)}>{ctr.toFixed(2)}%</td><td style={cellBg('cpm',cpm)}>{formatCurrency(cpm)}</td><td style={cellBg('leads',d.leads)}>{d.leads} {ch(d.leads, prevItems?.[name]?.leads, false)}</td><td style={cellBg('cpl',cpl)}><span className={`cpl-tag ${cplClass}`}>{formatCurrency(cpl)}</span></td><td>{formatCurrency(d.spend)} {ch(d.spend, prevItems?.[name]?.spend, true)}</td></tr>) })}</tbody></table></div>)
    }

    setTimeout(() => {
      destroyCharts()
      if (trendData.length > 1) {
        const labels = trendData.map(d => formatMonth(d.month))
        createChart('trendLeads', 'bar', labels, [{ label: 'Leads', data: trendData.map(d => d.leads), backgroundColor: 'rgba(59,130,246,0.7)', yAxisID: 'y' }, { label: 'CPL', data: trendData.map(d => d.cpl), borderColor: '#ef4444', type: 'line', yAxisID: 'y1', tension: 0.3, pointRadius: 5 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } })
        createChart('trendSpend', 'bar', labels, [{ label: 'Budget', data: trendData.map(d => d.spend), backgroundColor: 'rgba(139,92,246,0.7)', yAxisID: 'y' }, { label: 'Impressions', data: trendData.map(d => d.impressions), borderColor: '#06b6d4', type: 'line', yAxisID: 'y1', tension: 0.3, pointRadius: 5 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } })
      }
      const campNames2 = Object.keys(data.campaigns)
      if (campNames2.length > 0) {
        createChart('campSpend', 'doughnut', campNames2, [{ data: campNames2.map(n => data.campaigns[n].spend), backgroundColor: COLORS.slice(0, campNames2.length) }])
        createChart('campLeads', 'bar', campNames2, [{ label: 'Leads', data: campNames2.map(n => data.campaigns[n].leads), backgroundColor: 'rgba(16,185,129,0.7)', yAxisID: 'y' }, { label: 'CPL', data: campNames2.map(n => data.campaigns[n].leads > 0 ? data.campaigns[n].spend / data.campaigns[n].leads : 0), borderColor: '#ef4444', type: 'line', yAxisID: 'y1', tension: 0.3 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } })
      }
      const gn = Object.keys(data.genders).filter(g => g !== 'unknown')
      const gnAll = Object.keys(data.genders)
      if (gnAll.length > 0) {
        const gLabels = gnAll.map(g => g === 'female' ? 'נשים' : g === 'male' ? 'גברים' : 'לא ידוע')
        createChart('genderSpendChart', 'doughnut', gLabels, [{ data: gnAll.map(g => data.genders[g].spend), backgroundColor: ['rgba(236,72,153,0.7)', 'rgba(59,130,246,0.7)', 'rgba(245,158,11,0.7)'], borderColor: ['#fff','#fff','#fff'], borderWidth: 3 }])
        createChart('genderLeadsChart', 'doughnut', gLabels, [{ data: gnAll.map(g => data.genders[g].leads), backgroundColor: ['rgba(236,72,153,0.7)', 'rgba(59,130,246,0.7)', 'rgba(245,158,11,0.7)'], borderColor: ['#fff','#fff','#fff'], borderWidth: 3 }])
      }
      const an = Object.keys(data.ages).filter(a => a !== 'unknown').sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999))
      if (an.length > 0 && dashTab !== 'all' && dashTab !== 'facebook') {
        createChart('ageSpendLeads', 'bar', an, [{ label: 'הוצאה', data: an.map(a => data.ages[a].spend), backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#3b82f6', borderWidth: 2, yAxisID: 'y' }, { label: 'לידים', data: an.map(a => data.ages[a].leads), backgroundColor: 'rgba(16,185,129,0.15)', borderColor: '#10b981', borderWidth: 2, yAxisID: 'y1' }], { y: { position: 'right', title: { display: true, text: 'הוצאה (₪)' } }, y1: { position: 'left', title: { display: true, text: 'לידים' }, grid: { drawOnChartArea: false } } })
        const ageCPLdata = an.map(a => data.ages[a].leads > 0 ? data.ages[a].spend / data.ages[a].leads : 0)
        const ageCPLcolors = ageCPLdata.map(v => v < 80 ? '#10b981' : v < 120 ? '#3b82f6' : v < 150 ? '#8b5cf6' : '#ef4444')
        const ageCPLbg = ageCPLdata.map(v => v < 80 ? 'rgba(16,185,129,0.15)' : v < 120 ? 'rgba(59,130,246,0.15)' : v < 150 ? 'rgba(139,92,246,0.15)' : 'rgba(239,68,68,0.15)')
        createChart('ageCPL', 'bar', an, [{ label: 'CPL (₪)', data: ageCPLdata, backgroundColor: ageCPLbg, borderColor: ageCPLcolors, borderWidth: 2 }])
        createChart('ageRates', 'bar', an, [{ label: 'CTR %', data: an.map(a => data.ages[a].impressions > 0 ? (data.ages[a].clicks / data.ages[a].impressions * 100) : 0), backgroundColor: 'rgba(6,182,212,0.15)', borderColor: '#06b6d4', borderWidth: 2 }, { label: 'אחוז המרה %', data: an.map(a => data.ages[a].clicks > 0 ? (data.ages[a].leads / data.ages[a].clicks * 100) : 0), backgroundColor: 'rgba(139,92,246,0.15)', borderColor: '#8b5cf6', borderWidth: 2 }])
        createChart('ageCPM', 'bar', an, [{ label: 'CPM (₪)', data: an.map(a => data.ages[a].impressions > 0 ? (data.ages[a].spend / data.ages[a].impressions * 1000) : 0), backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#f59e0b', borderWidth: 2 }])
      }
    }, 200)

    const campNames = Object.keys(data.campaigns)
    const genderNames = Object.keys(data.genders).filter(g => g !== 'unknown')
    const ageNames = Object.keys(data.ages).filter(a => a !== 'unknown')

    const fbReports = currentReports.filter(r => r.source === 'facebook')
    const gReports = currentReports.filter(r => r.source && r.source.startsWith('google'))
    const crmReports = currentReports.filter(r => r.source === 'crm')
    const crmRepReports = currentReports.filter(r =>
      r.source === 'crm_reports' || (r.source === 'crm' && r.summary && Array.isArray(r.summary.crmRepRows) && r.summary.crmRepRows.length > 0)
    )
    const hasFb = fbReports.length > 0
    const hasPmax = gReports.some(r => r.source === 'google_pmax')
    const hasSearch = gReports.some(r => r.source === 'google_search')
    const hasG = gReports.length > 0
    const hasCrm = crmReports.length > 0 || crmRepReports.length > 0

    let fbTotals = null, gTotals = null
    if (hasFb) { let fbRows = []; fbReports.forEach(r => { if (r.data) fbRows = fbRows.concat(r.data) }); fbTotals = aggregateRows(fbRows).totals }
    if (hasG) { let gRows = []; gReports.forEach(r => { if (r.data) gRows = gRows.concat(r.data) }); gTotals = aggregateRows(gRows).totals }

    const activeT = dashTab === 'facebook' && fbTotals ? fbTotals : dashTab === 'google' && gTotals ? gTotals : t
    const activeP = dashTab !== 'all' ? null : p

    // Total leads including CRM for "all" tab display
    const totalLeadsWithCrm = dashTab === 'all' ? t.leads + crmTotalLeads : activeT.leads

    return (
      <>
        {/* Source Tabs */}
        <div className="client-tabs">
          <button className={`client-tab ${dashTab === 'all' ? 'active' : ''}`} onClick={() => setDashTab('all')}>הכל</button>
          {hasCrm && <button className={`client-tab ${dashTab === 'crm' ? 'active' : ''}`} onClick={() => setDashTab('crm')}>CRM</button>}
          {hasFb && <button className={`client-tab ${dashTab === 'facebook' ? 'active' : ''}`} onClick={() => setDashTab('facebook')}>Facebook</button>}
          {hasPmax && <button className={`client-tab ${dashTab === 'google_pmax' ? 'active' : ''}`} onClick={() => setDashTab('google_pmax')}>Google PMax</button>}
          {hasSearch && <button className={`client-tab ${dashTab === 'google_search' ? 'active' : ''}`} onClick={() => setDashTab('google_search')}>Google Search</button>}
          {hasG && <button className={`client-tab ${dashTab === 'google' ? 'active' : ''}`} onClick={() => setDashTab('google')}>Google</button>}
        </div>

        {dashTab === 'crm' ? (<>
          <div className="client-tabs" style={{marginBottom: 15}}>
            <button className={`client-tab ${crmSubTab === 'sources' ? 'active' : ''}`} onClick={() => setCrmSubTab('sources')}>📂 מקורות הגעה</button>
            <button className={`client-tab ${crmSubTab === 'response' ? 'active' : ''}`} onClick={() => setCrmSubTab('response')}>⏱️ זמני תגובה</button>
            <button className={`client-tab ${crmSubTab === 'objections' ? 'active' : ''}`} onClick={() => setCrmSubTab('objections')}>🚫 התנגדויות</button>
            <button className={`client-tab ${crmSubTab === 'reports' ? 'active' : ''}`} onClick={() => setCrmSubTab('reports')}>🏘️ יישובים</button>
          </div>
          {crmSubTab === 'sources' ? renderCrmDashboard()
            : crmSubTab === 'objections' ? renderCrmObjectionsDashboard()
            : crmSubTab === 'response' ? renderCrmResponseDashboard()
            : renderCrmReportDashboard()}
        </>) : (<>
        <div className="kpi-grid">
          {kpi('תקציב', formatCurrency(activeT.spend), '', activeT.spend, activeP?.spend, true)}
          {dashTab === 'all' ? kpi('לידים', formatNum(totalLeadsWithCrm), 'green', totalLeadsWithCrm, activeP?.leads) : kpi('לידים', formatNum(activeT.leads), 'green', activeT.leads, activeP?.leads)}
          {kpi('עלות לליד', formatCurrency(activeT.cpl), 'purple', activeT.cpl, activeP?.cpl, true)}
          {crmTotals ? kpi('פגישות שתואמו', formatNum(crmTotals.meetingsScheduled || 0), 'cyan', crmTotals.meetingsScheduled, null) : null}
          {crmTotals ? kpi('פגישות שבוצעו', formatNum(crmTotals.meetingsCompleted || 0), 'orange', crmTotals.meetingsCompleted, null) : null}
          {crmTotals ? kpi('הרשמות', formatNum(crmTotals.registrations || 0), 'green', crmTotals.registrations, null) : null}
          {crmTotals ? kpi('חוזים', formatNum(crmTotals.contracts || 0), 'pink', crmTotals.contracts, null) : null}
          {crmTotals && dashTab !== 'all' && crmTotals.meetingsCompleted > 0 ? kpi('עלות לפגישה שבוצעה', formatCurrency(activeT.spend / crmTotals.meetingsCompleted), 'purple', activeT.spend / crmTotals.meetingsCompleted, null, true) : null}
          {crmTotals && dashTab !== 'all' && crmTotals.contracts > 0 ? kpi('עלות לחוזה', formatCurrency(activeT.spend / crmTotals.contracts), 'red', activeT.spend / crmTotals.contracts, null, true) : null}
        </div>

        {/* FUNNEL */}
        <div className="section">
          <div className="section-header" style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'20px'}}>
            <div className="section-icon" style={{background:'var(--gradient-2)'}}>🔽</div>
            <div><h2 style={{fontSize:'1.3em',fontWeight:700,color:'var(--primary)',margin:0}}>משפך שיווקי</h2><div style={{fontSize:'0.85em',color:'var(--text-secondary)'}}>מקליק ועד חוזה</div></div>
          </div>
          <div className="card" style={{padding:'24px'}}>
            <div className="funnel">
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-1)'}}>{formatNum(activeT.clicks)}</div><div className="funnel-label">קליקים</div></div>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--accent)',opacity:0.85}}>{formatNum(activeT.impressions)}</div><div className="funnel-label">חשיפות</div></div>
              {crmTotals ? <><div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--cyan)'}}>{formatNum(crmTotals.meetingsScheduled || 0)}</div><div className="funnel-label">פגישות מתואמות</div></div>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--purple)'}}>{formatNum(crmTotals.meetingsCompleted || 0)}</div><div className="funnel-label">פגישות שבוצעו</div></div>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-2)'}}>{formatNum(crmTotals.registrations || 0)}</div><div className="funnel-label">הרשמות</div></div>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-3)'}}>{formatNum(crmTotals.contracts || 0)}</div><div className="funnel-label">חוזים</div></div></> : <>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-2)'}}>{formatNum(activeT.leads)}</div><div className="funnel-label">לידים</div><div className="funnel-rate">המרה: {activeT.convRate.toFixed(2)}%</div></div></>}
            </div>
            <div style={{textAlign:'center',marginTop:'10px',fontSize:'0.85em',color:'var(--text-secondary)'}}>
              עלות לליד: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(activeT.cpl)}</strong> &nbsp;|&nbsp; עלות לקליק: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(activeT.cpc)}</strong> &nbsp;|&nbsp; CPM: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(activeT.cpm)}</strong>
            </div>
          </div>
        </div>

        {trendData.length > 1 && (<div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>📈</div>מגמות חודשיות <InfoTip text="השוואת חודש מול חודש קודם - תקציב, חשיפות, לידים, CPL. עוזר לזהות מגמות לאורך זמן" /></div><div className="chart-grid"><div className="chart-card"><h4>💰 לידים ועלות לליד</h4><div className="chart-container"><canvas id="trendLeads"></canvas></div></div><div className="chart-card"><h4>📈 תקציב וחשיפות</h4><div className="chart-container"><canvas id="trendSpend"></canvas></div></div></div></div>)}

        {campNames.length > 0 && (<div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>📋</div>קמפיינים <InfoTip text="סיכום ביצועים פר קמפיין. CPL (עלות לליד) הוא ה-KPI המרכזי" /></div><div className="chart-grid"><div className="chart-card"><h4>📊 התפלגות תקציב</h4><div className="chart-container"><canvas id="campSpend"></canvas></div></div><div className="chart-card"><h4>💰 לידים ו-CPL</h4><div className="chart-container"><canvas id="campLeads"></canvas></div></div></div>{buildTable(data.campaigns, prevData?.campaigns, 'קמפיין', 'campaigns')}</div>)}

        {!isPmax && (
        <div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>🎯</div>קבוצות מודעות <InfoTip text="ביצועי Ad Sets - איזה קהל יעד הכי טוב" /></div>{buildTable(data.adSets, prevData?.adSets, 'קבוצת מודעות', 'adsets')}</div>
        )}

        {isPmax && (() => {
          const allAGs = displayReports.flatMap(r => r.summary?.assetGroups || [])
          if (allAGs.length === 0) return null
          const sorted = [...allAGs].sort((a,b) => (b.spend || 0) - (a.spend || 0))
          return (
            <div className="section">
              <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>🎯</div>קבוצות נכסים - פירוט <InfoTip text="Performance Max Asset Groups - התוכן והביצוע בכל קבוצה" /></div>
              <div className="card" style={{overflowX:'auto'}}>
                <table className="data-table"><thead><tr>
                  <th style={{whiteSpace:'nowrap'}}>קבוצת נכסים</th>
                  <th style={{whiteSpace:'nowrap'}}>קמפיין</th>
                  <th style={{whiteSpace:'nowrap'}}>קליקים</th>
                  <th style={{whiteSpace:'nowrap'}}>חשיפות</th>
                  <th style={{whiteSpace:'nowrap'}}>CTR</th>
                  <th style={{whiteSpace:'nowrap'}}>לידים</th>
                  <th style={{whiteSpace:'nowrap'}}>CPL</th>
                  <th style={{whiteSpace:'nowrap'}}>הוצאה</th>
                </tr></thead><tbody>
                  {sorted.map((ag, i) => {
                    const spend = ag.spend || 0
                    const leads = ag.conversions || ag.leads || 0
                    const clicks = ag.clicks || 0
                    const imps = ag.impressions || 0
                    const cpl = leads > 0 ? spend / leads : 0
                    const ctr = imps > 0 ? (clicks / imps * 100) : 0
                    return (
                      <tr key={ag.id || i}>
                        <td style={{fontWeight:600,unicodeBidi:'plaintext',textAlign:'right'}}>{ag.name || '-'}</td>
                        <td style={{fontSize:'0.85em',color:'#64748b',unicodeBidi:'plaintext'}}>{ag.campaign || '-'}</td>
                        <td>{formatNum(clicks)}</td>
                        <td>{formatNum(imps)}</td>
                        <td>{ctr.toFixed(2)}%</td>
                        <td style={{fontWeight:700,color:leads>0?'#059669':'#94a3b8'}}>{Math.round(leads)}</td>
                        <td style={{fontWeight:600}}>{leads > 0 ? formatCurrency(cpl) : '-'}</td>
                        <td style={{fontWeight:600}}>{formatCurrency(spend)}</td>
                      </tr>
                    )
                  })}
                </tbody></table>
              </div>
            </div>
          )
        })()}

        {!isPmax && <div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-3)'}}>📝</div>מודעות <InfoTip text="כל המודעות עם הביצועים שלהן (כפילויות 'עותק 1' אוחדו)" /></div>{buildTable((() => { const merged = {}; Object.entries(data.ads).forEach(([name, d]) => { const base = name.replace(/[\u200e\u200f\u200b\u200c\u200d\u202a-\u202e\u2066-\u2069\uFEFF]/g, '').replace(/\s*#\d+$/, '').replace(/\s*-\s*עותק\s*$/, '').replace(/\s*-\s*עותק\s*\d*$/, '').trim(); if (!merged[base]) merged[base] = { spend: 0, leads: 0, clicks: 0, impressions: 0, reach: 0 }; merged[base].spend += d.spend; merged[base].leads += d.leads; merged[base].clicks += d.clicks; merged[base].impressions += d.impressions; merged[base].reach += (d.reach || 0) }); return merged })(), null, 'מודעה', 'ads')}</div>}

        {!isPmax && (genderNames.length > 0 || ageNames.length > 0) && (<div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>👥</div>פילוח דמוגרפי <InfoTip text="התפלגות הצופים/מקליקים/לידים לפי מגדר וגיל. עוזר להבין את הקהל ולמקד את הקמפיינים." /></div>
        {!isPmax && genderNames.length > 0 && (() => {
          const gd = data.genders
          const genderMap = { female: { label: 'נשים', emoji: '♀' }, male: { label: 'גברים', emoji: '♂' }, unknown: { label: 'לא ידוע', emoji: '?' } }
          const gKeys = ['female', 'male', 'unknown'].filter(g => gd[g])
          return (<div style={{marginBottom: ageNames.length > 0 ? '28px' : 0}}>
            <h3 style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'1.05em',fontWeight:600,color:'var(--text-primary)',margin:'0 0 12px 0'}}><span style={{fontSize:'1.2em'}}>⚧</span>פילוח מגדרי</h3>
            <div className="grid-3" style={{marginBottom:'20px',display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:'16px'}}>
              {gKeys.map(g => { const d = gd[g]; const cpl = d.leads > 0 ? d.spend / d.leads : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const conv = d.clicks > 0 ? (d.leads / d.clicks * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; return (
                <div className="card" key={g}><div className="card-body" style={{textAlign:'center'}}>
                  <div style={{fontSize:'2em'}}>{genderMap[g]?.emoji || '?'}</div>
                  <div style={{fontWeight:700,fontSize:'1.1em',margin:'8px 0'}}>{genderMap[g]?.label || g}</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',textAlign:'center',fontSize:'0.85em'}}>
                    <div>הוצאה<br/><strong>{formatCurrency(d.spend)}</strong></div>
                    <div>לידים<br/><strong>{d.leads}</strong></div>
                    <div>CPL<br/><strong>{formatCurrency(cpl)}</strong></div>
                    <div>המרה<br/><strong>{conv.toFixed(2)}%</strong></div>
                    <div>CTR<br/><strong>{ctr.toFixed(2)}%</strong></div>
                    <div>CPM<br/><strong>{formatCurrency(cpm)}</strong></div>
                  </div>
                </div></div>) })}
            </div>
            <div className="chart-grid">
              <div className="chart-card"><h4>💰 חלוקת הזצאה</h4><div className="chart-container"><canvas id="genderSpendChart"></canvas></div></div>
              <div className="chart-card"><h4>👥 לידים לפי מגדר</h4><div className="chart-container"><canvas id="genderLeadsChart"></canvas></div></div>
            </div>
          </div>)
        })()}

        {!isPmax && ageNames.length > 0 && (() => {
          const ad = data.ages
          const sortedAges = ageNames.sort((a, b) => { const na = parseInt(a); const nb = parseInt(b); return na - nb })
          return (<div>
            <h3 style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'1.05em',fontWeight:600,color:'var(--text-primary)',margin:'0 0 12px 0'}}><span style={{fontSize:'1.2em'}}>📅</span>פילוח גילאי</h3>
            <div className="card" style={{marginBottom:'20px'}}><div className="card-body" style={{overflowX:'auto'}}>
              <table className="data-table"><thead><tr>
                {[{key:'age',label:'גיל'},{key:'clicks',label:'קליקים'},{key:'impressions',label:'חשיפות'},{key:'cpc',label:'עלות לקליק'},{key:'ctr',label:'CTR'},{key:'cpm',label:'CPM'},{key:'leads',label:'לידים'},{key:'cpl',label:'עלות לליד'},{key:'spend',label:'תקציב שנוצל'}].map(c=>(<th key={c.key} style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>handleSort('ages',c.key)}>{c.label}{(()=>{const s=sortConfig['ages'];if(!s||s.key!==c.key)return ' ⇅';return s.dir==='desc'?' ▼':' ▲'})()}</th>))}
              </tr></thead><tbody>
                {(()=>{const ageCols={age:{get:(d,n)=>n},clicks:{get:d=>d.clicks,higher:true},impressions:{get:d=>d.impressions,higher:true},cpc:{get:d=>d.clicks>0?d.spend/d.clicks:0,higher:false},ctr:{get:d=>d.impressions>0?(d.clicks/d.impressions*100):0,higher:true},cpm:{get:d=>d.impressions>0?(d.spend/d.impressions*1000):0,higher:false},leads:{get:d=>d.leads,higher:true},cpl:{get:d=>d.leads>0?d.spend/d.leads:0,higher:false},spend:{get:d=>d.spend}};const sc=sortConfig['ages'];let sorted=[...sortedAges];if(sc&&ageCols[sc.key]){sorted.sort((a,b)=>{const va=ageCols[sc.key].get(ad[a],a),vb=ageCols[sc.key].get(ad[b],b);if(typeof va==='string')return sc.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);return sc.dir==='asc'?va-vb:vb-va;});}const ageExtremes={};Object.keys(ageCols).forEach(k=>{if(k==='age'||k==='spend')return;const c=ageCols[k];const vals=sorted.map(a=>c.get(ad[a],a)).filter(v=>typeof v==='number'&&v>0);if(vals.length<2)return;ageExtremes[k]={min:Math.min(...vals),max:Math.max(...vals)};});const ageCellBg=(key,val)=>{const e=ageExtremes[key];if(!e||val<=0||e.min===e.max)return {};const c=ageCols[key];if(!c||c.higher===undefined)return {};if(val===e.max)return c.higher?{color:'#059669',fontWeight:700}:{color:'#dc2626',fontWeight:700};if(val===e.min)return c.higher?{color:'#dc2626',fontWeight:700}:{color:'#059669',fontWeight:700};return {};};return sorted.map(age => { const d = ad[age]; const cpl = d.leads > 0 ? d.spend / d.leads : 0; const cpc = d.clicks > 0 ? d.spend / d.clicks : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; const cplClass = cpl > 0 && cpl < 80 ? 'tag-green' : cpl < 120 ? 'tag-blue' : cpl < 150 ? 'tag-purple' : 'tag-red'; return (
                  <tr key={age}><td style={{fontWeight:600}}>{age}</td><td style={ageCellBg('clicks',d.clicks)}>{formatNum(d.clicks)}</td><td style={ageCellBg('impressions',d.impressions)}>{formatNum(d.impressions)}</td><td style={ageCellBg('cpc',cpc)}>{formatCurrency(cpc)}</td><td style={ageCellBg('ctr',ctr)}>{ctr.toFixed(2)}%</td><td style={ageCellBg('cpm',cpm)}>{formatCurrency(cpm)}</td><td style={ageCellBg('leads',d.leads)}>{d.leads}</td><td style={ageCellBg('cpl',cpl)}><span className={`cpl-tag ${cplClass}`}>{formatCurrency(cpl)}</span></td><td>{formatCurrency(d.spend)}</td></tr>)})})()}
              </tbody></table>
            </div></div>
            {dashTab !== 'all' && dashTab !== 'facebook' && (<>
            <div className="chart-grid">
              <div className="chart-card"><h4>💰 הוצאה ולידים</h4><div className="chart-container"><canvas id="ageSpendLeads"></canvas></div></div>
              <div className="chart-card"><h4>📈 עלות לליד (CPL)</h4><div className="chart-container"><canvas id="ageCPL"></canvas></div></div>
            </div>
            <div className="chart-grid">
              <div className="chart-card"><h4>🖱 CTR באחוז המרה</h4><div className="chart-container"><canvas id="ageRates"></canvas></div></div>
              <div className="chart-card"><h4>📡 CPM</h4><div className="chart-container"><canvas id="ageCPM"></canvas></div></div>
            </div>
            </>)}
          </div>)
        })()}
        </div>)}

        {/* ACTIVE ADS SECTION (Facebook) - top 5 by leads, with video/image preview */}
        {(dashTab === 'facebook' || dashTab === 'all') && (() => {
          const activeAdsList = fbReports.flatMap(r => r.summary?.activeAds || []);
          if (activeAdsList.length === 0) return null;
          // activeAds are already sorted + trimmed to top 5 by the API, but re-sort defensively
          const topAds = [...activeAdsList]
            .sort((a, b) => (b.metrics?.leads || 0) - (a.metrics?.leads || 0))
            .slice(0, 5);
          return (
            <div className="section">
              <div className="section-title">
                <div className="section-icon" style={{background:'var(--gradient-3, linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%))'}}>{'\ud83c\udfc6'}</div>
                {'\u05d4\u05de\u05d5\u05d3\u05e2\u05d5\u05ea \u05d4\u05db\u05d9 \u05de\u05d5\u05d1\u05d9\u05dc\u05d5\u05ea \u05d1-Facebook'} (Top {topAds.length})
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))',gap:'20px'}}>
                {topAds.map((ad, i) => {
                  const metrics = ad.metrics || {};
                  const cpl = metrics.leads > 0 ? metrics.spend / metrics.leads : 0;
                  const hasVideo = Boolean(ad.videoUrl);
                  const previewImg = ad.imageUrl || ad.thumbnailUrl;
                  return (
                    <div key={ad.id || i} className="card" style={{overflow:'hidden',display:'flex',flexDirection:'column',border:'1px solid #e2e8f0',boxShadow:'0 4px 12px rgba(0,0,0,0.08)'}}>
                      {/* Media: video if available, else image */}
                      <div style={{position:'relative',width:'100%',aspectRatio:'4/5',background:'#0f172a',overflow:'hidden'}}>
                        {hasVideo ? (
                          <video
                            src={ad.videoUrl}
                            poster={previewImg || undefined}
                            controls
                            playsInline
                            preload="metadata"
                            style={{width:'100%',height:'100%',objectFit:'contain',display:'block',background:'#000'}}
                          />
                        ) : previewImg ? (
                          <img src={previewImg} alt={ad.name} loading="lazy" style={{width:'100%',height:'100%',objectFit:'contain',display:'block',background:'#000'}} onError={(e)=>{e.currentTarget.style.display='none'; e.currentTarget.parentElement.style.background='linear-gradient(135deg,#1e293b,#334155)'}} />
                        ) : (
                          <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'3em',color:'#64748b'}}>{'\ud83d\udcf7'}</div>
                        )}
                        {/* Rank badge */}
                        <div style={{position:'absolute',top:'10px',right:'10px',background:'rgba(15,23,42,0.85)',color:'#fbbf24',fontWeight:800,fontSize:'0.8em',padding:'4px 10px',borderRadius:'20px',letterSpacing:'0.04em'}}>
                          #{i + 1}
                        </div>
                      </div>

                      {/* Metrics strip */}
                      <div style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',borderBottom:'1px solid #e2e8f0'}}>
                        <div style={{padding:'10px',textAlign:'center',borderRight:'1px solid #f1f5f9'}}>
                          <div style={{fontSize:'0.65em',color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.04em'}}>{'\u05dc\u05d9\u05d3\u05d9\u05dd'}</div>
                          <div style={{fontSize:'1.2em',fontWeight:800,color:'#059669',marginTop:'2px'}}>{metrics.leads || 0}</div>
                        </div>
                        <div style={{padding:'10px',textAlign:'center',borderRight:'1px solid #f1f5f9'}}>
                          <div style={{fontSize:'0.65em',color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.04em'}}>CPL</div>
                          <div style={{fontSize:'1.2em',fontWeight:800,color:'#0f172a',marginTop:'2px'}}>{'\u20aa'}{Math.round(cpl)}</div>
                        </div>
                        <div style={{padding:'10px',textAlign:'center'}}>
                          <div style={{fontSize:'0.65em',color:'#64748b',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.04em'}}>{'\u05d4\u05d5\u05e6\u05d0\u05d4'}</div>
                          <div style={{fontSize:'1.2em',fontWeight:800,color:'#0f172a',marginTop:'2px'}}>{'\u20aa'}{Math.round(metrics.spend || 0).toLocaleString('he-IL')}</div>
                        </div>
                      </div>

                      {/* Text content */}
                      <div style={{padding:'14px 16px',flexGrow:1,display:'flex',flexDirection:'column',gap:'8px'}}>
                        {ad.title && <div style={{fontWeight:700,fontSize:'0.95em',color:'#0f172a',lineHeight:1.3}}>{ad.title}</div>}
                        {ad.body && <div style={{fontSize:'0.85em',color:'#475569',lineHeight:1.5,unicodeBidi:'plaintext',maxHeight:'5em',overflow:'hidden',textOverflow:'ellipsis',display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical'}}>{ad.body}</div>}
                        <div style={{fontSize:'0.72em',color:'#94a3b8',marginTop:'auto',paddingTop:'8px',borderTop:'1px solid #f1f5f9',unicodeBidi:'plaintext'}}>
                          <div>{'\ud83d\udcca'} {ad.campaign || '\u2014'}</div>
                          {ad.adSet && <div style={{marginTop:'2px'}}>{'\ud83c\udfaf'} {ad.adSet}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ASSET GROUPS SECTION (Google PMax) */}
        {(dashTab === 'google' || dashTab === 'google_pmax' || dashTab === 'all') && (() => {
          const groups = gReports.flatMap(r => r.summary?.assetGroups || []);
          if (groups.length === 0) return null;
          return (
            <div className="section">
              <div className="section-title">
                <div className="section-icon" style={{background:'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)'}}>{'\ud83c\udfaf'}</div>
                {'\u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05e0\u05db\u05e1\u05d9\u05dd \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea (PMax)'} ({groups.length})
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))',gap:'16px'}}>
                {groups.map((ag, i) => {
                  const ft = (a) => (a.field_type || a.type || '').toUpperCase();
                  const imgUrl = (a) => a.image_url || a.imageUrl || '';
                  const isHeadline = a => /HEADLINE/.test(ft(a));
                  const isDescription = a => /DESCRIPTION/.test(ft(a));
                  const isImage = a => /(IMAGE|LOGO)/.test(ft(a)) && imgUrl(a);
                  const isVideo = a => /VIDEO/.test(ft(a)) && (a.youtube_id || a.youtubeId);
                  const headlines = (ag.assets || []).filter(isHeadline);
                  const descriptions = (ag.assets || []).filter(isDescription);
                  const images = (ag.assets || []).filter(isImage);
                  const videos = (ag.assets || []).filter(isVideo);
                  const firstImg = images[0];
                  const metrics = {
                    spend: ag.spend || 0,
                    leads: ag.conversions || ag.leads || 0,
                    impressions: ag.impressions || 0,
                    clicks: ag.clicks || 0,
                  };
                  const cpl = metrics.leads > 0 ? metrics.spend / metrics.leads : 0;
                  return (
                    <div key={ag.id || i} className="card" style={{overflow:'hidden',display:'flex',flexDirection:'column'}}>
                      {firstImg ? (
                        <div style={{width:'100%',aspectRatio:'16/9',background:'#0f172a',overflow:'hidden'}}>
                          <img src={imgUrl(firstImg)} alt={ag.name} style={{width:'100%',height:'100%',objectFit:'contain'}} onError={(e)=>{e.target.style.display='none'}} />
                        </div>
                      ) : (
                        <div style={{width:'100%',aspectRatio:'16/9',background:'linear-gradient(135deg,#dbeafe,#cffafe)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'2.5em',color:'#64748b'}}>{'\ud83c\udfaf'}</div>
                      )}
                      <div style={{padding:'14px 16px',flexGrow:1,display:'flex',flexDirection:'column',gap:'10px'}}>
                        <div style={{fontSize:'0.75em',color:'#059669',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em'}}>{'\u25cf'} {'\u05e4\u05e2\u05d9\u05dc'}</div>
                        <div style={{fontWeight:700,fontSize:'1em',color:'#0f172a'}}>{ag.name}</div>
                        <div style={{fontSize:'0.72em',color:'#94a3b8',unicodeBidi:'plaintext'}}>{'\ud83d\udcca'} {ag.campaign || '\u2014'}</div>
                        {headlines.length > 0 && (
                          <div>
                            <div style={{fontSize:'0.72em',color:'#64748b',fontWeight:600,marginBottom:'4px'}}>{'\u05db\u05d5\u05ea\u05e8\u05d5\u05ea'} ({headlines.length})</div>
                            <div style={{display:'flex',flexDirection:'column',gap:'3px',maxHeight:'80px',overflowY:'auto'}}>
                              {headlines.slice(0,5).map((h,j) => <div key={j} style={{fontSize:'0.82em',color:'#334155',unicodeBidi:'plaintext',padding:'2px 0'}}>{'\u2022 '}{h.text}</div>)}
                            </div>
                          </div>
                        )}
                        {descriptions.length > 0 && (
                          <div>
                            <div style={{fontSize:'0.72em',color:'#64748b',fontWeight:600,marginBottom:'4px'}}>{'\u05ea\u05d9\u05d0\u05d5\u05e8\u05d9\u05dd'} ({descriptions.length})</div>
                            <div style={{display:'flex',flexDirection:'column',gap:'3px',maxHeight:'80px',overflowY:'auto'}}>
                              {descriptions.slice(0,3).map((d,j) => <div key={j} style={{fontSize:'0.8em',color:'#475569',lineHeight:1.4,unicodeBidi:'plaintext',padding:'2px 0'}}>{'\u2022 '}{d.text}</div>)}
                            </div>
                          </div>
                        )}
                        {(metrics.spend > 0 || metrics.leads > 0) && (
                          <div style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:'4px',padding:'8px 0',borderTop:'1px solid #f1f5f9',borderBottom:'1px solid #f1f5f9',marginBottom:'4px'}}>
                            <div style={{textAlign:'center'}}><div style={{fontSize:'0.65em',color:'#64748b'}}>{'\u05d4\u05d5\u05e6\u05d0\u05d4'}</div><div style={{fontWeight:700,fontSize:'0.95em'}}>{'\u20aa'}{Math.round(metrics.spend).toLocaleString('he-IL')}</div></div>
                            <div style={{textAlign:'center'}}><div style={{fontSize:'0.65em',color:'#64748b'}}>{'\u05dc\u05d9\u05d3\u05d9\u05dd'}</div><div style={{fontWeight:700,fontSize:'0.95em',color:'#059669'}}>{Math.round(metrics.leads)}</div></div>
                            <div style={{textAlign:'center'}}><div style={{fontSize:'0.65em',color:'#64748b'}}>CPL</div><div style={{fontWeight:700,fontSize:'0.95em'}}>{'\u20aa'}{Math.round(cpl)}</div></div>
                          </div>
                        )}
                        {images.length > 1 && (
                          <div style={{display:'flex',gap:'4px',flexWrap:'wrap'}}>
                            {images.slice(1,5).map((img,j) => (
                              <img key={j} src={imgUrl(img)} alt="" style={{width:'44px',height:'44px',objectFit:'cover',borderRadius:'4px',border:'1px solid #e2e8f0'}} onError={(e)=>{e.target.style.display='none'}} />
                            ))}
                            {images.length > 5 && <div style={{fontSize:'0.75em',color:'#64748b',alignSelf:'center'}}>{'+'}{images.length - 5}</div>}
                          </div>
                        )}
                        {videos.length > 0 && (
                          <div style={{fontSize:'0.72em',color:'#64748b',marginTop:'4px'}}>
                            {'\ud83c\udfac'} {videos.length} {'\u05e1\u05e8\u05d8\u05d5\u05e0\u05d9\u05dd'}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        </>)}

        <div className="powered-by">VITAS Digital Marketing | דוח אוטומטי</div>
      </>
    )
  }, [selectedMonth, compareEnabled, reports, dashTab, crmSubTab, renderCrmDashboard, renderCrmReportDashboard, renderCrmObjectionsDashboard, renderCrmResponseDashboard, sortConfig])

  if (loading) return <div className="loading-page">טוען דוח...</div>

  if (error) {
    return (
      <div className="welcome-center" style={{minHeight: '100vh'}}>
        <div className="icon">🔒</div>
        <h2>הקישור לא תקין</h2>
        <p>אנא פנה למנהל הקמפיין שלך לקבלת קישור מעודכן</p>
      </div>
    )
  }

  return (
    <>
      {/* Client Header */}
      <div className="client-header">
        <h1>VITAS | {client?.name}</h1>
        {projects.length > 1 && (
          <div className="client-tabs">
            {projects.map(proj => (
              <button
                key={proj.id}
                className={`client-tab ${selectedProject?.id === proj.id ? 'active' : ''}`}
                onClick={() => switchProject(proj)}
              >
                {proj.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{maxWidth: 1400, margin: '0 auto', padding: 30}}>
        {selectedProject && (
          <>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25}}>
              <h2 style={{fontSize: '1.5em', fontWeight: 800}}>
                {selectedProject.name} - {formatMonth(selectedMonth)}
              </h2>
              <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                {reports.length > 1 && (
                  <select className="form-input" style={{width: 'auto'}} value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
                    {[...new Set(reports.map(r => r.month))].sort().reverse().map(m => (
                      <option key={m} value={m}>{formatMonth(m)}</option>
                    ))}
                  </select>
                )}
                {reports.length > 1 && (
                  <label style={{fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer'}}>
                    <input type="checkbox" checked={compareEnabled} onChange={e => setCompareEnabled(e.target.checked)} />
                    השוואה לחודש קודם
                  </label>
                )}
              </div>
            </div>

            {reports.length === 0 ? (
              <div className="welcome-center">
                <div className="icon">📭</div>
                <h3>הדוח עדיין לא מוכן</h3>
                <p>אנא צור קשר עם מנהל הקמפיין שלך</p>
              </div>
            ) : renderDashboard()}
          </>
        )}
      </div>
    </>
  )
}
