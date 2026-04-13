'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { formatCurrency, formatNum, formatMonth, aggregateRows, changePercent, getPrevMonth, COLORS } from '../../../lib/helpers'
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
  const chartsRef = useRef([])

  useEffect(() => {
    async function load() {
      const { data: clientData, error: clientError } = await supabase.from('clients').select('*').eq('token', token).single()
      if (clientError || !clientData) { setError(true); setLoading(false); return; }
      setClient(clientData)
      const { data: projectsData } = await supabase.from('projects').select('*').eq('client_id', clientData.id).order('created_at')
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
    const { data } = await supabase.from('reports').select('*').eq('project_id', projectId).order('month', { ascending: false })
    if (data) { setReports(data); if (data.length > 0) setSelectedMonth(data[0].month); } else { setReports([]); }
  }

  const switchProject = async (proj) => { setSelectedProject(proj); setCompareEnabled(false); await loadReports(proj.id); }

  const destroyCharts = () => { chartsRef.current.forEach(c => c.destroy()); chartsRef.current = []; }

  const createChart = (id, type, labels, datasets, scalesConfig) => {
    const canvas = document.getElementById(id)
    if (!canvas) return
    const config = { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Heebo' } } } } } }
    if (type !== 'doughnut' && type !== 'pie') { config.options.scales = scalesConfig || { y: { beginAtZero: true, position: 'right' } }; }
    const chart = new Chart(canvas, config)
    chartsRef.current.push(chart)
  }

  if (loading) return <div className="loading-page">\u05d8\u05d5\u05e2\u05df \u05d3\u05d5\u05d7...</div>

  if (error) {
    return (<div className="welcome-center" style={{minHeight: '100vh'}}><div className="icon">\ud83d\udd12</div><h2>\u05d4\u05e7\u05d9\u05e9\u05d5\u05e8 \u05dc\u05d0 \u05ea\u05e7\u05d9\u05df</h2><p>\u05d0\u05e0\u05d0 \u05e4\u05e0\u05d4 \u05dc\u05de\u05e0\u05d4\u05dc \u05d4\u05e7\u05de\u05e4\u05d9\u05d9\u05df \u05e9\u05dc\u05da \u05dc\u05e7\u05d1\u05dc\u05ea \u05e7\u05d9\u05e9\u05d5\u05e8 \u05de\u05e2\u05d5\u05d3\u05db\u05df</p></div>)
  }

  let dashboardContent = null
  if (selectedMonth && reports.length > 0) {
    const currentReports = reports.filter(r => r.month === selectedMonth)
    let allRows = []
    currentReports.forEach(r => { allRows = allRows.concat(r.data || []) })
    const data = aggregateRows(allRows)
    let prevData = null
    if (compareEnabled) {
      const prevMonth = getPrevMonth(selectedMonth)
      const prevReports = reports.filter(r => r.month === prevMonth)
      if (prevReports.length > 0) { let prevRows = []; prevReports.forEach(r => { prevRows = prevRows.concat(r.data || []) }); prevData = aggregateRows(prevRows); }
    }
    const allMonths = [...new Set(reports.map(r => r.month))].sort()
    const trendData = allMonths.map(m => { let mRows = []; reports.filter(r => r.month === m).forEach(r => { mRows = mRows.concat(r.data || []) }); return { month: m, ...aggregateRows(mRows).totals }; })
    const t = data.totals
    const p = prevData?.totals

    setTimeout(() => {
      destroyCharts()
      if (trendData.length > 1) {
        const labels = trendData.map(d => formatMonth(d.month))
        createChart('cTrendLeads', 'bar', labels, [{ label: '\u05dc\u05d9\u05d3\u05d9\u05dd', data: trendData.map(d => d.leads), backgroundColor: 'rgba(59,130,246,0.7)', yAxisID: 'y' }, { label: 'CPL', data: trendData.map(d => d.cpl), borderColor: '#ef4444', type: 'line', yAxisID: 'y1', tension: 0.3, pointRadius: 5 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } })
      }
      const campNames = Object.keys(data.campaigns)
      if (campNames.length > 0) {
        createChart('cCampSpend', 'doughnut', campNames, [{ data: campNames.map(n => data.campaigns[n].spend), backgroundColor: COLORS.slice(0, campNames.length) }])
        createChart('cCampLeads', 'bar', campNames, [{ label: '\u05dc\u05d9\u05d3\u05d9\u05dd', data: campNames.map(n => data.campaigns[n].leads), backgroundColor: 'rgba(16,185,129,0.7)', yAxisID: 'y' }, { label: 'CPL', data: campNames.map(n => data.campaigns[n].leads > 0 ? data.campaigns[n].spend / data.campaigns[n].leads : 0), borderColor: '#ef4444', type: 'line', yAxisID: 'y1', tension: 0.3 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } })
      }
      const genderNames = Object.keys(data.genders).filter(g => g !== 'unknown')
      if (genderNames.length > 0) createChart('cGender', 'doughnut', genderNames, [{ data: genderNames.map(g => data.genders[g].spend), backgroundColor: ['rgba(59,130,246,0.7)', 'rgba(236,72,153,0.7)'] }])
      const ageNames = Object.keys(data.ages).filter(a => a !== 'unknown').sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999))
      if (ageNames.length > 0) createChart('cAge', 'bar', ageNames, [{ label: '\u05dc\u05d9\u05d3\u05d9\u05dd', data: ageNames.map(a => data.ages[a].leads), backgroundColor: 'rgba(59,130,246,0.7)', yAxisID: 'y' }, { label: 'CPL', data: ageNames.map(a => data.ages[a].leads > 0 ? data.ages[a].spend / data.ages[a].leads : 0), borderColor: '#ef4444', type: 'line', yAxisID: 'y1', tension: 0.3 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } })
    }, 200)

    const kpi = (label, value, color, current, prev, isCost) => {
      const ch = prev != null ? changePercent(current, prev, isCost) : null
      return (<div className={`kpi-card ${color}`} key={label}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{ch && <div className={`kpi-change ${ch.isGood ? 'up' : 'down'}`}>{ch.pct > 0 ? '\u25b2' : '\u25bc'} {Math.abs(ch.pct).toFixed(1)}%</div>}</div>)
    }

    const buildTable = (items, prevItems, labelName) => {
      const entries = Object.entries(items).sort((a, b) => b[1].spend - a[1].spend)
      const showCh = !!prevItems
      const badge = (curr, prev, isCost) => { if (!prev || prev === 0) return null; const pct = ((curr - prev) / prev) * 100; const isPos = isCost ? pct < 0 : pct > 0; return <span className={`change-badge ${isPos ? 'positive' : 'negative'}`}>{pct > 0 ? '\u25b2' : '\u25bc'} {Math.abs(pct).toFixed(1)}%</span> }
      return (<div className="table-wrapper"><table className="data-table"><thead><tr><th>{labelName}</th><th>\u05ea\u05e7\u05e6\u05d9\u05d1</th>{showCh && <th>\u05e9\u05d9\u05e0\u05d5\u05d9</th>}<th>\u05dc\u05d9\u05d3\u05d9\u05dd</th>{showCh && <th>\u05e9\u05d9\u05e0\u05d5\u05d9</th>}<th>CPL</th>{showCh && <th>\u05e9\u05d9\u05e0\u05d5\u05d9</th>}<th>\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd</th><th>CTR</th></tr></thead><tbody>{entries.map(([name, d]) => { const cpl = d.leads > 0 ? d.spend / d.leads : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const prev = prevItems?.[name]; const prevCpl = prev && prev.leads > 0 ? prev.spend / prev.leads : 0; const cplClass = cpl > 0 && cpl < 50 ? 'cpl-good' : cpl < 100 ? 'cpl-ok' : 'cpl-bad'; return (<tr key={name}><td style={{fontWeight: 600}}>{name}</td><td>{formatCurrency(d.spend)}</td>{showCh && <td>{prev ? badge(d.spend, prev.spend, true) : '-'}</td>}<td>{d.leads}</td>{showCh && <td>{prev ? badge(d.leads, prev.leads) : '-'}</td>}<td><span className={`cpl-badge ${cplClass}`}>{formatCurrency(cpl)}</span></td>{showCh && <td>{prev ? badge(cpl, prevCpl, true) : '-'}</td>}<td>{formatNum(d.clicks)}</td><td>{ctr.toFixed(2)}%</td></tr>) })}</tbody></table></div>)
    }

    const campNames = Object.keys(data.campaigns)
    const genderNames = Object.keys(data.genders).filter(g => g !== 'unknown')
    const ageNames = Object.keys(data.ages).filter(a => a !== 'unknown')

    dashboardContent = (
      <>
        <div className="kpi-grid">
          {kpi('\u05ea\u05e7\u05e6\u05d9\u05d1', formatCurrency(t.spend), '', t.spend, p?.spend, true)}
          {kpi('\u05dc\u05d9\u05d3\u05d9\u05dd', formatNum(t.leads), 'green', t.leads, p?.leads)}
          {kpi('\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3', formatCurrency(t.cpl), 'purple', t.cpl, p?.cpl, true)}
          {kpi('\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea', formatNum(t.impressions), 'cyan', t.impressions, p?.impressions)}
          {kpi('\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd', formatNum(t.clicks), 'orange', t.clicks, p?.clicks)}
          {kpi('CPC', formatCurrency(t.cpc), 'red', t.cpc, p?.cpc, true)}
          {kpi('CTR', t.ctr.toFixed(2) + '%', 'green', t.ctr, p?.ctr)}
          {kpi('\u05d0\u05d7\u05d5\u05d6 \u05d4\u05de\u05e8\u05d4', t.convRate.toFixed(2) + '%', '', t.convRate, p?.convRate)}
        </div>
        {trendData.length > 1 && (<div className="section"><div className="section-title">\ud83d\udcc8 \u05de\u05d2\u05de\u05d5\u05ea \u05d7\u05d5\u05d3\u05e9\u05d9\u05d5\u05ea</div><div className="chart-grid"><div className="chart-card"><h4>\u05dc\u05d9\u05d3\u05d9\u05dd \u05d5\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3 \u05dc\u05d0\u05d5\u05e8\u05da \u05d6\u05de\u05df</h4><div className="chart-container"><canvas id="cTrendLeads"></canvas></div></div></div></div>)}
        {campNames.length > 0 && (<div className="section"><div className="section-title">\ud83c\udfaf \u05e7\u05de\u05e4\u05d9\u05d9\u05e0\u05d9\u05dd</div><div className="chart-grid"><div className="chart-card"><h4>\u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05ea\u05e7\u05e6\u05d9\u05d1</h4><div className="chart-container"><canvas id="cCampSpend"></canvas></div></div><div className="chart-card"><h4>\u05dc\u05d9\u05d3\u05d9\u05dd \u05d5-CPL</h4><div className="chart-container"><canvas id="cCampLeads"></canvas></div></div></div>{buildTable(data.campaigns, prevData?.campaigns, '\u05e7\u05de\u05e4\u05d9\u05d9\u05df')}</div>)}
        <div className="section"><div className="section-title">\ud83d\udccb \u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea</div>{buildTable(data.adSets, prevData?.adSets, '\u05e7\u05d1\u05d5\u05e6\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea')}</div>
        {genderNames.length > 0 && (<div className="section"><div className="section-title">\ud83d\udc64 \u05de\u05d2\u05d3\u05e8</div><div className="chart-grid"><div className="chart-card"><h4>\u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05ea\u05e7\u05e6\u05d9\u05d1</h4><div className="chart-container"><canvas id="cGender"></canvas></div></div></div></div>)}
        {ageNames.length > 0 && (<div className="section"><div className="section-title">\ud83d\udcca \u05d2\u05d9\u05dc</div><div className="chart-grid"><div className="chart-card"><h4>\u05dc\u05d9\u05d3\u05d9\u05dd \u05d5-CPL \u05dc\u05e4\u05d9 \u05d2\u05d9\u05dc</h4><div className="chart-container"><canvas id="cAge"></canvas></div></div></div></div>)}
        <div className="powered-by">VITAS Digital Marketing | \u05d3\u05d5\u05d7 \u05d0\u05d5\u05d8\u05d5\u05de\u05d8\u05d9</div>
      </>
    )
  }

  return (
    <>
      <div className="client-header">
        <h1>VITAS | {client?.name}</h1>
        {projects.length > 1 && (<div className="client-tabs">{projects.map(proj => (<button key={proj.id} className={`client-tab ${selectedProject?.id === proj.id ? 'active' : ''}`} onClick={() => switchProject(proj)}>{proj.name}</button>))}</div>)}
      </div>
      <div style={{maxWidth: 1400, margin: '0 auto', padding: 30}}>
        {selectedProject && (<>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25}}>
            <h2 style={{fontSize: '1.5em', fontWeight: 800}}>{selectedProject.name} \u2014 {formatMonth(selectedMonth)}</h2>
            <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
              {reports.length > 1 && (<select className="form-input" style={{width: 'auto'}} value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>{[...new Set(reports.map(r => r.month))].sort().reverse().map(m => (<option key={m} value={m}>{formatMonth(m)}</option>))}</select>)}
              {reports.length > 1 && (<label style={{fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer'}}><input type="checkbox" checked={compareEnabled} onChange={e => setCompareEnabled(e.target.checked)} />\u05d4\u05e9\u05d5\u05d5\u05d0\u05d4 \u05dc\u05d7\u05d5\u05d3\u05e9 \u05e7\u05d5\u05d3\u05dd</label>)}
            </div>
          </div>
          {reports.length === 0 ? (<div className="welcome-center"><div className="icon">\ud83d\udced</div><h3>\u05d4\u05d3\u05d5\u05d7 \u05e2\u05d3\u05d9\u05d9\u05df \u05dc\u05d0 \u05de\u05d5\u05db\u05df</h3><p>\u05d0\u05e0\u05d0 \u05e6\u05d5\u05e8 \u05e7\u05e9\u05e8 \u05e2\u05dd \u05de\u05e0\u05d4\u05dc \u05d4\u05e7\u05de\u05e4\u05d9\u05d9\u05df \u05e9\u05dc\u05da</p></div>) : dashboardContent}
        </>)}
      </div>
    </>
  )
}
