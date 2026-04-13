'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatNum, formatMonth, mapFacebookRows, mapGoogleRows, aggregateRows, changePercent, getPrevMonth, COLORS } from '../../lib/helpers'
import Chart from 'chart.js/auto'
import * as XLSX from 'xlsx'

export default function AdminPage() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [selectedProject, setSelectedProject] = useState(null)
  const [view, setView] = useState('welcome')
  const [uploadClient, setUploadClient] = useState('')
  const [uploadProject, setUploadProject] = useState('')
  const [uploadSource, setUploadSource] = useState('facebook')
  const [uploadMonth, setUploadMonth] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [reports, setReports] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [dashTab, setDashTab] = useState('all')
  const chartsRef = useRef([])
  const [showAddClient, setShowAddClient] = useState(false)
  const [showAddProject, setShowAddProject] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientProjects, setNewClientProjects] = useState('')
  const [newClientColor, setNewClientColor] = useState('#3b82f6')
  const [newProjectName, setNewProjectName] = useState('')
  const [toast, setToast] = useState('')

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadClients(); }, [session]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      let result;
      if (isSignUp) result = await supabase.auth.signUp({ email, password });
      else result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
    } catch (err) { setAuthError(err.message); }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); setSession(null); };

  const loadClients = async () => {
    const { data } = await supabase.from('clients').select('*, projects(*)').order('created_at');
    if (data) setClients(data);
  };

  const loadProjectReports = async (projectId) => {
    const { data } = await supabase.from('reports').select('*').eq('project_id', projectId).order('month', { ascending: false });
    if (data) { setReports(data); if (data.length > 0) setSelectedMonth(data[0].month); } else { setReports([]); }
  };

  const addClient = async () => {
    if (!newClientName.trim()) return;
    const { data: client, error } = await supabase.from('clients').insert({ name: newClientName.trim(), color: newClientColor }).select().single();
    if (error) { showToast('Error: ' + error.message); return; }
    const projects = newClientProjects ? newClientProjects.split(',').map(p => p.trim()).filter(Boolean) : ['General'];
    for (const name of projects) { await supabase.from('projects').insert({ client_id: client.id, name }); }
    setNewClientName(''); setNewClientProjects(''); setShowAddClient(false);
    await loadClients();
    showToast('Client "' + client.name + '" added');
  };

  const addProject = async () => {
    if (!newProjectName.trim() || !selectedClient) return;
    await supabase.from('projects').insert({ client_id: selectedClient.id, name: newProjectName.trim() });
    setNewProjectName(''); setShowAddProject(false);
    await loadClients();
    showToast('Project "' + newProjectName + '" added');
  };

  const handleFile = async (file) => {
    if (!uploadClient || !uploadProject || !uploadMonth) { showToast('Please fill all fields'); return; }
    setUploading(true); setUploadResult(null);
    try {
      const data = await file.arrayBuffer();
      let json;
      const bytes = new Uint8Array(data);
      // Detect UTF-16 BOM (Google Ads CSV export)
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
        const text = new TextDecoder('utf-16le').decode(data);
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
        // Find header row (first line with tabs = actual data header)
        let headerIdx = lines.findIndex(l => l.includes('\t'));
        if (headerIdx < 0) headerIdx = 0;
        const headers = lines[headerIdx].split('\t');
        json = [];
        for (let i = headerIdx + 1; i < lines.length; i++) {
          const vals = lines[i].split('\t');
          if (vals.length < 2) continue;
          const row = {};
          headers.forEach((h, j) => { row[h.trim()] = (vals[j] || '').replace(/^"|"$/g, '').trim(); });
          json.push(row);
        }
      } else {
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      }
      let mapped;
      if (uploadSource === 'facebook') mapped = mapFacebookRows(json);
      else if (uploadSource === 'google_pmax' || uploadSource === 'google_search') mapped = mapGoogleRows(json);
      else mapped = json;
      // Auto-set campaign name based on source type
      if (uploadSource === 'google_pmax') mapped = mapped.map(r => ({ ...r, campaign: 'PMAX' }));
      else if (uploadSource === 'google_search') mapped = mapped.map(r => ({ ...r, campaign: 'Search' }));

      const summary = aggregateRows(mapped);
      const { error } = await supabase.from('reports').upsert({
        project_id: uploadProject, source: uploadSource, month: uploadMonth,
        data: mapped, summary: summary.totals, file_name: file.name, row_count: mapped.length,
      }, { onConflict: 'project_id,source,month' });
      if (error) throw error;
      setUploadResult({ success: true, fileName: file.name, rowCount: mapped.length, totals: summary.totals });
      showToast('Data uploaded successfully!');
    } catch (err) { setUploadResult({ success: false, error: err.message }); showToast('Error: ' + err.message); }
    setUploading(false);
  };

  const handleDrop = (e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); };

  const selectProject = async (client, project) => {
    setSelectedClient(client); setSelectedProject(project); setView('dashboard'); setCompareEnabled(false);
    await loadProjectReports(project.id);
  };

  useEffect(() => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    setUploadMonth(prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0'));
  }, []);

  const destroyCharts = () => { chartsRef.current.forEach(c => c.destroy()); chartsRef.current = []; };

  const createChart = (id, type, labels, datasets, scalesConfig) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const config = { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Heebo' } } } } } };
    if (type !== 'doughnut' && type !== 'pie') { config.options.scales = scalesConfig || { y: { beginAtZero: true, position: 'right' } }; }
    const chart = new Chart(canvas, config);
    chartsRef.current.push(chart);
  };

  const renderDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null;
    destroyCharts();
    const currentReports = reports.filter(r => r.month === selectedMonth);
    if (currentReports.length === 0) return <div className="welcome-center"><div className="icon">📭</div><h3>No data for this month</h3></div>;
    let allRows = [];
    currentReports.forEach(r => { allRows = allRows.concat(r.data || []); });
    const data = aggregateRows(allRows);
    let prevData = null;
    if (compareEnabled) {
      const prevMonth = getPrevMonth(selectedMonth);
      const prevReports = reports.filter(r => r.month === prevMonth);
      if (prevReports.length > 0) { let prevRows = []; prevReports.forEach(r => { prevRows = prevRows.concat(r.data || []); }); prevData = aggregateRows(prevRows); }
    }
    const allMonths = [...new Set(reports.map(r => r.month))].sort();
    const trendData = allMonths.map(m => { let mRows = []; reports.filter(r => r.month === m).forEach(r => { mRows = mRows.concat(r.data || []); }); return { month: m, ...aggregateRows(mRows).totals }; });
    const t = data.totals;
    const p = prevData?.totals;

    const kpi = (label, value, color, current, prev, isCost) => {
      const ch = prev != null ? changePercent(current, prev, isCost) : null;
      return (<div className={`kpi-card ${color}`} key={label}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{ch && <div className={`kpi-change ${ch.isGood ? 'up' : 'down'}`}>{ch.pct > 0 ? '▲' : '▼'} {Math.abs(ch.pct).toFixed(1)}%</div>}</div>);
    };

    const buildTable = (items, prevItems, labelName) => {
      const entries = Object.entries(items).sort((a, b) => b[1].spend - a[1].spend);
      const showCh = !!prevItems;
      const changeBadge = (curr, prev, isCost) => { if (!prev || prev === 0) return null; const pct = ((curr - prev) / prev) * 100; const isPos = isCost ? pct < 0 : pct > 0; return <span className={`change-badge ${isPos ? 'positive' : 'negative'}`}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%</span>; };
      return (<div className="table-wrapper"><table className="data-table"><thead><tr><th>{labelName}</th><th>Budget</th>{showCh && <th>Change</th>}<th>Leads</th>{showCh && <th>Change</th>}<th>CPL</th>{showCh && <th>Change</th>}<th>Clicks</th><th>CTR</th><th>CPM</th></tr></thead><tbody>{entries.map(([name, d]) => { const cpl = d.leads > 0 ? d.spend / d.leads : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; const prev = prevItems?.[name]; const prevCpl = prev && prev.leads > 0 ? prev.spend / prev.leads : 0; const cplClass = cpl > 0 && cpl < 50 ? 'cpl-good' : cpl < 100 ? 'cpl-ok' : 'cpl-bad'; return (<tr key={name}><td style={{fontWeight: 600}}>{name}</td><td>{formatCurrency(d.spend)}</td>{showCh && <td>{prev ? changeBadge(d.spend, prev.spend, true) : '-'}</td>}<td>{d.leads}</td>{showCh && <td>{prev ? changeBadge(d.leads, prev.leads) : '-'}</td>}<td><span className={`cpl-badge ${cplClass}`}>{formatCurrency(cpl)}</span></td>{showCh && <td>{prev ? changeBadge(cpl, prevCpl, true) : '-'}</td>}<td>{formatNum(d.clicks)}</td><td>{ctr.toFixed(2)}%</td><td>{formatCurrency(cpm)}</td></tr>); })}</tbody></table></div>);
    };

    setTimeout(() => {
      destroyCharts();
      if (trendData.length > 1) {
        const labels = trendData.map(d => formatMonth(d.month));
        createChart('trendLeads', 'bar', labels, [{ label: 'Leads', data: trendData.map(d => d.leads), backgroundColor: 'rgba(59,130,246,0.7)', yAxisID: 'y' }, { label: 'CPL', data: trendData.map(d => d.cpl), borderColor: '#ef4444', type: 'line', yAxisID: 'y1', tension: 0.3, pointRadius: 5 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } });
        createChart('trendSpend', 'bar', labels, [{ label: 'Budget', data: trendData.map(d => d.spend), backgroundColor: 'rgba(139,92,246,0.7)', yAxisID: 'y' }, { label: 'Impressions', data: trendData.map(d => d.impressions), borderColor: '#06b6d4', type: 'line', yAxisID: 'y1', tension: 0.3, pointRadius: 5 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } });
      }
      const campNames2 = Object.keys(data.campaigns);
      if (campNames2.length > 0) {
        createChart('campSpend', 'doughnut', campNames2, [{ data: campNames2.map(n => data.campaigns[n].spend), backgroundColor: COLORS.slice(0, campNames2.length) }]);
        createChart('campLeads', 'bar', campNames2, [{ label: 'Leads', data: campNames2.map(n => data.campaigns[n].leads), backgroundColor: 'rgba(16,185,129,0.7)', yAxisID: 'y' }, { label: 'CPL', data: campNames2.map(n => data.campaigns[n].leads > 0 ? data.campaigns[n].spend / data.campaigns[n].leads : 0), borderColor: '#ef4444', type: 'line', yAxisID: 'y1', tension: 0.3 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } });
      }
      const gn = Object.keys(data.genders).filter(g => g !== 'unknown');
      if (gn.length > 0) createChart('genderChart', 'doughnut', gn, [{ data: gn.map(g => data.genders[g].spend), backgroundColor: ['rgba(59,130,246,0.7)', 'rgba(236,72,153,0.7)', 'rgba(139,92,246,0.7)'] }]);
      const an = Object.keys(data.ages).filter(a => a !== 'unknown').sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999));
      if (an.length > 0) createChart('ageChart', 'bar', an, [{ label: 'Leads', data: an.map(a => data.ages[a].leads), backgroundColor: 'rgba(59,130,246,0.7)', yAxisID: 'y' }, { label: 'CPL', data: an.map(a => data.ages[a].leads > 0 ? data.ages[a].spend / data.ages[a].leads : 0), borderColor: '#ef4444', type: 'line', yAxisID: 'y1', tension: 0.3 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } });
    }, 200);

    const campNames = Object.keys(data.campaigns);
    const adEntries = Object.entries(data.ads).sort((a, b) => b[1].spend - a[1].spend).slice(0, 10);
    const genderNames = Object.keys(data.genders).filter(g => g !== 'unknown');
    const ageNames = Object.keys(data.ages).filter(a => a !== 'unknown');

    // Split by source for tabs
    const fbReports = currentReports.filter(r => r.source === 'facebook');
    const gReports = currentReports.filter(r => r.source && r.source.startsWith('google'));
    const hasFb = fbReports.length > 0;
    const hasG = gReports.length > 0;
    let fbTotals = null, gTotals = null;
    if (hasFb) { let rows = []; fbReports.forEach(r => { rows = rows.concat(r.data || []); }); fbTotals = aggregateRows(rows).totals; }
    if (hasG) { let rows = []; gReports.forEach(r => { rows = rows.concat(r.data || []); }); gTotals = aggregateRows(rows).totals; }
    const activeT = dashTab === 'facebook' && fbTotals ? fbTotals : dashTab === 'google' && gTotals ? gTotals : t;
    const activeP = dashTab !== 'all' ? null : p;

    return (
      <>
        {/* Source Tabs */}
        {(hasFb && hasG) && (
          <div style={{display:'flex', gap:'8px', marginBottom:'20px'}}>
            <button className={`btn ${dashTab === 'all' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDashTab('all')}>הכל</button>
            <button className={`btn ${dashTab === 'facebook' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDashTab('facebook')}>Facebook</button>
            <button className={`btn ${dashTab === 'google' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDashTab('google')}>Google</button>
          </div>
        )}

        <div className="kpi-grid">
          {kpi('תקציב', formatCurrency(activeT.spend), '', activeT.spend, activeP?.spend, true)}
          {kpi('לידים', formatNum(activeT.leads), 'green', activeT.leads, activeP?.leads)}
          {kpi('עלות לליד', formatCurrency(activeT.cpl), 'purple', activeT.cpl, activeP?.cpl, true)}
          {kpi('חשיפות', formatNum(activeT.impressions), 'cyan', activeT.impressions, activeP?.impressions)}
          {kpi('חשיפה ייחודית', formatNum(activeT.reach), 'pink', activeT.reach, activeP?.reach)}
          {kpi('קליקים', formatNum(activeT.clicks), 'orange', activeT.clicks, activeP?.clicks)}
          {kpi('CPC', formatCurrency(activeT.cpc), 'red', activeT.cpc, activeP?.cpc, true)}
          {kpi('CPM', formatCurrency(activeT.cpm), 'purple', activeT.cpm, activeP?.cpm, true)}
          {kpi('CTR', activeT.ctr.toFixed(2) + '%', 'green', activeT.ctr, activeP?.ctr)}
          {kpi('אחוז המרה', activeT.convRate.toFixed(2) + '%', '', activeT.convRate, activeP?.convRate)}
          {kpi('תדירות', activeT.frequency.toFixed(2), 'orange', activeT.frequency, activeP?.frequency, true)}
        </div>
        {trendData.length > 1 && (<div className="section"><div className="section-title">📈 מגמות חודשיות</div><div className="chart-grid"><div className="chart-card"><h4>לידים ועלות לליד</h4><div className="chart-container"><canvas id="trendLeads"></canvas></div></div><div className="chart-card"><h4>תקציב וחשיפות</h4><div className="chart-container"><canvas id="trendSpend"></canvas></div></div></div></div>)}
        {campNames.length > 0 && (<div className="section"><div className="section-title">🎯 קמפיינים</div><div className="chart-grid"><div className="chart-card"><h4>התפלגות תקציב</h4><div className="chart-container"><canvas id="campSpend"></canvas></div></div><div className="chart-card"><h4>לידים ו-CPL</h4><div className="chart-container"><canvas id="campLeads"></canvas></div></div></div>{buildTable(data.campaigns, prevData?.campaigns, 'קמפיין')}</div>)}
        <div className="section"><div className="section-title">📋 קבוצות מודעות</div>{buildTable(data.adSets, prevData?.adSets, 'קבוצת מודעות')}</div>
        <div className="section"><div className="section-title">📝 מודעות</div>{buildTable(data.ads, prevData?.ads, 'מודעה')}{adEntries.filter(([,a]) => a.text).map(([name, ad]) => { const cpl = ad.leads > 0 ? ad.spend / ad.leads : 0; const cplClass = cpl > 0 && cpl < 50 ? 'cpl-good' : cpl < 100 ? 'cpl-ok' : 'cpl-bad'; return (<div className="ad-text-card" key={name}><div className="ad-name">{name}</div><div className="ad-body" onClick={e => e.currentTarget.classList.toggle('expanded')}>{ad.text}</div><div className="ad-metrics"><div>Budget: <span>{formatCurrency(ad.spend)}</span></div><div>Leads: <span>{ad.leads}</span></div><div>CPL: <span className={`cpl-badge ${cplClass}`}>{formatCurrency(cpl)}</span></div></div></div>); })}</div>
        {genderNames.length > 0 && (<div className="section"><div className="section-title">👤 מגדר</div><div className="chart-grid"><div className="chart-card"><h4>התפלגות תקציב</h4><div className="chart-container"><canvas id="genderChart"></canvas></div></div></div></div>)}
        {ageNames.length > 0 && (<div className="section"><div className="section-title">📊 גיל</div><div className="chart-grid"><div className="chart-card"><h4>לידים ו-CPL לפי גיל</h4><div className="chart-container"><canvas id="ageChart"></canvas></div></div></div></div>)}
      </>
    );
  }, [selectedMonth, compareEnabled, reports]);

  if (loading) return <div className="loading-page">טוען...</div>;

  if (!session) {
    return (
      <div className="login-container">
        <h1 className="logo" style={{fontSize: '3em'}}>VITAS</h1>
        <p className="subtitle">מערכת דוחות שיווק דיגיטלי</p>
        <div className="card">
          <form onSubmit={handleAuth}>
            <div className="form-group"><label>אימייל</label><input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" required /></div>
            <div className="form-group"><label>סיסמה</label><input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} dir="ltr" required /></div>
            {authError && <p style={{color: 'var(--danger)', fontSize: '0.85em', marginBottom: 10}}>{authError}</p>}
            <button className="btn btn-primary btn-lg" style={{width: '100%'}} type="submit">{isSignUp ? 'הרשמה' : 'כניסה'}</button>
          </form>
          <p style={{textAlign: 'center', marginTop: 15, fontSize: '0.85em', color: 'var(--text-secondary)'}}><span style={{cursor: 'pointer', color: 'var(--accent)'}} onClick={() => setIsSignUp(!isSignUp)}>{isSignUp ? 'יש לי חשבון — כניסה' : 'משתמש חדש — הרשמה'}</span></p>
        </div>
      </div>
    );
  }

  const getClientProjects = (clientId) => { const client = clients.find(c => c.id === clientId); return client?.projects || []; };

  return (
    <>
      <div className="header"><div className="header-content"><div className="logo">VITAS REPORTS</div><div className="header-nav"><button className={`nav-btn ${view === 'upload' ? 'active' : ''}`} onClick={() => setView('upload')}>📤 העלאת נתונים</button><button className={`nav-btn ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>📋 היסטוריה</button><button className="nav-btn danger" onClick={handleLogout}>יציאה</button></div></div></div>
      <div className="app-layout">
        <div className="sidebar"><div style={{padding: '0 15px', marginBottom: 20}}>
          <div className="sidebar-title">לקוחות</div>
          {clients.map(client => (<div key={client.id}>
            <div className={`client-item ${selectedClient?.id === client.id ? 'active' : ''}`} onClick={() => { setSelectedClient(client); setSelectedProject(null); setView('welcome'); }}><div className="client-dot" style={{background: client.color}}></div>{client.name}</div>
            {selectedClient?.id === client.id && client.projects?.map(proj => (<div key={proj.id} className={`project-item ${selectedProject?.id === proj.id ? 'active' : ''}`} onClick={() => selectProject(client, proj)}>📂 {proj.name}</div>))}
            {selectedClient?.id === client.id && (<><div className="add-btn indent" onClick={() => setShowAddProject(true)}>+ הוסף פרויקט</div><div style={{padding: '5px 25px'}}><div className="link-box" style={{marginTop: 5}}><small>לינק ללקוח:</small><input readOnly value={typeof window !== 'undefined' ? `${window.location.origin}/client/${client.token}` : ''} onClick={e => {e.target.select(); navigator.clipboard?.writeText(e.target.value); showToast('הלינק הועתק!');}} /></div></div></>)}
          </div>))}
          <div className="add-btn" onClick={() => setShowAddClient(true)}>+ הוסף לקוח</div>
        </div></div>

        <div className="main-content">
          {view === 'welcome' && (<div className="welcome-center"><div className="icon">📊</div><h2>ברוכים הבאים</h2><p>בחר פרויקט מהתפריט כדי לצפות בדוח, או העלה נתונים חדשים</p></div>)}

          {view === 'upload' && (<>
            <h2 style={{fontSize: '1.8em', fontWeight: 800, marginBottom: 20}}>📤 העלאת נתונים</h2>
            <div className="card"><h3 style={{marginBottom: 15, fontWeight: 700}}>הגדרות</h3>
              <div className="form-row"><div className="form-group"><label>לקוח</label><select className="form-input" value={uploadClient} onChange={e => setUploadClient(e.target.value)}><option value="">בחר לקוח</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="form-group"><label>פרויקט</label><select className="form-input" value={uploadProject} onChange={e => setUploadProject(e.target.value)}><option value="">בחר פרויקט</option>{getClientProjects(uploadClient).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div></div>
              <div className="form-row"><div className="form-group"><label>מקור</label><select className="form-input" value={uploadSource} onChange={e => setUploadSource(e.target.value)}><option value="facebook">Facebook Ads</option><option value="google_pmax">Google Ads PMax</option><option value="google_search">Google Ads Search</option><option value="crm">CRM</option></select></div><div className="form-group"><label>חודש</label><input className="form-input" type="month" value={uploadMonth} onChange={e => setUploadMonth(e.target.value)} /></div></div>
            </div>
            <div className="upload-area" onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }} onDragLeave={e => e.currentTarget.classList.remove('dragover')} onDrop={handleDrop} onClick={() => document.getElementById('fileInput').click()}>
              {uploading ? (<><div className="spinner" style={{borderColor: 'rgba(59,130,246,0.3)', borderTopColor: 'var(--accent)', width: 40, height: 40}}></div><h3 style={{marginTop: 15}}>מעבד...</h3></>) : (<><div className="upload-icon">📁</div><h3>גרור קובץ אקסל לכאן</h3><p style={{color: 'var(--text-secondary)'}}>או לחץ לבחירת קובץ</p></>)}
              <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style={{display: 'none'}} onChange={e => { if (e.target.files.length) handleFile(e.target.files[0]); }} />
            </div>
            {uploadResult?.success && (<div className="card" style={{borderColor: 'var(--success)', borderWidth: 2}}><h3 style={{color: 'var(--success)'}}>✅ הועלה בהצלחה!</h3><p style={{color: 'var(--text-secondary)', marginBottom: 15}}>{uploadResult.fileName} — {uploadResult.rowCount} שורות</p><div className="kpi-grid"><div className="kpi-card"><div className="kpi-label">תקציב</div><div className="kpi-value">{formatCurrency(uploadResult.totals.spend)}</div></div><div className="kpi-card green"><div className="kpi-label">לידים</div><div className="kpi-value">{uploadResult.totals.leads}</div></div><div className="kpi-card purple"><div className="kpi-label">CPL</div><div className="kpi-value">{formatCurrency(uploadResult.totals.cpl)}</div></div></div></div>)}
          </>)}

          {view === 'dashboard' && selectedProject && (<>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25}}>
              <h2 style={{fontSize: '1.8em', fontWeight: 800}}>{selectedClient?.name} / {selectedProject.name}</h2>
              <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                <select className="form-input" style={{width: 'auto'}} value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>{[...new Set(reports.map(r => r.month))].sort().reverse().map(m => (<option key={m} value={m}>{formatMonth(m)}</option>))}</select>
                <label style={{fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer'}}><input type="checkbox" checked={compareEnabled} onChange={e => setCompareEnabled(e.target.checked)} />השוואה לחודש קודם</label>
              </div>
            </div>
            {reports.length === 0 ? (<div className="welcome-center"><div className="icon">📭</div><h3>אין נתונים עדיין</h3><button className="btn btn-primary btn-lg" onClick={() => setView('upload')} style={{marginTop: 15}}>📤 העלאת נתונים</button></div>) : renderDashboard()}
          </>)}

          {view === 'history' && (<><h2 style={{fontSize: '1.8em', fontWeight: 800, marginBottom: 20}}>📋 היסטוריה</h2><HistoryView clients={clients} showToast={showToast} onRefresh={loadClients} /></>)}
        </div>
      </div>

      <div className={`modal-overlay ${showAddClient ? 'active' : ''}`} onClick={e => { if (e.target === e.currentTarget) setShowAddClient(false); }}><div className="modal"><h3>הוסף לקוח חדש</h3><div className="form-group"><label>שם לקוח</label><input className="form-input" value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder="לדוגמה: ש.ברוך" /></div><div className="form-group"><label>פרויקטים (מופרדים בפסיקים)</label><input className="form-input" value={newClientProjects} onChange={e => setNewClientProjects(e.target.value)} placeholder="לדוגמה: HI PARK, ONCE" /></div><div className="form-group"><label>צבע</label><select className="form-input" value={newClientColor} onChange={e => setNewClientColor(e.target.value)}><option value="#3b82f6">כחול</option><option value="#10b981">ירוק</option><option value="#8b5cf6">סגול</option><option value="#f59e0b">כתום</option><option value="#ec4899">ורוד</option></select></div><div className="modal-actions"><button className="btn btn-primary" onClick={addClient}>הוסף</button><button className="btn btn-outline" onClick={() => setShowAddClient(false)}>ביטול</button></div></div></div>

      <div className={`modal-overlay ${showAddProject ? 'active' : ''}`} onClick={e => { if (e.target === e.currentTarget) setShowAddProject(false); }}><div className="modal"><h3>הוסף פרויקט ל-{selectedClient?.name}</h3><div className="form-group"><label>שם פרויקט</label><input className="form-input" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="לדוגמה: HI PARK" /></div><div className="modal-actions"><button className="btn btn-primary" onClick={addProject}>הוסף</button><button className="btn btn-outline" onClick={() => setShowAddProject(false)}>ביטול</button></div></div></div>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  );
}

function HistoryView({ clients }) {
  const [reports, setReports] = useState([]);
  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('reports').select('*, projects!inner(name, client_id, clients!inner(name))').order('created_at', { ascending: false });
      if (data) setReports(data);
    }
    load();
  }, []);

  const deleteReport = async (id) => {
    if (!confirm('למחוק את ההעלאה?')) return;
    await supabase.from('reports').delete().eq('id', id);
    setReports(prev => prev.filter(r => r.id !== id));
  };

  if (reports.length === 0) return <div className="welcome-center"><div className="icon">📭</div><h3>אין העלאות עדיין</h3></div>;

  return reports.map(r => (
    <div className="card" key={r.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <div>
        <h4 style={{fontWeight: 700}}>{r.projects?.clients?.name} / {r.projects?.name} — {formatMonth(r.month)}</h4>
        <p style={{color: 'var(--text-secondary)', fontSize: '0.9em'}}>{r.source === 'facebook' ? 'Facebook' : r.source === 'google_pmax' ? 'Google PMax' : r.source === 'google_search' ? 'Google Search' : r.source === 'google' ? 'Google' : 'CRM'} | {r.file_name} | {r.row_count} rows</p>
      </div>
      <button className="btn btn-danger" style={{fontSize: '0.8em', padding: '6px 12px'}} onClick={() => deleteReport(r.id)}>🗑</button>
    </div>
  ));
}
