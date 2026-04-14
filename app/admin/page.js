'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatNum, formatMonth, mapFacebookRows, mapGoogleRows, mapCrmRows, mapCrmReportRows, aggregateRows, aggregateCrmRows, aggregateCrmReportRows, changePercent, getPrevMonth, COLORS } from '../../lib/helpers'
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
  const [crmSubTab, setCrmSubTab] = useState('sources')
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
    e.preventDefault(); setAuthError('');
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
    if (data) { setReports(data); if (data.length > 0) setSelectedMonth(data[0].month); }
    else { setReports([]); }
  };

  const addClient = async () => {
    if (!newClientName.trim()) return;
    const { data: client, error } = await supabase.from('clients').insert({ name: newClientName.trim(), color: newClientColor }).select().single();
    if (error) { showToast('Error: ' + error.message); return; }
    const projects = newClientProjects ? newClientProjects.split(',').map(p => p.trim()).filter(Boolean) : ['General'];
    for (const name of projects) { await supabase.from('projects').insert({ client_id: client.id, name }); }
    setNewClientName(''); setNewClientProjects(''); setShowAddClient(false);
    await loadClients(); showToast('Client "' + client.name + '" added');
  };

  const addProject = async () => {
    if (!newProjectName.trim() || !selectedClient) return;
    await supabase.from('projects').insert({ client_id: selectedClient.id, name: newProjectName.trim() });
    setNewProjectName(''); setShowAddProject(false);
    await loadClients(); showToast('Project "' + newProjectName + '" added');
  };

  const handleResetData = async () => {
    if (!selectedProject) return alert('\u05d1\u05d7\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e7\u05d5\u05d3\u05dd');
    if (!confirm('\u05d4\u05d0\u05dd \u05d0\u05ea\u05d4 \u05d1\u05d8\u05d5\u05d7 \u05e9\u05d1\u05d8\u05e6\u05d5\u05e0\u05da \u05dc\u05de\u05d7\u05d5\u05e7 \u05d0\u05ea \u05db\u05dc \u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05e9\u05dc \u05d4\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05d4\u05d6\u05d4?')) return;
    const { error } = await supabase.from('reports').delete().eq('project_id', selectedProject.id);
    if (error) return alert('\u05e9\u05d2\u05d9\u05d0\u05d4: ' + error.message);
    setReports([]); alert('\u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05e0\u05de\u05d7\u05e7\u05d5 \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4');
  };

  const handleFile = async (file) => {
    if (!uploadClient || !uploadProject || !uploadMonth) { showToast('Please fill all fields'); return; }
    setUploading(true); setUploadResult(null);
    try {
      const data = await file.arrayBuffer();
      let json;
      const bytes = new Uint8Array(data);
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
        const text = new TextDecoder('utf-16le').decode(data);
        const lines = text.split('\n').map(l => l.trim()).filter(l => l);
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
      let summary;
      if (uploadSource === 'facebook') {
        mapped = mapFacebookRows(json);
        summary = aggregateRows(mapped);
      } else if (uploadSource === 'google_pmax' || uploadSource === 'google_search') {
        mapped = mapGoogleRows(json);
        if (uploadSource === 'google_pmax') mapped = mapped.map(r => ({ ...r, campaign: 'PMAX' }));
        else if (uploadSource === 'google_search') mapped = mapped.map(r => ({ ...r, campaign: 'Search' }));
        summary = aggregateRows(mapped);
      } else if (uploadSource === 'crm') {
        mapped = mapCrmRows(json);
        summary = aggregateCrmRows(mapped);
      } else if (uploadSource === 'crm_reports') {
        mapped = mapCrmReportRows(json);
        summary = aggregateCrmReportRows(mapped);
      } else {
        mapped = json;
        summary = {};
      }

      const { error } = await supabase.from('reports').upsert({
        project_id: uploadProject,
        source: uploadSource,
        month: uploadMonth,
        data: mapped,
        summary: uploadSource === 'crm' ? summary.totals : summary.totals,
        file_name: file.name,
        row_count: mapped.length,
      }, { onConflict: 'project_id,source,month' });

      if (error) throw error;

      if (uploadSource === 'crm') {
        setUploadResult({ success: true, fileName: file.name, rowCount: mapped.length, crmTotals: summary.totals });
      } else if (uploadSource === 'crm_reports') {
        setUploadResult({ success: true, fileName: file.name, rowCount: mapped.length, crmReportTotals: summary.totals });
      } else {
        setUploadResult({ success: true, fileName: file.name, rowCount: mapped.length, totals: summary.totals });
      }
      showToast('Data uploaded successfully!');
    } catch (err) {
      setUploadResult({ success: false, error: err.message });
      showToast('Error: ' + err.message);
    }
    setUploading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.currentTarget.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  };

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

  const renderCrmReportDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null;
    destroyCharts();

    const crmRepReports = reports.filter(r => r.month === selectedMonth && r.source === 'crm_reports');
    if (crmRepReports.length === 0) return <div className="welcome-center"><div className="icon">{'\ud83d\udcad'}</div><h3>{'\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9 CRM \u05d3\u05d5\u05d7\u05d5\u05ea \u05dc\u05d7\u05d5\u05d3\u05e9 \u05d6\u05d4'}</h3></div>;

    let allRows = [];
    crmRepReports.forEach(r => { if (r.data) allRows = allRows.concat(r.data); });
    const repData = aggregateCrmReportRows(allRows);
    const rt = repData.totals;

    const cityEntries = Object.entries(repData.cities).sort((a, b) => b[1] - a[1]);
    const objEntries = Object.entries(repData.objectionTypes).sort((a, b) => b[1] - a[1]);
    const cityNames = cityEntries.map(([n]) => n);
    const objNames = objEntries.map(([n]) => n);

    setTimeout(() => {
      destroyCharts();
      if (cityNames.length > 0) {
        createChart('crmRepCityChart', 'bar', cityNames, [{
          label: '\u05dc\u05d9\u05d3\u05d9\u05dd', data: cityNames.map(n => repData.cities[n]),
          backgroundColor: COLORS.slice(0, cityNames.length)
        }], { y: { beginAtZero: true, position: 'right' } });
      }
      if (objNames.length > 0) {
        createChart('crmRepObjChart', 'doughnut', objNames, [{
          data: objNames.map(n => repData.objectionTypes[n]),
          backgroundColor: COLORS.slice(0, objNames.length)
        }]);
      }
    }, 200);

    return (
      <>
        <div className="kpi-grid">
          <div className="kpi-card"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(59,130,246,0.1)',color:'var(--accent)'}}>{'\ud83d\udcdd'}</div><div className="kpi-label">{'\u05e1\u05d4"\u05db \u05e9\u05d5\u05d8\u05d5\u05ea'}</div><div className="kpi-value">{formatNum(rt.totalRows)}</div></div>
          <div className="kpi-card green"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(16,185,129,0.1)',color:'var(--success)'}}>{'\ud83c\udfd8\ufe0f'}</div><div className="kpi-label">{'\u05e2\u05e8\u05d9\u05dd \u05d9\u05d9\u05d7\u05d5\u05d3\u05d9\u05d5\u05ea'}</div><div className="kpi-value">{formatNum(rt.uniqueCities)}</div></div>
          <div className="kpi-card purple"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(139,92,246,0.1)',color:'var(--purple)'}}>{'\u26a0\ufe0f'}</div><div className="kpi-label">{'\u05e2\u05dd \u05d4\u05ea\u05e0\u05d2\u05d3\u05d5\u05d9\u05d5\u05ea'}</div><div className="kpi-value">{formatNum(rt.withObjections)}</div></div>
          <div className="kpi-card orange"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(245,158,11,0.1)',color:'var(--warning)'}}>{'\ud83d\udcc5'}</div><div className="kpi-label">{'\u05e2\u05dd \u05e4\u05d2\u05d9\u05e9\u05d4/\u05de\u05e9\u05d9\u05de\u05d4'}</div><div className="kpi-value">{formatNum(rt.withMeeting)}</div></div>
          <div className="kpi-card pink"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(236,72,153,0.1)',color:'var(--pink)'}}>{'\ud83d\udcca'}</div><div className="kpi-label">{'% \u05d4\u05ea\u05e0\u05d2\u05d3\u05d5\u05d9\u05d5\u05ea'}</div><div className="kpi-value">{rt.objectionRate.toFixed(1)}%</div></div>
          <div className="kpi-card cyan"><div className="kpi-accent"></div><div className="kpi-icon" style={{background:'rgba(6,182,212,0.1)',color:'var(--cyan)'}}>{'\ud83d\udcca'}</div><div className="kpi-label">{'% \u05e4\u05d2\u05d9\u05e9\u05d5\u05ea'}</div><div className="kpi-value">{rt.meetingRate.toFixed(1)}%</div></div>
        </div>

        {/* Data Table */}
        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>{'\ud83d\udccb'}</div>{'\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05de\u05e4\u05d5\u05e8\u05d8\u05d9\u05dd'}</div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr>
                <th>#</th>
                <th>{'\u05db\u05ea\u05d5\u05d1\u05ea/\u05d9\u05d9\u05e9\u05d5\u05d1'}</th>
                <th>{'\u05d4\u05ea\u05e0\u05d2\u05d3\u05d5\u05d9\u05d5\u05ea'}</th>
                <th>{'\u05de\u05e9\u05d9\u05dd\u05d4/\u05e4\u05d2\u05d9\u05e9\u05d4 \u05d0\u05d7\u05e8\u05d5\u05e0\u05d4'}</th>
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

        {/* Charts */}
        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-2)'}}>{'\ud83d\udcc8'}</div>{'\u05d2\u05e8\u05e4\u05d9\u05dd'}</div>
          <div className="chart-grid">
            <div className="chart-card"><h4>{'\ud83c\udfd8\ufe0f \u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05dc\u05e4\u05d9 \u05d9\u05d9\u05e9\u05d5\u05d1'}</h4><div className="chart-container"><canvas id="crmRepCityChart"></canvas></div></div>
            <div className="chart-card"><h4>{'\u26a0\ufe0f \u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05d4\u05ea\u05e0\u05d2\u05d3\u05d5\u05d9\u05d5\u05ea'}</h4><div className="chart-container"><canvas id="crmRepObjChart"></canvas></div></div>
          </div>
        </div>
      </>
    );
  }, [selectedMonth, reports]);

  const renderCrmDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null;
    destroyCharts();

    const crmReports = reports.filter(r => r.month === selectedMonth && r.source === 'crm');
    if (crmReports.length === 0) return <div className="welcome-center"><div className="icon">ð­</div><h3>\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9 CRM \u05dc\u05d7\u05d5\u05d3\u05e9 \u05d6\u05d4</h3></div>;

    let allCrmRows = [];
    crmReports.forEach(r => { if (r.data) allCrmRows = allCrmRows.concat(r.data); });
    const crmData = aggregateCrmRows(allCrmRows);

    let prevCrmData = null;
    if (compareEnabled) {
      const prevMonth = getPrevMonth(selectedMonth);
      const prevCrmReports = reports.filter(r => r.month === prevMonth && r.source === 'crm');
      if (prevCrmReports.length > 0) {
        let prevRows = [];
        prevCrmReports.forEach(r => { prevRows = prevRows.concat(r.data || []); });
        prevCrmData = aggregateCrmRows(prevRows);
      }
    }

    const ct = crmData.totals;
    const cp = prevCrmData?.totals;

    const crmKpi = (label, value, color, current, prev, isCost) => {
      const ch = prev != null ? changePercent(current, prev, isCost) : null;
      const icons = { '\u05e1\u05d4"\u05db \u05dc\u05d9\u05d3\u05d9\u05dd': '\u05d1\u05e9', '\u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd': '\u2705', '\u05dc\u05d0 \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd': '\u274c', '\u05ea\u05d5\u05d0\u05de\u05d5': '\u05e4\u05d2', '\u05d1\u05d5\u05e6\u05e2\u05d5': '\u05e9\u05d8', '\u05d1\u05d5\u05d8\u05dc\u05d5': '\u05d1\u05d8', '\u05d4\u05e8\u05e9\u05de\u05d5\u05ea': '\u05d4\u05e8', '\u05e9\u05d5\u05d5\u05d9 \u05d4\u05e8\u05e9\u05de\u05d5\u05ea': '\u20aa', '\u05d7\u05d5\u05d6\u05d9\u05dd': '\u05d7\u05d6', '\u05e9\u05d5\u05d5\u05d9 \u05d7\u05d5\u05d6\u05d9\u05dd': '\u20aa', '% \u05ea\u05d9\u05d0\u05d5\u05dd': '%', '% \u05d1\u05d9\u05e6\u05d5\u05e2': '%', '% \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d5\u05ea': '%', '% \u05d7\u05d5\u05d6\u05d9\u05dd': '%' };
      const icon = icons[label] || '\ud83d\udcca';
      const kpiColors = { green: 'rgba(16,185,129,0.1)', purple: 'rgba(139,92,246,0.1)', orange: 'rgba(245,158,11,0.1)', pink: 'rgba(236,72,153,0.1)', cyan: 'rgba(6,182,212,0.1)', red: 'rgba(239,68,68,0.1)' };
      const kpiTextColors = { green: 'var(--success)', purple: 'var(--purple)', orange: 'var(--warning)', pink: 'var(--pink)', cyan: 'var(--cyan)', red: 'var(--danger)' };
      return <div className={`kpi-card ${color}`} key={label}><div className="kpi-accent"></div><div className="kpi-icon" style={{background: kpiColors[color] || 'rgba(59,130,246,0.1)', color: kpiTextColors[color] || 'var(--accent)'}}>{icon}</div><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{ch && <div className={`kpi-change ${ch.isGood ? 'up' : 'down'}`}><span className="arrow">{ch.pct > 0 ? '\u25b2' : '\u25bc'}</span> {Math.abs(ch.pct).toFixed(1)}%</div>}</div>;
    };

    const sourceEntries = Object.entries(crmData.sources).sort((a, b) => b[1].totalLeads - a[1].totalLeads);
    const sourceNames = sourceEntries.map(([name]) => name);

    setTimeout(() => {
      destroyCharts();
      if (sourceNames.length > 0) {
        createChart('crmLeadsChart', 'bar', sourceNames, [
          { label: '\u05e1\u05d4"\u05db \u05dc\u05d9\u05d3\u05d9\u05dd', data: sourceNames.map(n => crmData.sources[n].totalLeads), backgroundColor: 'rgba(59,130,246,0.7)' },
          { label: '\u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd', data: sourceNames.map(n => crmData.sources[n].relevantLeads), backgroundColor: 'rgba(16,185,129,0.7)' },
        ], { y: { beginAtZero: true, position: 'right' } });

        createChart('crmFunnelChart', 'bar', sourceNames, [
          { label: '\u05ea\u05d5\u05d0\u05dd\u05d5', data: sourceNames.map(n => crmData.sources[n].meetingsScheduled), backgroundColor: 'rgba(139,92,246,0.7)' },
          { label: '\u05d1\u05d5\u05e6\u05e2\u05d5', data: sourceNames.map(n => crmData.sources[n].meetingsCompleted), backgroundColor: 'rgba(245,158,11,0.7)' },
          { label: '\u05d4\u05e8\u05e9\u05dd\u05d5\u05ea', data: sourceNames.map(n => crmData.sources[n].registrations), backgroundColor: 'rgba(236,72,153,0.7)' },
          { label: '\u05d7\u05d5\u05d6\u05d9\u05dd', data: sourceNames.map(n => crmData.sources[n].contracts), backgroundColor: 'rgba(6,182,212,0.7)' },
        ], { y: { beginAtZero: true, position: 'right' } });

        createChart('crmPieChart', 'doughnut', sourceNames, [{
          data: sourceNames.map(n => crmData.sources[n].totalLeads),
          backgroundColor: COLORS.slice(0, sourceNames.length)
        }]);
      }
    }, 200);

    return (
      <>
        <div className="kpi-grid">
          {crmKpi('\u05e1\u05d4"\u05db \u05dc\u05d9\u05d3\u05d9\u05dd', formatNum(ct.totalLeads), '', ct.totalLeads, cp?.totalLeads)}
          {crmKpi('\u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd', formatNum(ct.relevantLeads), 'green', ct.relevantLeads, cp?.relevantLeads)}
          {crmKpi('\u05dc\u05d0 \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd', formatNum(ct.irrelevantLeads), 'red', ct.irrelevantLeads, cp?.irrelevantLeads, true)}
          {crmKpi('% \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d5\u05ea', ct.relevantRate.toFixed(1) + '%', 'cyan', ct.relevantRate, cp?.relevantRate)}
          {crmKpi('\u05ea\u05d5\u05d0\u05de\u05d5', formatNum(ct.meetingsScheduled), 'purple', ct.meetingsScheduled, cp?.meetingsScheduled)}
          {crmKpi('\u05d1\u05d5\u05e6\u05e2\u05d5', formatNum(ct.meetingsCompleted), 'orange', ct.meetingsCompleted, cp?.meetingsCompleted)}
          {crmKpi('% \u05ea\u05d9\u05d0\u05d5\u05dd', ct.scheduledRate.toFixed(1) + '%', 'pink', ct.scheduledRate, cp?.scheduledRate)}
          {crmKpi('% \u05d1\u05d9\u05e6\u05d5\u05e2', ct.completedRate.toFixed(1) + '%', '', ct.completedRate, cp?.completedRate)}
          {crmKpi('\u05d1\u05d5\u05d8\u05dc\u05d5', formatNum(ct.meetingsCancelled), 'red', ct.meetingsCancelled, cp?.meetingsCancelled, true)}
          {crmKpi('\u05d4\u05e8\u05e9\u05dd\u05d5\u05ea', formatNum(ct.registrations), 'green', ct.registrations, cp?.registrations)}
          {crmKpi('\u05e9\u05d5\u05d5\u05d9 \u05d4\u05e8\u05e9\u05dd\u05d5\u05ea', formatCurrency(ct.registrationValue), 'purple', ct.registrationValue, cp?.registrationValue)}
          {crmKpi('\u05d7\u05d5\u05d6\u05d9\u05dd', formatNum(ct.contracts), 'cyan', ct.contracts, cp?.contracts)}
          {crmKpi('\u05e9\u05d5\u05d5\u05d9 \u05d7\u05d5\u05d6\u05d9\u05dd', formatCurrency(ct.contractValue), 'orange', ct.contractValue, cp?.contractValue)}
          {crmKpi('% \u05d7\u05d5\u05d6\u05d9\u05dd', ct.contractRate.toFixed(1) + '%', 'pink', ct.contractRate, cp?.contractRate)}
        </div>

        {/* CRM Funnel */}
        <div className="section">
          <div className="section-header" style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'20px'}}>
            <div className="section-icon" style={{background:'var(--gradient-2)'}}>{'\ud83d\uddc2\ufe0f'}</div>
            <div><h2 style={{fontSize:'1.3em',fontWeight:700,color:'var(--primary)',margin:0}}>{'\u05de\u05e9\u05e4\u05da \u05dc\u05d9\u05d3\u05d9\u05dd'}</h2><div style={{fontSize:'0.85em',color:'var(--text-secondary)'}}>{'\u05dd\u05dc\u05d9\u05d3 \u05d5\u05e2\u05d3 \u05d7\u05d5\u05d6\u05d4'}</div></div>
          </div>
          <div className="card" style={{padding:'24px'}}>
            <div className="funnel">
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-1)'}}>{formatNum(ct.totalLeads)}</div><div className="funnel-label">{'\u05e1\u05d4"\u05db \u05dc\u05d9\u05d3\u05d9\u05dd'}</div></div>
              <div className="funnel-arrow">{'\u2190'}</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--accent)',opacity:0.85}}>{formatNum(ct.relevantLeads)}</div><div className="funnel-label">{'\u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd'}</div><div className="funnel-rate">{ct.relevantRate.toFixed(1)}%</div></div>
              <div className="funnel-arrow">{'\u2190'}</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--purple)'}}>{formatNum(ct.meetingsScheduled)}</div><div className="funnel-label">{'\u05ea\u05d5\u05d0\u05de\u05d5'}</div><div className="funnel-rate">{ct.scheduledRate.toFixed(1)}%</div></div>
              <div className="funnel-arrow">{'\u2190'}</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-2)'}}>{formatNum(ct.meetingsCompleted)}</div><div className="funnel-label">{'\u05d1\u05d5\u05e6\u05e2\u05d5'}</div><div className="funnel-rate">{ct.completedRate.toFixed(1)}%</div></div>
              <div className="funnel-arrow">{'\u2190'}</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-4)'}}>{formatNum(ct.registrations)}</div><div className="funnel-label">{'\u05d4\u05e8\u05e9\u05de\u05d5\u05ea'}</div></div>
              <div className="funnel-arrow">{'\u2190'}</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-3)'}}>{formatNum(ct.contracts)}</div><div className="funnel-label">{'\u05d7\u05d5\u05d6\u05d9\u05dd'}</div></div>
            </div>
            <div style={{textAlign:'center',marginTop:'10px',fontSize:'0.85em',color:'var(--text-secondary)'}}>
              {'\u05e9\u05d5\u05d5\u05d9 \u05d4\u05e8\u05e9\u05de\u05d5\u05ea'}: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(ct.registrationValue)}</strong> &nbsp;|&nbsp; {'\u05e9\u05d5\u05d5\u05d9 \u05d7\u05d5\u05d6\u05d9\u05dd'}: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(ct.contractValue)}</strong>
            </div>
          </div>
        </div>

        {/* CRM Table by Source */}
        <div className="section">
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>{'\ud83d\udcca'}</div>{'\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05dc\u05e4\u05d9 \u05de\u05e7\u05d5\u05e8 \u05d4\u05d2\u05e2\u05d4'}</div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr>
                <th>{'\u05de\u05e7\u05d5\u05e8'}</th>
                <th>{'\u05e1\u05d4"\u05db \u05dc\u05d9\u05d3\u05d9\u05dd'}</th>
                <th>{'\u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd'}</th>
                <th>{'\u05dc\u05d0 \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd'}</th>
                <th>{'\u05ea\u05d5\u05d0\u05de\u05d5'}</th>
                <th>{'% \u05ea\u05d9\u05d0\u05d5\u05dd'}</th>
                <th>{'\u05d1\u05d5\u05e6\u05e2\u05d5'}</th>
                <th>{'% \u05d1\u05d9\u05e6\u05d5\u05e2'}</th>
                <th>{'\u05d1\u05d5\u05d8\u05dc\u05d5'}</th>
                <th>{'\u05d4\u05e8\u05e9\u05dd\u05d5\u05ea'}</th>
                <th>{'\u05e9\u05d5\u05d5\u05d9 \u05d4\u05e8\u05e9\u05dd\u05d5\u05ea'}</th>
                <th>{'\u05d7\u05d5\u05d6\u05d9\u05dd'}</th>
                <th>{'\u05e9\u05d5\u05d5\u05d9 \u05d7\u05d5\u05d6\u05d9\u05dd'}</th>
              </tr></thead>
              <tbody>
                {sourceEntries.map(([name, d]) => {
                  const schedRate = d.totalLeads > 0 ? (d.meetingsScheduled / d.totalLeads * 100).toFixed(1) : '0.0';
                  const compRate = d.totalLeads > 0 ? (d.meetingsCompleted / d.totalLeads * 100).toFixed(1) : '0.0';
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
                  );
                })}
                <tr style={{fontWeight:700,background:'var(--bg-secondary)'}}>
                  <td>{'\u05e1\u05d4"\u05db'}</td>
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
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-2)'}}>{'\ud83d\udcc8'}</div>{'\u05d2\u05e8\u05e4\u05d9\u05dd'}</div>
          <div className="chart-grid" style={{gridTemplateColumns: '1fr 1fr 1fr'}}>
            <div className="chart-card"><h4>{'\ud83d\udcca \u05dc\u05d9\u05d3\u05d9\u05dd \u05dc\u05e4\u05d9 \u05de\u05e7\u05d5\u05e8'}</h4><div className="chart-container"><canvas id="crmLeadsChart"></canvas></div></div>
            <div className="chart-card"><h4>{'\ud83c\udfaf \u05de\u05e9\u05e4\u05da \u05dc\u05e4\u05d9 \u05de\u05e7\u05d5\u05e8'}</h4><div className="chart-container"><canvas id="crmFunnelChart"></canvas></div></div>
            <div className="chart-card"><h4>{'\ud83e\udde9 \u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05dc\u05d9\u05d3\u05d9\u05dd'}</h4><div className="chart-container"><canvas id="crmPieChart"></canvas></div></div>
          </div>
        </div>
      </>
    );
  }, [selectedMonth, compareEnabled, reports]);

  const renderDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null;
    destroyCharts();

    const currentReports = reports.filter(r => r.month === selectedMonth);
    if (currentReports.length === 0) return <div className="welcome-center"><div className="icon">{'\ud83d\udced'}</div><h3>No data for this month</h3></div>;

    const displayReports = dashTab === 'all'
      ? currentReports.filter(r => r.source !== 'crm' && r.source !== 'crm_reports')
      : dashTab === 'facebook'
      ? currentReports.filter(r => r.source === 'facebook')
      : dashTab === 'google'
      ? currentReports.filter(r => r.source && r.source.startsWith('google'))
      : [];

    let allRows = [];
    displayReports.forEach(r => { if (r.data) allRows = allRows.concat(r.data); });
    const data = aggregateRows(allRows);

    // Add CRM leads to "all" tab totals
    let crmTotalLeads = 0;
    if (dashTab === 'all') {
      const crmReports = currentReports.filter(r => r.source === 'crm');
      crmReports.forEach(r => {
        if (r.data) {
          r.data.forEach(row => { crmTotalLeads += (typeof row.totalLeads === 'number' ? row.totalLeads : parseFloat(String(row.totalLeads).replace(/[^0-9.\-]/g, '')) || 0); });
        }
      });
    }

    let prevData = null;
    if (compareEnabled) {
      const prevMonth = getPrevMonth(selectedMonth);
      const prevReports = reports.filter(r => r.month === prevMonth);
      const displayPrev = dashTab === 'all'
        ? prevReports.filter(r => r.source !== 'crm')
        : dashTab === 'facebook'
        ? prevReports.filter(r => r.source === 'facebook')
        : prevReports.filter(r => r.source && r.source.startsWith('google'));
      if (displayPrev.length) { let prevRows = []; displayPrev.forEach(r => { prevRows = prevRows.concat(r.data); }); prevData = aggregateRows(prevRows); }
    }

    const allMonths = [...new Set(reports.map(r => r.month))].sort();
    const trendData = allMonths.map(m => {
      let mRows = [];
      reports.filter(r => r.month === m && r.source !== 'crm' && r.source !== 'crm_reports').forEach(r => { mRows = mRows.concat(r.data || []); });
      return { month: m, ...aggregateRows(mRows).totals };
    });

    const t = data.totals;
    const p = prevData?.totals;

    const kpiIcons = { '\u05d4\u05d5\u05e6\u05d0\u05d4': '\u20aa', '\u05dc\u05d9\u05d3\u05d9\u05dd': '\ud83d\udc65', 'CPL': '\ud83d\udcb0', '\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea': '\ud83d\udc41', '\u05ea\u05e4\u05d5\u05e6\u05d4': '\ud83d\udce1', '\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd': '\ud83d\uddb1', 'CPC': '\ud83d\udcb8', 'CPM': '\ud83d\udcca', 'CTR': '\ud83d\udcc8', '\u05d4\u05de\u05e8\u05d4': '\ud83d\udd04', '\u05ea\u05d3\u05d9\u05e8\u05d5\u05ea': '\ud83d\udd04' };
    const kpiColors = { green: 'rgba(16,185,129,0.1)', purple: 'rgba(139,92,246,0.1)', orange: 'rgba(245,158,11,0.1)', pink: 'rgba(236,72,153,0.1)', cyan: 'rgba(6,182,212,0.1)', red: 'rgba(239,68,68,0.1)' };
    const kpiTextColors = { green: 'var(--success)', purple: 'var(--purple)', orange: 'var(--warning)', pink: 'var(--pink)', cyan: 'var(--cyan)', red: 'var(--danger)' };

    const kpi = (label, value, color, current, prev, isCost) => {
      const ch = prev != null ? changePercent(current, prev, isCost) : null;
      const icon = kpiIcons[label] || '\ud83d\udcca';
      return <div className={`kpi-card ${color}`} key={label}><div className="kpi-accent"></div><div className="kpi-icon" style={{background: kpiColors[color] || 'rgba(59,130,246,0.1)', color: kpiTextColors[color] || 'var(--accent)'}}>{icon}</div><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{ch && <div className={`kpi-change ${ch.isGood ? 'up' : 'down'}`}><span className="arrow">{ch.pct > 0 ? '\u25b2' : '\u25bc'}</span> {Math.abs(ch.pct).toFixed(1)}%</div>}</div>;
    };

    const buildTable = (items, prevItems, labelName) => {
      const entries = Object.entries(items).sort((a, b) => b[1].spend - a[1].spend);
      const showCh = !!prevItems;
      const changeBadge = (curr, prev, isCost) => {
        if (!prev || prev === 0) return null;
        const pct = ((curr - prev) / prev) * 100;
        const isPos = isCost ? pct < 0 : pct > 0;
        return <span className={`change-badge ${isPos ? 'positive' : 'negative'}`}>{pct > 0 ? '\u25b2' : '\u25bc'} {Math.abs(pct).toFixed(1)}%</span>;
      };
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

    const fbReports = currentReports.filter(r => r.source === 'facebook');
    const gReports = currentReports.filter(r => r.source && r.source.startsWith('google'));
    const crmReports = currentReports.filter(r => r.source === 'crm');
    const crmRepReports = currentReports.filter(r => r.source === 'crm_reports');
    const hasFb = fbReports.length > 0;
    const hasG = gReports.length > 0;
    const hasCrm = crmReports.length > 0 || crmRepReports.length > 0;

    let fbTotals = null, gTotals = null;
    if (hasFb) { let fbRows = []; fbReports.forEach(r => { if (r.data) fbRows = fbRows.concat(r.data); }); fbTotals = aggregateRows(fbRows).totals; }
    if (hasG) { let gRows = []; gReports.forEach(r => { if (r.data) gRows = gRows.concat(r.data); }); gTotals = aggregateRows(gRows).totals; }

    const activeT = dashTab === 'facebook' && fbTotals ? fbTotals : dashTab === 'google' && gTotals ? gTotals : t;
    const activeP = dashTab !== 'all' ? null : p;

    // Total leads including CRM for "all" tab display
    const totalLeadsWithCrm = dashTab === 'all' ? t.leads + crmTotalLeads : activeT.leads;

    return (
      <>
        {/* Source Tabs */}
        <div className="client-tabs">
          <button className={`client-tab ${dashTab === 'all' ? 'active' : ''}`} onClick={() => setDashTab('all')}>{'\u05d4\u05db\u05dc'}</button>
          {hasFb && <button className={`client-tab ${dashTab === 'facebook' ? 'active' : ''}`} onClick={() => setDashTab('facebook')}>Facebook</button>}
          {hasG && <button className={`client-tab ${dashTab === 'google' ? 'active' : ''}`} onClick={() => setDashTab('google')}>Google</button>}
          {hasCrm && <button className={`client-tab ${dashTab === 'crm' ? 'active' : ''}`} onClick={() => setDashTab('crm')}>CRM</button>}
        </div>

        {dashTab === 'crm' ? (<>
          <div className="client-tabs" style={{marginBottom: 15}}>
            <button className={`client-tab ${crmSubTab === 'sources' ? 'active' : ''}`} onClick={() => setCrmSubTab('sources')}>{'\ud83d\udcc2 \u05de\u05e7\u05d5\u05e8\u05d5\u05ea \u05d4\u05d2\u05e2\u05d4'}</button>
            <button className={`client-tab ${crmSubTab === 'reports' ? 'active' : ''}`} onClick={() => setCrmSubTab('reports')}>{'\ud83d\udcca \u05de\u05d7\u05d5\u05dc\u05dc \u05d3\u05d5\u05d7\u05d5\u05ea'}</button>
          </div>
          {crmSubTab === 'sources' ? renderCrmDashboard() : renderCrmReportDashboard()}
        </>) : (<>
        <div className="kpi-grid">
          {kpi('\u05ea\u05e7\u05e6\u05d9\u05d1', formatCurrency(activeT.spend), '', activeT.spend, activeP?.spend, true)}
          {dashTab === 'all' ? kpi('\u05dc\u05d9\u05d3\u05d9\u05dd', formatNum(totalLeadsWithCrm), 'green', totalLeadsWithCrm, activeP?.leads) : kpi('\u05dc\u05d9\u05d3\u05d9\u05dd', formatNum(activeT.leads), 'green', activeT.leads, activeP?.leads)}
          {kpi('\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3', formatCurrency(activeT.cpl), 'purple', activeT.cpl, activeP?.cpl, true)}
          {kpi('\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea', formatNum(activeT.impressions), 'cyan', activeT.impressions, activeP?.impressions)}
          {kpi('\u05d7\u05e9\u05d9\u05e4\u05d4 \u05d9\u05d9\u05d7\u05d5\u05d3\u05d9\u05ea', formatNum(activeT.reach), 'pink', activeT.reach, activeP?.reach)}
          {kpi('\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd', formatNum(activeT.clicks), 'orange', activeT.clicks, activeP?.clicks)}
          {kpi('CPC', formatCurrency(activeT.cpc), 'red', activeT.cpc, activeP?.cpc, true)}
          {kpi('CPM', formatCurrency(activeT.cpm), 'purple', activeT.cpm, activeP?.cpm, true)}
          {kpi('CTR', activeT.ctr.toFixed(2) + '%', 'green', activeT.ctr, activeP?.ctr)}
          {kpi('\u05d0\u05d7\u05d5\u05d6 \u05d4\u05de\u05e8\u05d4', activeT.convRate.toFixed(2) + '%', '', activeT.convRate, activeP?.convRate)}
          {kpi('\u05ea\u05d3\u05d9\u05e8\u05d5\u05ea', activeT.frequency.toFixed(2), 'orange', activeT.frequency, activeP?.frequency, true)}
        </div>

        {/* FUNNEL */}
        <div className="section">
          <div className="section-header" style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'20px'}}>
            <div className="section-icon" style={{background:'var(--gradient-2)'}}>{'\ud83d\udd3d'}</div>
            <div><h2 style={{fontSize:'1.3em',fontWeight:700,color:'var(--primary)',margin:0}}>{'\u05de\u05e9\u05e4\u05da \u05e9\u05d9\u05d5\u05d5\u05e7\u05d9'}</h2><div style={{fontSize:'0.85em',color:'var(--text-secondary)'}}>{'\u05dd\u05d7\u05e9\u05d9\u05e4\u05d4 \u05d5\u05e2\u05d3 \u05dc\u05d9\u05d3'}</div></div>
          </div>
          <div className="card" style={{padding:'24px'}}>
            <div className="funnel">
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-1)'}}>{formatNum(activeT.impressions)}</div><div className="funnel-label">{'\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea'}</div></div>
              <div className="funnel-arrow">{'\u2190'}</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--accent)',opacity:0.85}}>{formatNum(activeT.reach)}</div><div className="funnel-label">{'\u05ea\u05e4\u05d5\u05e6\u05d4'}</div><div className="funnel-rate">{activeT.impressions > 0 ? (activeT.reach / activeT.impressions * 100).toFixed(1) : 0}% {'\u05dd\u05d4\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea'}</div></div>
              <div className="funnel-arrow">{'\u2190'}</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--purple)'}}>{formatNum(activeT.clicks)}</div><div className="funnel-label">{'\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd'}</div><div className="funnel-rate">CTR: {activeT.ctr ? activeT.ctr.toFixed(2) : 0}%</div></div>
              <div className="funnel-arrow">{'\u2190'}</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-2)'}}>{formatNum(activeT.leads)}</div><div className="funnel-label">{'\u05dc\u05d9\u05d3\u05d9\u05dd'}</div><div className="funnel-rate">{'\u05d4\u05de\u05e8\u05d4'}: {activeT.convRate ? activeT.convRate.toFixed(2) : 0}%</div></div>
            </div>
            <div style={{textAlign:'center',marginTop:'10px',fontSize:'0.85em',color:'var(--text-secondary)'}}>
              {'\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3'}: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(activeT.cpl)}</strong> &nbsp;|&nbsp; {'\u05e2\u05dc\u05d5\u05ea \u05dc\u05e7\u05dc\u05d9\u05e7'}: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(activeT.cpc)}</strong> &nbsp;|&nbsp; CPM: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(activeT.cpm)}</strong>
            </div>
          </div>
        </div>

        {trendData.length > 1 && (<div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>{'\ud83d\udcc8'}</div>{'\u05de\u05d2\u05dd\u05d5\u05ea \u05d7\u05d5\u05d3\u05e9\u05d9\u05d5\u05ea'}</div><div className="chart-grid"><div className="chart-card"><h4>{'\ud83d\udcb0 \u05dc\u05d9\u05d3\u05d9\u05dd \u05d5\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3'}</h4><div className="chart-container"><canvas id="trendLeads"></canvas></div></div><div className="chart-card"><h4>{'\ud83d\udcc8 \u05ea\u05e7\u05e6\u05d9\u05d1 \u05d5\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea'}</h4><div className="chart-container"><canvas id="trendSpend"></canvas></div></div></div></div>)}

        {campNames.length > 0 && (<div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>{'\ud83d\udccb'}</div>{'\u05e7\u05de\u05e4\u05d9\u05d9\u05e0\u05d9\u05dd'}</div><div className="chart-grid"><div className="chart-card"><h4>{'\ud83d\udcca \u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05ea\u05e7\u05e6\u05d9\u05d1'}</h4><div className="chart-container"><canvas id="campSpend"></canvas></div></div><div className="chart-card"><h4>{'\ud83d\udcb0 \u05dc\u05d9\u05d3\u05d9\u05dd \u05d5-CPL'}</h4><div className="chart-container"><canvas id="campLeads"></canvas></div></div></div>{buildTable(data.campaigns, prevData?.campaigns, '\u05e7\u05de\u05e4\u05d9\u05d9\u05df')}</div>)}

        <div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>{'\ud83c\udfaf'}</div>{'\u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea'}</div>{buildTable(data.adSets, prevData?.adSets, '\u05e7\u05d1\u05d5\u05e6\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea')}</div>

        <div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-3)'}}>{'\ud83d\udcdd'}</div>{'\u05de\u05d5\u05d3\u05e2\u05d5\u05ea'}</div>{buildTable(data.ads, prevData?.ads, '\u05de\u05d5\u05d3\u05e2\u05d4')}{adEntries.filter(([,a]) => a.text).map(([name, ad]) => { const cpl = ad.leads > 0 ? ad.spend / ad.leads : 0; const cplClass = cpl > 0 && cpl < 50 ? 'cpl-good' : cpl < 100 ? 'cpl-ok' : 'cpl-bad'; return (<div className="ad-text-card" key={name}><div className="ad-name">{name}</div><div className="ad-body" onClick={e => e.currentTarget.classList.toggle('expanded')}>{ad.text}</div><div className="ad-metrics"><div>Budget: <span>{formatCurrency(ad.spend)}</span></div><div>Leads: <span>{ad.leads}</span></div><div>CPL: <span className={`cpl-badge ${cplClass}`}>{formatCurrency(cpl)}</span></div></div></div>); })}</div>

        {genderNames.length > 0 && (<div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>{'\ud83d\udc64'}</div>{'\u05de\u05d2\u05d3\u05e8'}</div><div className="chart-grid"><div className="chart-card"><h4>{'\ud83d\udcca \u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05ea\u05e7\u05e6\u05d9\u05d1'}</h4><div className="chart-container"><canvas id="genderChart"></canvas></div></div></div></div>)}

        {ageNames.length > 0 && (<div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>{'\ud83d\udcca'}</div>{'\u05d2\u05d9\u05dc'}</div><div className="chart-grid"><div className="chart-card"><h4>{'\ud83d\udcca \u05dc\u05d9\u05d3\u05d9\u05dd \u05d5-CPL \u05dc\u05e4\u05d9 \u05d2\u05d9\u05dc'}</h4><div className="chart-container"><canvas id="ageChart"></canvas></div></div></div></div>)}
        </>)}
      </>
    );
  }, [selectedMonth, compareEnabled, reports, dashTab, crmSubTab, renderCrmDashboard, renderCrmReportDashboard]);

  if (loading) return <div className="loading-page">{'\u05d8\u05d5\u05e2\u05df...'}</div>;

  if (!session) {
    return (
      <div className="login-container">
        <h1 className="logo" style={{fontSize: '3em'}}>VITAS</h1>
        <p className="subtitle">{'\u05de\u05e2\u05e8\u05db\u05ea \u05d3\u05d5\u05d7\u05d5\u05ea \u05e9\u05d9\u05d5\u05d5\u05e7 \u05d3\u05d9\u05d2\u05d9\u05d8\u05dc\u05d9'}</p>
        <div className="card">
          <form onSubmit={handleAuth}>
            <div className="form-group"><label>{'\u05d0\u05d9\u05de\u05d9\u05d9\u05dc'}</label><input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" required /></div>
            <div className="form-group"><label>{'\u05e1\u05d9\u05e1\u05dd\u05d4'}</label><input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} dir="ltr" required /></div>
            {authError && <p style={{color: 'var(--danger)', fontSize: '0.85em', marginBottom: 10}}>{authError}</p>}
            <button className="btn btn-primary btn-lg" style={{width: '100%'}} type="submit">{isSignUp ? '\u05d4\u05e8\u05e9\u05de\u05d4' : '\u05db\u05e0\u05d9\u05e1\u05d4'}</button>
          </form>
          <p style={{textAlign: 'center', marginTop: 15, fontSize: '0.85em', color: 'var(--text-secondary)'}}><span style={{cursor: 'pointer', color: 'var(--accent)'}} onClick={() => setIsSignUp(!isSignUp)}>{isSignUp ? '\u05d9\u05e9 \u05dc\u05d9 \u05d7\u05e9\u05d1\u05d5\u05df \u2014 \u05db\u05e0\u05d9\u05e1\u05d4' : '\u05de\u05e9\u05ea\u05de\u05e9 \u05d7\u05d3\u05e9 \u2014 \u05d4\u05e8\u05e9\u05de\u05d4'}</span></p>
        </div>
      </div>
    );
  }

  const getClientProjects = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client?.projects || [];
  };

  return (
    <>
      <div className="header"><div className="header-content"><div className="logo">VITAS REPORTS</div><div className="header-nav"><button className={`nav-btn ${view === 'upload' ? 'active' : ''}`} onClick={() => setView('upload')}>{'\ud83d\udce4 \u05d4\u05e2\u05dc\u05d0\u05ea \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd'}</button><button className={`nav-btn ${view === 'history' ? 'active' : ''}`} onClick={() => setView('history')}>{'\ud83d\udccb \u05d4\u05d9\u05e1\u05d8\u05d5\u05e8\u05d9\u05d4'}</button><button className="nav-btn danger" onClick={handleLogout}>{'\u05d9\u05e6\u05d9\u05d0\u05d4'}</button></div></div></div>

      <div className="app-layout">
        <div className="sidebar"><div style={{padding: '0 15px', marginBottom: 20}}>
          <div className="sidebar-title">{'\u05dc\u05e7\u05d5\u05d7\u05d5\u05ea'}</div>
          {clients.map(client => (<div key={client.id}>
            <div className={`client-item ${selectedClient?.id === client.id ? 'active' : ''}`} onClick={() => { setSelectedClient(client); setSelectedProject(null); setView('welcome'); }}><div className="client-dot" style={{background: client.color}}></div>{client.name}</div>
            {selectedClient?.id === client.id && client.projects?.map(proj => (<div key={proj.id} className={`project-item ${selectedProject?.id === proj.id ? 'active' : ''}`} onClick={() => selectProject(client, proj)}>{'\ud83d\udcc2'} {proj.name}</div>))}
            {selectedClient?.id === client.id && (<><div className="add-btn indent" onClick={() => setShowAddProject(true)}>+ {'\u05d4\u05d5\u05e1\u05e3 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8'}</div><div style={{padding: '5px 25px'}}><div className="link-box" style={{marginTop: 5}}><small>{'\u05dc\u05d9\u05e0\u05e7 \u05dc\u05dc\u05e7\u05d5\u05d7'}:</small><input readOnly value={typeof window !== 'undefined' ? `${window.location.origin}/client/${client.token}` : ''} onClick={e => {e.target.select(); navigator.clipboard?.writeText(e.target.value); showToast('\u05d4\u05dc\u05d9\u05e0\u05e7 \u05d4\u05d5\u05e2\u05ea\u05e7!');}} /></div></div></>)}
          </div>))}
          <div className="add-btn" onClick={() => setShowAddClient(true)}>+ {'\u05d4\u05d5\u05e1\u05e3 \u05dc\u05e7\u05d5\u05d7'}</div>
        </div></div>

        <div className="main-content">
          {view === 'welcome' && (<div className="welcome-center"><div className="icon">{'\ud83d\udcca'}</div><h2>{'\u05d1\u05e8\u05d5\u05db\u05d9\u05dd \u05d4\u05d1\u05d0\u05d9\u05dd'}</h2><p>{'\u05d1\u05d7\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05de\u05d4\u05ea\u05e4\u05e8\u05d9\u05d8 \u05db\u05d3\u05d9 \u05dc\u05e6\u05e4\u05d5\u05ea \u05d1\u05d3\u05d5\u05d7, \u05d0\u05d5 \u05d4\u05e2\u05dc\u05d4 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05d7\u05d3\u05e9\u05d9\u05dd'}</p></div>)}

          {view === 'upload' && (<>
            <h2 style={{fontSize: '1.8em', fontWeight: 800, marginBottom: 20}}>{'\ud83d\udce4 \u05d4\u05e2\u05dc\u05d0\u05ea \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd'}</h2>
            <div className="card"><div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}><h3 style={{fontWeight: 700, margin: 0}}>{'\u05d4\u05d2\u05d3\u05e8\u05d5\u05ea'}</h3><button className="btn" style={{background: '#e74c3c', color: '#fff', padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13}} onClick={handleResetData}>{'\ud83d\uddd1\ufe0f \u05d0\u05d9\u05e4\u05d5\u05e1 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd'}</button></div>
              <div className="form-row"><div className="form-group"><label>{'\u05dc\u05e7\u05d5\u05d7'}</label><select className="form-input" value={uploadClient} onChange={e => setUploadClient(e.target.value)}><option value="">{'\u05d1\u05d7\u05e8 \u05dc\u05e7\u05d5\u05d7'}</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="form-group"><label>{'\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8'}</label><select className="form-input" value={uploadProject} onChange={e => setUploadProject(e.target.value)}><option value="">{'\u05d1\u05d7\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8'}</option>{getClientProjects(uploadClient).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div></div>
              <div className="form-row"><div className="form-group"><label>{'\u05de\u05e7\u05d5\u05e8'}</label><select className="form-input" value={uploadSource} onChange={e => setUploadSource(e.target.value)}><option value="facebook">Facebook Ads</option><option value="google_pmax">Google Ads PMax</option><option value="google_search">Google Ads Search</option><option value="crm">CRM {'\u05de\u05e7\u05d5\u05e8\u05d5\u05ea \u05d4\u05d2\u05e2\u05d4'}</option><option value="crm_reports">CRM {'\u05de\u05d7\u05d5\u05dc\u05dc \u05d3\u05d5\u05d7\u05d5\u05ea'}</option></select></div><div className="form-group"><label>{'\u05d7\u05d5\u05d3\u05e9'}</label><input className="form-input" type="month" value={uploadMonth} onChange={e => setUploadMonth(e.target.value)} /></div></div>
            </div>
            <div className="upload-area" onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }} onDragLeave={e => e.currentTarget.classList.remove('dragover')} onDrop={handleDrop} onClick={() => document.getElementById('fileInput').click()}>
              {uploading ? (<><div className="spinner" style={{borderColor: 'rgba(59,130,246,0.3)', borderTopColor: 'var(--accent)', width: 40, height: 40}}></div><h3 style={{marginTop: 15}}>{'\u05de\u05e2\u05d1\u05d3...'}</h3></>) : (<><div className="upload-icon">{'\ud83d\udcc1'}</div><h3>{'\u05d2\u05e8\u05d5\u05e8 \u05e7\u05d5\u05d1\u05e5 \u05d0\u05e7\u05e1\u05dc \u05dc\u05db\u05d0\u05df'}</h3><p style={{color: 'var(--text-secondary)'}}>{'\u05d0\u05d5 \u05dc\u05d7\u05e5 \u05dc\u05d1\u05d7\u05d9\u05e8\u05ea \u05e7\u05d5\u05d1\u05e5'}</p></>)}
              <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style={{display: 'none'}} onChange={e => { if (e.target.files.length) handleFile(e.target.files[0]); }} />
            </div>
            {uploadResult?.success && (<div className="card" style={{borderColor: 'var(--success)', borderWidth: 2}}>
              <h3 style={{color: 'var(--success)'}}>{'\u2705 \u05d4\u05d5\u05e2\u05dc\u05d4 \u05d1\u05d4\u05e6\u05dc\u05d7\u05d4!'}</h3>
              <p style={{color: 'var(--text-secondary)', marginBottom: 15}}>{uploadResult.fileName} â {uploadResult.rowCount} {'\u05e9\u05d5\u05e8\u05d5\u05ea'}</p>
              {uploadResult.totals ? (
                <div className="kpi-grid">
                  <div className="kpi-card"><div className="kpi-label">{'\u05ea\u05e7\u05e6\u05d9\u05d1'}</div><div className="kpi-value">{formatCurrency(uploadResult.totals.spend)}</div></div>
                  <div className="kpi-card green"><div className="kpi-label">{'\u05dc\u05d9\u05d3\u05d9\u05dd'}</div><div className="kpi-value">{uploadResult.totals.leads}</div></div>
                  <div className="kpi-card purple"><div className="kpi-label">CPL</div><div className="kpi-value">{formatCurrency(uploadResult.totals.cpl)}</div></div>
                </div>
              ) : uploadResult.crmTotals ? (
                <div className="kpi-grid">
                  <div className="kpi-card"><div className="kpi-label">{'\u05e1\u05d4"\u05db \u05dc\u05d9\u05d3\u05d9\u05dd'}</div><div className="kpi-value">{formatNum(uploadResult.crmTotals.totalLeads)}</div></div>
                  <div className="kpi-card green"><div className="kpi-label">{'\u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd'}</div><div className="kpi-value">{formatNum(uploadResult.crmTotals.relevantLeads)}</div></div>
                  <div className="kpi-card purple"><div className="kpi-label">{'\u05d7\u05d5\u05d6\u05d9\u05dd'}</div><div className="kpi-value">{formatNum(uploadResult.crmTotals.contracts)}</div></div>
                  <div className="kpi-card orange"><div className="kpi-label">{'\u05e9\u05d5\u05d5\u05d9 \u05d7\u05d5\u05d6\u05d9\u05dd'}</div><div className="kpi-value">{formatCurrency(uploadResult.crmTotals.contractValue)}</div></div>
                </div>
              ) : uploadResult.crmReportTotals ? (
                <div className="kpi-grid">
                  <div className="kpi-card"><div className="kpi-label">{'\u05e1\u05d4"\u05db \u05e9\u05d5\u05e8\u05d5\u05ea'}</div><div className="kpi-value">{formatNum(uploadResult.crmReportTotals.totalRows)}</div></div>
                  <div className="kpi-card green"><div className="kpi-label">{'\u05e2\u05e8\u05d9\u05dd \u05d9\u05d9\u05d7\u05d5\u05d3\u05d9\u05d5\u05ea'}</div><div className="kpi-value">{formatNum(uploadResult.crmReportTotals.uniqueCities)}</div></div>
                  <div className="kpi-card purple"><div className="kpi-label">{'\u05e2\u05dd \u05d4\u05ea\u05e0\u05d2\u05d3\u05d5\u05d9\u05d5\u05ea'}</div><div className="kpi-value">{formatNum(uploadResult.crmReportTotals.withObjections)}</div></div>
                  <div className="kpi-card orange"><div className="kpi-label">{'\u05e2\u05dd \u05e4\u05d2\u05d9\u05e9\u05d4'}</div><div className="kpi-value">{formatNum(uploadResult.crmReportTotals.withMeeting)}</div></div>
                </div>
              ) : null}
            </div>)}
          </>)}

          {view === 'dashboard' && selectedProject && (<>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25}}>
              <h2 style={{fontSize: '1.8em', fontWeight: 800}}>{selectedClient?.name} / {selectedProject.name}</h2>
              <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                <select className="form-input" style={{width: 'auto'}} value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>{[...new Set(reports.map(r => r.month))].sort().reverse().map(m => (<option key={m} value={m}>{formatMonth(m)}</option>))}</select>
                <label style={{fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer'}}><input type="checkbox" checked={compareEnabled} onChange={e => setCompareEnabled(e.target.checked)} />{'\u05d4\u05e9\u05d5\u05d5\u05d0\u05d4 \u05dc\u05d7\u05d5\u05d3\u05e9 \u05e7\u05d5\u05d3\u05dd'}</label>
              </div>
            </div>
            {reports.length === 0 ? (<div className="welcome-center"><div className="icon">{'\ud83d\udced'}</div><h3>{'\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05e2\u05d3\u05d9\u05d9\u05df'}</h3><button className="btn btn-primary btn-lg" onClick={() => setView('upload')} style={{marginTop: 15}}>{'\ud83d\udce4 \u05d4\u05e2\u05dc\u05d0\u05ea \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd'}</button></div>) : renderDashboard()}
          </>)}

          {view === 'history' && (<><h2 style={{fontSize: '1.8em', fontWeight: 800, marginBottom: 20}}>{'\ud83d\udccb \u05d4\u05d9\u05e1\u05d8\u05d5\u05e8\u05d9\u05d4'}</h2><HistoryView clients={clients} showToast={showToast} onRefresh={loadClients} /></>)}
        </div>
      </div>

      <div className={`modal-overlay ${showAddClient ? 'active' : ''}`} onClick={e => { if (e.target === e.currentTarget) setShowAddClient(false); }}><div className="modal"><h3>{'\u05d4\u05d5\u05e1\u05e3 \u05dc\u05e7\u05d5\u05d7 \u05d7\u05d3\u05e9'}</h3><div className="form-group"><label>{'\u05e9\u05dd \u05dc\u05e7\u05d5\u05d7'}</label><input className="form-input" value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder={'\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: \u05e9.\u05d1\u05e8\u05d5\u05dc'} /></div><div className="form-group"><label>{'\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8\u05d9\u05dd (\u05de\u05d5\u05e4\u05e8\u05d3\u05d9\u05dd \u05d1\u05e4\u05e1\u05d9\u05e7\u05d9\u05dd)'}</label><input className="form-input" value={newClientProjects} onChange={e => setNewClientProjects(e.target.value)} placeholder={'\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: HI PARK, ONCE'} /></div><div className="form-group"><label>{'\u05e6\u05d1\u05e2'}</label><select className="form-input" value={newClientColor} onChange={e => setNewClientColor(e.target.value)}><option value="#3b82f6">{'\u05db\u05d7\u05d5\u05dc'}</option><option value="#10b981">{'\u05d9\u05e8\u05d5\u05e7'}</option><option value="#8b5cf6">{'\u05e1\u05d2\u05d5\u05dc'}</option><option value="#f59e0b">{'\u05db\u05ea\u05d5\u05dd'}</option><option value="#ec4899">{'\u05d5\u05e8\u05d5\u05d3'}</option></select></div><div className="modal-actions"><button className="btn btn-primary" onClick={addClient}>{'\u05d4\u05d5\u05e1\u05e3'}</button><button className="btn btn-outline" onClick={() => setShowAddClient(false)}>{'\u05d1\u05d9\u05d8\u05d5\u05dc'}</button></div></div></div>

      <div className={`modal-overlay ${showAddProject ? 'active' : ''}`} onClick={e => { if (e.target === e.currentTarget) setShowAddProject(false); }}><div className="modal"><h3>{'\u05d4\u05d5\u05e1\u05e3 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05dc-'}{selectedClient?.name}</h3><div className="form-group"><label>{'\u05e9\u05dd \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8'}</label><input className="form-input" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder={'\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: HI PARK'} /></div><div className="modal-actions"><button className="btn btn-primary" onClick={addProject}>{'\u05d4\u05d5\u05e1\u05e3'}</button><button className="btn btn-outline" onClick={() => setShowAddProject(false)}>{'\u05d1\u05d9\u05d8\u05d5\u05dc'}</button></div></div></div>

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
    if (!confirm('\u05dc\u05de\u05d7\u05d5\u05e7 \u05d0\u05ea \u05d4\u05d4\u05e2\u05dc\u05d0\u05d4?')) return;
    await supabase.from('reports').delete().eq('id', id);
    setReports(prev => prev.filter(r => r.id !== id));
  };

  const getSourceLabel = (source) => {
    if (source === 'facebook') return 'Facebook';
    if (source === 'google_pmax') return 'Google PMax';
    if (source === 'google_search') return 'Google Search';
    if (source === 'google') return 'Google';
    if (source === 'crm') return 'CRM \u05de\u05e7\u05d5\u05e8\u05d5\u05ea \u05d4\u05d2\u05e2\u05d4';
    if (source === 'crm_reports') return 'CRM \u05de\u05d7\u05d5\u05dc\u05dc \u05d3\u05d5\u05d7\u05d5\u05ea';
    return source;
  };

  if (reports.length === 0) return <div className="welcome-center"><div className="icon">{'\ud83d\udced'}</div><h3>{'\u05d0\u05d9\u05df \u05d4\u05e2\u05dc\u05d0\u05d5\u05ea \u05e2\u05d3\u05d9\u05d9\u05df'}</h3></div>;
  return reports.map(r => (
    <div className="card" key={r.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <div>
        <h4 style={{fontWeight: 700}}>{r.projects?.clients?.name} / {r.projects?.name} â {formatMonth(r.month)}</h4>
        <p style={{color: 'var(--text-secondary)', fontSize: '0.9em'}}>{getSourceLabel(r.source)} | {r.file_name} | {r.row_count} rows</p>
      </div>
      <button className="btn btn-danger" style={{fontSize: '0.8em', padding: '6px 12px'}} onClick={() => deleteReport(r.id)}>{'\ud83d\uddd1'}</button>
    </div>
  ));
}
