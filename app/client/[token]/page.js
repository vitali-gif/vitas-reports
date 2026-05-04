'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { formatCurrency, formatNum, formatMonth, aggregateRows, aggregateCrmRows, aggregateCrmReportRows, changePercent, getPrevMonth, COLORS } from '../../../lib/helpers'
import Chart from 'chart.js/auto'

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

    const crmRepReports = reports.filter(r => r.month === selectedMonth && r.source === 'crm_reports')
    if (crmRepReports.length === 0) return <div className="welcome-center"><div className="icon">💭</div><h3>אין נתוני CRM דוחות לחודש זה</h3></div>

    let allRows = []
    crmRepReports.forEach(r => { if (r.data) allRows = allRows.concat(r.data) })
    const repData = aggregateCrmReportRows(allRows)
    const rt = repData.totals

    const cityEntries = Object.entries(repData.cities).sort((a, b) => b[1] - a[1])
    const objEntries = Object.entries(repData.objectionTypes).sort((a, b) => b[1] - a[1])
    const cityNames = cityEntries.map(([n]) => n)
    const objNames = objEntries.map(([n]) => n)

    setTimeout(() => {
      destroyCharts()
      if (cityNames.length > 0) {
        createChart('crmRepCityChart', 'bar', cityNames, [{
          label: 'לידים', data: cityNames.map(n => repData.cities[n]),
          backgroundColor: COLORS.slice(0, cityNames.length)
        }], { y: { beginAtZero: true, position: 'right' } })
      }
      if (objNames.length > 0) {
        createChart('crmRepObjChart', 'doughnut', objNames, [{
          data: objNames.map(n => repData.objectionTypes[n]),
          backgroundColor: COLORS.slice(0, objNames.length)
        }])
      }
    }, 200)

    return (
      <>
        <div className="kpi-grid">
          <div className="kpi-card"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(59,130,246,0.1)',color:'var(--accent)'}}>📝</div><div className="kpi-label">סה"כ שורות</div><div className="kpi-value">{formatNum(rt.totalRows)}</div></div>
          <div className="kpi-card green"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(16,185,129,0.1)',color:'var(--success)'}}>🏘️</div><div className="kpi-label">ערים ייחודיות</div><div className="kpi-value">{formatNum(rt.uniqueCities)}</div></div>
          <div className="kpi-card purple"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(139,92,246,0.1)',color:'var(--purple)'}}>⚠️</div><div className="kpi-label">עם התנגדויות</div><div className="kpi-value">{formatNum(rt.withObjections)}</div></div>
          <div className="kpi-card orange"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(245,158,11,0.1)',color:'var(--warning)'}}>📅</div><div className="kpi-label">עם פגישה/משימה</div><div className="kpi-value">{formatNum(rt.withMeeting)}</div></div>
          <div className="kpi-card pink"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(236,72,153,0.1)',color:'var(--pink)'}}>📊</div><div className="kpi-label">% התנגדויות</div><div className="kpi-value">{rt.objectionRate.toFixed(1)}%</div></div>
          <div className="kpi-card cyan"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(6,182,212,0.1)',color:'var(--cyan)'}}>📊</div><div className="kpi-label">% פגישות</div><div className="kpi-value">{rt.meetingRate.toFixed(1)}%</div></div>
        </div>

        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>📋</div>נתונים מפורטים</div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr>
                <th>#</th>
                <th>כתובת/יישוב</th>
                <th>התנגדויות</th>
                <th>משימה/פגישה אחרונה</th>
              </tr></thead>
              <tbody>
                {allRows.map((row, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td style={{fontWeight:600}}>{row.address || '-'}</td>
                    <td>{row.objections || '-'}</td>
                    <td>{row.lastMeeting || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-2)'}}>📈</div>גרפים</div>
          <div className="chart-grid">
            <div className="chart-card"><h4>🏘️ התפלגות לפי יישוב</h4><div className="chart-container"><canvas id="crmRepCityChart"></canvas></div></div>
            <div className="chart-card"><h4>⚠️ התפלגות התנגדויות</h4><div className="chart-container"><canvas id="crmRepObjChart"></canvas></div></div>
          </div>
        </div>
      </>
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

    // Merge Facebook campaign sources into single 'Facebook' entry
    const _fbCrmKeys = Object.keys(crmData.sources).filter(k => k.includes('פייסבוק') || k.toLowerCase().includes('facebook'))
    if (_fbCrmKeys.length > 0) {
      const _fbMerged = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0 }
      _fbCrmKeys.forEach(k => { Object.keys(_fbMerged).forEach(f => { _fbMerged[f] += crmData.sources[k][f] || 0 }); delete crmData.sources[k] })
      crmData.sources['Facebook'] = _fbMerged
    }
    // Merge Google campaign sources into single 'Google' entry
    const _gCrmKeys = Object.keys(crmData.sources).filter(k => k.includes('גוגל') || k.toLowerCase().includes('google'))
    if (_gCrmKeys.length > 0) {
      const _gMerged = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0 }
      _gCrmKeys.forEach(k => { Object.keys(_gMerged).forEach(f => { _gMerged[f] += crmData.sources[k][f] || 0 }); delete crmData.sources[k] })
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
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>📊</div>נתונים לפי מקור הגעה</div>
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
                  return (
                    <tr key={name}>
                      <td style={{fontWeight:600}}>{name}</td>
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
                  )
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
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-2)'}}>📈</div>גרפים</div>
          <div className="chart-grid" style={{gridTemplateColumns: '1fr'}}>
            <div className="chart-card"><h4>🧩 התפלגות לידים</h4><div className="chart-container"><canvas id="crmPieChart"></canvas></div></div>
          </div>
        </div>
      </>
    )
  }, [selectedMonth, compareEnabled, reports])

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
          r.data.forEach(row => { crmTotalLeads += (typeof row.totalLeads === 'number' ? row.totalLeads : parseFloat(String(row.totalLeads).replace(/[^0-9.\-]/g, '')) || 0) })
        }
      })
    }

    // Extract CRM totals for "all" tab KPI display
    let crmTotals = null
    if (dashTab === 'all') {
      const crmReps = currentReports.filter(r => r.source === 'crm')
      if (crmReps.length > 0) {
        let allCrmR = []
        crmReps.forEach(r => { if (r.data) allCrmR = allCrmR.concat(r.data) })
        crmTotals = aggregateCrmRows(allCrmR).totals
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
    const crmRepReports = currentReports.filter(r => r.source === 'crm_reports')
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
          {hasFb && <button className={`client-tab ${dashTab === 'facebook' ? 'active' : ''}`} onClick={() => setDashTab('facebook')}>Facebook</button>}
          {hasPmax && <button className={`client-tab ${dashTab === 'google_pmax' ? 'active' : ''}`} onClick={() => setDashTab('google_pmax')}>Google PMax</button>}
          {hasSearch && <button className={`client-tab ${dashTab === 'google_search' ? 'active' : ''}`} onClick={() => setDashTab('google_search')}>Google Search</button>}
          {hasG && <button className={`client-tab ${dashTab === 'google' ? 'active' : ''}`} onClick={() => setDashTab('google')}>Google</button>}
          {hasCrm && <button className={`client-tab ${dashTab === 'crm' ? 'active' : ''}`} onClick={() => setDashTab('crm')}>CRM</button>}
        </div>

        {dashTab === 'crm' ? (<>
          <div className="client-tabs" style={{marginBottom: 15}}>
            <button className={`client-tab ${crmSubTab === 'sources' ? 'active' : ''}`} onClick={() => setCrmSubTab('sources')}>📂 מקורות הגעה</button>
            <button className={`client-tab ${crmSubTab === 'reports' ? 'active' : ''}`} onClick={() => setCrmSubTab('reports')}>📊 מחולל דוחות</button>
          </div>
          {crmSubTab === 'sources' ? renderCrmDashboard() : renderCrmReportDashboard()}
        </>) : (<>
        <div className="kpi-grid">
          {kpi('תקציב', formatCurrency(activeT.spend), '', activeT.spend, activeP?.spend, true)}
          {dashTab === 'all' ? kpi('לידים', formatNum(totalLeadsWithCrm), 'green', totalLeadsWithCrm, activeP?.leads) : kpi('לידים', formatNum(activeT.leads), 'green', activeT.leads, activeP?.leads)}
          {kpi('עלות לליד', formatCurrency(activeT.cpl), 'purple', activeT.cpl, activeP?.cpl, true)}
          {dashTab === 'all' && crmTotals ? kpi('פגישות שתואמו', formatNum(crmTotals.meetingsScheduled || 0), 'cyan', crmTotals.meetingsScheduled, null) : null}
          {dashTab === 'all' && crmTotals ? kpi('פגישות שבוצעו', formatNum(crmTotals.meetingsCompleted || 0), 'orange', crmTotals.meetingsCompleted, null) : null}
          {dashTab === 'all' && crmTotals ? kpi('הרשמות', formatNum(crmTotals.registrations || 0), 'green', crmTotals.registrations, null) : null}
          {dashTab === 'all' && crmTotals ? kpi('חוזים', formatNum(crmTotals.contracts || 0), 'pink', crmTotals.contracts, null) : null}
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
              {dashTab === 'all' && crmTotals ? <><div className="funnel-arrow">&larr;</div>
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

        {trendData.length > 1 && (<div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>📈</div>מגמות חודשיות</div><div className="chart-grid"><div className="chart-card"><h4>💰 לידים ועלות לליד</h4><div className="chart-container"><canvas id="trendLeads"></canvas></div></div><div className="chart-card"><h4>📈 תקציב וחשיפות</h4><div className="chart-container"><canvas id="trendSpend"></canvas></div></div></div></div>)}

        {campNames.length > 0 && (<div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>📋</div>קמפיינים</div><div className="chart-grid"><div className="chart-card"><h4>📊 התפלגות תקציב</h4><div className="chart-container"><canvas id="campSpend"></canvas></div></div><div className="chart-card"><h4>💰 לידים ו-CPL</h4><div className="chart-container"><canvas id="campLeads"></canvas></div></div></div>{buildTable(data.campaigns, prevData?.campaigns, 'קמפיין', 'campaigns')}</div>)}

        {!isPmax && (
        <div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>🎯</div>קבוצות מודעות</div>{buildTable(data.adSets, prevData?.adSets, 'קבוצת מודעות', 'adsets')}</div>
        )}

        {isPmax && (() => {
          const allAGs = displayReports.flatMap(r => r.summary?.assetGroups || [])
          if (allAGs.length === 0) return null
          const sorted = [...allAGs].sort((a,b) => (b.spend || 0) - (a.spend || 0))
          return (
            <div className="section">
              <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>🎯</div>קבוצות נכסים — פירוט</div>
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
                        <td style={{fontWeight:600,unicodeBidi:'plaintext',textAlign:'right'}}>{ag.name || '—'}</td>
                        <td style={{fontSize:'0.85em',color:'#64748b',unicodeBidi:'plaintext'}}>{ag.campaign || '—'}</td>
                        <td>{formatNum(clicks)}</td>
                        <td>{formatNum(imps)}</td>
                        <td>{ctr.toFixed(2)}%</td>
                        <td style={{fontWeight:700,color:leads>0?'#059669':'#94a3b8'}}>{Math.round(leads)}</td>
                        <td style={{fontWeight:600}}>{leads > 0 ? formatCurrency(cpl) : '—'}</td>
                        <td style={{fontWeight:600}}>{formatCurrency(spend)}</td>
                      </tr>
                    )
                  })}
                </tbody></table>
              </div>
            </div>
          )
        })()}

        {!isPmax && <div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-3)'}}>📝</div>מודעות</div>{buildTable((() => { const merged = {}; Object.entries(data.ads).forEach(([name, d]) => { const base = name.replace(/[\u200e\u200f\u200b\u200c\u200d\u202a-\u202e\u2066-\u2069\uFEFF]/g, '').replace(/\s*#\d+$/, '').replace(/\s*-\s*עותק\s*$/, '').replace(/\s*-\s*עותק\s*\d*$/, '').trim(); if (!merged[base]) merged[base] = { spend: 0, leads: 0, clicks: 0, impressions: 0, reach: 0 }; merged[base].spend += d.spend; merged[base].leads += d.leads; merged[base].clicks += d.clicks; merged[base].impressions += d.impressions; merged[base].reach += (d.reach || 0) }); return merged })(), null, 'מודעה', 'ads')}</div>}

        {/* GENDER SECTION */}
        {!isPmax && genderNames.length > 0 && (() => {
          const gd = data.genders
          const genderMap = { female: { label: 'נשים', emoji: '♀' }, male: { label: 'גברים', emoji: '♂' }, unknown: { label: 'לא ידוע', emoji: '?' } }
          const gKeys = ['female', 'male', 'unknown'].filter(g => gd[g])
          return (<div className="section">
            <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>⚧</div>פילוח מגדרי</div>
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

        {/* AGE SECTION */}
        {!isPmax && ageNames.length > 0 && (() => {
          const ad = data.ages
          const sortedAges = ageNames.sort((a, b) => { const na = parseInt(a); const nb = parseInt(b); return na - nb })
          return (<div className="section">
            <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>📅</div>פילוח גילאי</div>
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

        {/* ACTIVE ADS SECTION (Facebook) — top 5 by leads, with video/image preview */}
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

        {/* INSIGHTS SECTION */}
        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-2)'}}>💡</div>תובנות והמלצות</div>
          {(() => {
            const camps = Object.entries(data.campaigns)
            const ads2 = isPmax ? Object.entries(data.adSets || {}) : Object.entries(data.ads)
            const bestCamp = camps.sort((a,b) => { const ca = a[1].leads > 0 ? a[1].spend/a[1].leads : 9999; const cb = b[1].leads > 0 ? b[1].spend/b[1].leads : 9999; return ca - cb })[0]
            const worstCamp = camps.sort((a,b) => { const ca = a[1].leads > 0 ? a[1].spend/a[1].leads : 0; const cb = b[1].leads > 0 ? b[1].spend/b[1].leads : 0; return cb - ca })[0]
            const bestAd = ads2.sort((a,b) => { const ca = a[1].leads > 0 ? a[1].spend/a[1].leads : 9999; const cb = b[1].leads > 0 ? b[1].spend/b[1].leads : 9999; return ca - cb })[0]
            const bestAge = isPmax ? null : (ageNames.length > 0 ? ageNames.sort((a,b) => { const da = data.ages[a]; const db = data.ages[b]; const ca = da.leads > 0 ? da.spend/da.leads : 9999; const cb = db.leads > 0 ? db.spend/db.leads : 9999; return ca - cb })[0] : null)
            const worstAge = ageNames.length > 0 ? ageNames.sort((a,b) => { const da = data.ages[a]; const db = data.ages[b]; const ca = da.leads > 0 ? da.spend/da.leads : 0; const cb = db.leads > 0 ? db.spend/db.leads : 0; return cb - ca })[0] : null
            return (<>
              <div className="insight-box" style={{background:'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',border:'1px solid #bfdbfe',borderRadius:'var(--radius)',padding:'20px 24px',marginBottom:'20px'}}>
                <h3 style={{fontSize:'1em',color:'var(--accent-dark)',marginBottom:'10px'}}>🏆 מה עובד הכי טוב</h3>
                <ul style={{listStyle:'none',padding:0,direction:'rtl',textAlign:'right'}}>
                  {bestCamp && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>💡 קמפיין <strong>{bestCamp[0]}</strong> - CPL הנמוך ביותר ({formatCurrency(bestCamp[1].leads > 0 ? bestCamp[1].spend/bestCamp[1].leads : 0)}) עם {bestCamp[1].leads} לידים</li>}
                  {bestAd && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>💡 {isPmax ? 'קבוצת מודעות' : 'מודעה'} <strong>{bestAd[0]}</strong> - {bestAd[1].leads} לידים ב-{formatCurrency(bestAd[1].leads > 0 ? bestAd[1].spend/bestAd[1].leads : 0)} לליד</li>}
                  {!isPmax && bestAge && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>💡 גילאי <strong>{bestAge}</strong> - CPL הנמוך ביותר ({formatCurrency(data.ages[bestAge].leads > 0 ? data.ages[bestAge].spend/data.ages[bestAge].leads : 0)})</li>}
                </ul>
              </div>
              <div className="insight-box" style={{background:'linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%)',border:'1px solid #fecaca',borderRadius:'var(--radius)',padding:'20px 24px',marginBottom:'20px'}}>
                <h3 style={{fontSize:'1em',color:'#dc2626',marginBottom:'10px'}}>⚠️ מה צריך לשפר</h3>
                <ul style={{listStyle:'none',padding:0,direction:'rtl',textAlign:'right'}}>
                  {worstCamp && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>💡 קמפיין <strong>{worstCamp[0]}</strong> - CPL גבוה ({formatCurrency(worstCamp[1].leads > 0 ? worstCamp[1].spend/worstCamp[1].leads : 0)}). שווה לתקול שינוי קריאייטיב.</li>}
                  {worstAge && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>💡 גילאי <strong>{worstAge}</strong> - CPL הגבוה ביותר ({formatCurrency(data.ages[worstAge].leads > 0 ? data.ages[worstAge].spend/data.ages[worstAge].leads : 0)})</li>}
                </ul>
              </div>
              <div className="insight-box" style={{background:'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',border:'1px solid #86efac',borderRadius:'var(--radius)',padding:'20px 24px',marginBottom:'20px'}}>
                <h3 style={{fontSize:'1em',color:'#059669',marginBottom:'10px'}}>🎯 המלצות לחודש הבא</h3>
                <ul style={{listStyle:'none',padding:0,direction:'rtl',textAlign:'right'}}>
                  {bestCamp && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>💡 הגדלת תקציב ל-<strong>{bestCamp[0]}</strong> - ה-CPL הנמוך ביותר עם פוטנציאל להגדלה</li>}
                  {bestAge && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>💡 חיזוק גילאי <strong>{bestAge}</strong> - הכי אפקטיביים מבחינת עלות</li>}
                  {worstCamp && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>💡 בדיקה מחדש של <strong>{worstCamp[0]}</strong> - החלפת קריאייטיב או הפסקה</li>}
                </ul>
              </div>
            </>)
          })()}
        </div>
        </>)}

        <div className="powered-by">VITAS Digital Marketing | דוח אוטומטי</div>
      </>
    )
  }, [selectedMonth, compareEnabled, reports, dashTab, crmSubTab, renderCrmDashboard, renderCrmReportDashboard, sortConfig])

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
                {selectedProject.name} — {formatMonth(selectedMonth)}
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
