'use client'
// rebuild trigger
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatNum, formatMonth, mapFacebookRows, mapGoogleRows, mapCrmRows, mapCrmReportRows, aggregateRows, aggregateCrmRows, aggregateCrmReportRows, changePercent, getPrevMonth, COLORS } from '../../lib/helpers'
import Chart from 'chart.js/auto'
import * as XLSX from 'xlsx'

export default function AdminPage() {
  const [session, setSession] = useState(null)
  const [lastMetaSync, setLastMetaSync] = useState(null)
  const [lastGoogleSync, setLastGoogleSync] = useState(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [selectedProject, setSelectedProject] = useState(null)
  const [view, setView] = useState('welcome')
  const [reports, setReports] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [customSince, setCustomSince] = useState('')
  const [customUntil, setCustomUntil] = useState('')
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [activePreset, setActivePreset] = useState('lastMonth')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshingCrm, setRefreshingCrm] = useState(false)
  const [refreshStartTime, setRefreshStartTime] = useState(null)
  const [refreshElapsed, setRefreshElapsed] = useState(0)
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
  const [sortConfig, setSortConfig] = useState({});
  const [expandedCampaigns, setExpandedCampaigns] = useState(new Set());
  const [expandedAdSets, setExpandedAdSets] = useState(new Set());
  const handleSort = (tableId, key) => { setSortConfig(prev => { const cur = prev[tableId]; if (cur && cur.key === key) return {...prev, [tableId]: {key, dir: cur.dir === 'desc' ? 'asc' : 'desc'}}; return {...prev, [tableId]: {key, dir: 'desc'}}; }); };
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

  // Compute since/until (or full month) from a preset key
  const presetToPayload = (preset) => {
    const today = new Date();
    const toYMD = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    if (preset === 'today') { const t = toYMD(today); return { payload: { since: t, until: t }, key: t + '_' + t }; }
    if (preset === 'yesterday') { const d = new Date(today); d.setDate(d.getDate()-1); const s = toYMD(d); return { payload: { since: s, until: s }, key: s + '_' + s }; }
    if (preset === 'last7') { const end = new Date(today); end.setDate(end.getDate()-1); const start = new Date(today); start.setDate(start.getDate()-7); const s = toYMD(start), e = toYMD(end); return { payload: { since: s, until: e }, key: s + '_' + e }; }
    if (preset === 'last30') { const end = new Date(today); end.setDate(end.getDate()-1); const start = new Date(today); start.setDate(start.getDate()-30); const s = toYMD(start), e = toYMD(end); return { payload: { since: s, until: e }, key: s + '_' + e }; }
    if (preset === 'currentMonth') { const start = new Date(today.getFullYear(), today.getMonth(), 1); const s = toYMD(start), e = toYMD(today); return { payload: { since: s, until: e }, key: s + '_' + e }; }
    if (preset === 'lastMonth') { const y = today.getMonth()===0 ? today.getFullYear()-1 : today.getFullYear(); const m = today.getMonth()===0 ? 12 : today.getMonth(); const mm = String(m).padStart(2,'0'); return { payload: { month: `${y}-${mm}` }, key: `${y}-${mm}` }; }
    return null;
  };

  const triggerFetch = async (payload) => {
    if (refreshing) return false;
    setRefreshing(true);
    setRefreshStartTime(Date.now());
    setRefreshElapsed(0);
    const headers = { 'Content-Type': 'application/json', 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' };
    let metaOk = false, googleOk = false;
    try {
      const [mr, gr] = await Promise.allSettled([
        fetch('/api/meta/fetch', { method: 'POST', headers, body: JSON.stringify(payload) }).then(r => r.json()),
        fetch('/api/google/fetch', { method: 'POST', headers, body: JSON.stringify(payload) }).then(r => r.json()),
      ]);
      metaOk = mr.status === 'fulfilled' && mr.value && mr.value.ok;
      googleOk = gr.status === 'fulfilled' && gr.value && gr.value.ok;
      if (metaOk) setLastMetaSync(new Date());
      if (googleOk) setLastGoogleSync(new Date());
      const parts = [];
      if (metaOk) parts.push('\u2713 Facebook'); else parts.push('\u00d7 Facebook');
      if (googleOk) parts.push('\u2713 Google'); else parts.push('\u00d7 Google');
      showToast(parts.join('  |  '));
      await loadClients();
      if (selectedProject) await loadProjectReports(selectedProject.id);
    } catch (err) {
      showToast('\u05e9\u05d2\u05d9\u05d0\u05d4: ' + (err.message || err));
    } finally {
      setRefreshing(false);
      setRefreshStartTime(null);
    }
    return metaOk || googleOk;
  };

  const applyPreset = async (preset) => {
    // Existing-period option ("period:2026-03")
    if (preset.startsWith('period:')) {
      const m = preset.slice('period:'.length);
      setSelectedMonth(m);
      setActivePreset('custom'); // mark as already-loaded custom
      return;
    }
    setActivePreset(preset);
    if (preset === 'custom') return; // UI shows custom date inputs — user must click הצג
    const r = presetToPayload(preset);
    if (!r) return;
    // Set the target selection BEFORE triggering fetch so loadProjectReports keeps it
    setSelectedMonth(r.key);
    const ok = await triggerFetch(r.payload);
    // Reaffirm in case loadProjectReports raced and reset it
    if (ok) setSelectedMonth(r.key);
  };

  const applyCustomRange = async () => {
    if (!customSince || !customUntil) return;
    const payload = { since: customSince, until: customUntil };
    const targetKey = customSince + '_' + customUntil;
    setSelectedMonth(targetKey);
    const ok = await triggerFetch(payload);
    if (ok) setSelectedMonth(targetKey);
  };

  const refreshFromBmby = async () => {
    if (refreshingCrm) return;
    setRefreshingCrm(true);
    showToast('\u05de\u05d5\u05e9\u05da \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05de-BMBY...');
    try {
      const payload = selectedMonth && !selectedMonth.includes('_')
        ? { month: selectedMonth }
        : selectedMonth
          ? { since: selectedMonth.split('_')[0], until: selectedMonth.split('_')[1] }
          : {};
      const res = await fetch('/api/bmby/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.pending) {
        showToast('\u26a0\ufe0f BMBY: ' + (json.message || 'credentials not configured'));
      } else if (!res.ok) {
        showToast('\u05e9\u05d2\u05d9\u05d0\u05d4: ' + (json.error || 'unknown'));
      } else {
        const okProjects = (json.projects || []).filter(p => !p.skipped).length;
        showToast(`\u2713 BMBY: \u05e2\u05d5\u05d3\u05db\u05e0\u05d5 ${okProjects} \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8\u05d9\u05dd`);
      }
      await loadClients();
      if (selectedProject) await loadProjectReports(selectedProject.id);
    } catch (err) {
      showToast('\u05e9\u05d2\u05d9\u05d0\u05d4: ' + (err.message || err));
    }
    setRefreshingCrm(false);
  };

    const refreshAll = async () => {
    // Re-fetch the current period
    if (!selectedMonth) {
      const r = presetToPayload('lastMonth');
      if (r) await triggerFetch(r.payload);
      return;
    }
    const payload = selectedMonth.includes('_')
      ? { since: selectedMonth.split('_')[0], until: selectedMonth.split('_')[1] }
      : { month: selectedMonth };
    await triggerFetch(payload);
  };

  const onComparisonToggle = async (enabled) => {
    setCompareEnabled(enabled);
    if (!enabled || !selectedMonth) return;
    const prev = getPrevMonth(selectedMonth);
    if (!prev) return;
    // If prev-period isn't loaded yet, fetch it
    if (!reports.some(r => r.month === prev)) {
      const payload = prev.includes('_')
        ? { since: prev.split('_')[0], until: prev.split('_')[1] }
        : { month: prev };
      await triggerFetch(payload);
    }
  };

const loadClients = async () => {
    const { data } = await supabase.from('clients').select('*, projects(*)').order('created_at');
    if (data) setClients(data);
  };

  const loadProjectReports = async (projectId) => {
    const { data } = await supabase.from('reports').select('*').eq('project_id', projectId).order('month', { ascending: false });
    if (data) {
      setReports(data);
      // Preserve current selectedMonth if it still exists in the new data;
      // otherwise (first load or it was deleted) fall back to the most recent.
      if (data.length > 0) {
        setSelectedMonth(prev => {
          if (prev && data.some(r => r.month === prev)) return prev;
          return data[0].month;
        });
      }
    }
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

const selectProject = async (client, project) => {
    setSelectedClient(client); setSelectedProject(project); setView('dashboard'); setCompareEnabled(false);
    await loadProjectReports(project.id);
  };

  // Tick elapsed time every 500ms while refresh is active (for the banner timer)
  useEffect(() => {
    if (!refreshStartTime) return;
    const interval = setInterval(() => {
      setRefreshElapsed(Math.floor((Date.now() - refreshStartTime) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [refreshStartTime]);

  const destroyCharts = () => { chartsRef.current.forEach(c => c.destroy()); chartsRef.current = []; };


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
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const config = { type, data: { labels, datasets }, plugins: [arcLabelsPlugin], options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Heebo' } } } } } };
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

    // Merge Facebook campaign sources into single 'Facebook' entry
    const _fbCrmKeys = Object.keys(crmData.sources).filter(k => k.includes('פייסבוק') || k.toLowerCase().includes('facebook'));
    if (_fbCrmKeys.length > 0) {
      const _fbMerged = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0 };
      _fbCrmKeys.forEach(k => { Object.keys(_fbMerged).forEach(f => { _fbMerged[f] += crmData.sources[k][f] || 0; }); delete crmData.sources[k]; });
      crmData.sources['Facebook'] = _fbMerged;
    }
    // Merge Google campaign sources into single 'Google' entry
    const _gCrmKeys = Object.keys(crmData.sources).filter(k => k.includes('גוגל') || k.toLowerCase().includes('google'));
    if (_gCrmKeys.length > 0) {
      const _gMerged = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0 };
      _gCrmKeys.forEach(k => { Object.keys(_gMerged).forEach(f => { _gMerged[f] += crmData.sources[k][f] || 0; }); delete crmData.sources[k]; });
      crmData.sources['Google'] = _gMerged;
    }

    // Add platform leads to CRM totals (only if CRM doesn't already have that source)
    let _platformSpend = 0;
    const _fbR = reports.filter(r => r.month === selectedMonth && r.source === 'facebook');
    const _gR = reports.filter(r => r.month === selectedMonth && r.source && r.source.startsWith('google'));
    const _emptySource = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0 };
    if (_fbR.length > 0) {
      let _fbRows = []; _fbR.forEach(r => { if (r.data) _fbRows = _fbRows.concat(r.data); });
      const _fbAgg = aggregateRows(_fbRows);
      _platformSpend += _fbAgg.totals.spend || 0;
      const _fbLeads = _fbAgg.totals.leads || 0;
      if (!crmData.sources['Facebook']) {
        crmData.totals.totalLeads += _fbLeads;
        crmData.sources['Facebook'] = { ..._emptySource, totalLeads: _fbLeads };
      } else {
        crmData.totals.totalLeads -= (crmData.sources['Facebook'].totalLeads || 0);
        crmData.totals.totalLeads += _fbLeads;
      }
    }
    if (_gR.length > 0) {
      let _gRows = []; _gR.forEach(r => { if (r.data) _gRows = _gRows.concat(r.data); });
      const _gAgg = aggregateRows(_gRows);
      _platformSpend += _gAgg.totals.spend || 0;
      const _gLeads = _gAgg.totals.leads || 0;
      if (!crmData.sources['Google']) {
        crmData.totals.totalLeads += _gLeads;
        crmData.sources['Google'] = { ..._emptySource, totalLeads: _gLeads };
      } else {
        crmData.totals.totalLeads -= (crmData.sources['Google'].totalLeads || 0);
        crmData.totals.totalLeads += _gLeads;
      }
    }

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
      const icons = { 'סה"כ לידים': 'בש', 'רלוונטיים': '✅', 'לא רלוונטיים': '❌', 'פגישות שתואמו': 'פג', 'פגישות שבוצעו': 'שט', 'פגישות שבוטלו': 'בט', 'הרשמות': 'הר', 'שווי הרשמות': '₪', 'חוזים': 'חז', 'שווי חוזים': '₪', 'אחוז המרה לפגישה שתואמה': '%', 'אחוז המרה לפגישות שבוצעו': '%', '% רלוונטיות': '%', 'עלות פגישה שבוצעה': '₪' };
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
          {crmKpi('פגישות שתואמו', formatNum(ct.meetingsScheduled), 'purple', ct.meetingsScheduled, cp?.meetingsScheduled)}
          {crmKpi('פגישות שבוצעו', formatNum(ct.meetingsCompleted), 'orange', ct.meetingsCompleted, cp?.meetingsCompleted)}
          {crmKpi('אחוז המרה לפגישה שתואמה', ct.scheduledRate.toFixed(1) + '%', 'pink', ct.scheduledRate, cp?.scheduledRate)}
          {crmKpi('אחוז המרה לפגישות שבוצעו', ct.completedRate.toFixed(1) + '%', '', ct.completedRate, cp?.completedRate)}
          {crmKpi('עלות פגישה שבוצעה', ct.meetingsCompleted > 0 ? formatCurrency(_platformSpend / ct.meetingsCompleted) : '₪0', 'purple', 0, 0)}
          {crmKpi('פגישות שבוטלו', formatNum(ct.meetingsCancelled), 'red', ct.meetingsCancelled, cp?.meetingsCancelled, true)}
          {crmKpi('\u05d4\u05e8\u05e9\u05dd\u05d5\u05ea', formatNum(ct.registrations), 'green', ct.registrations, cp?.registrations)}
          {crmKpi('\u05e9\u05d5\u05d5\u05d9 \u05d4\u05e8\u05e9\u05dd\u05d5\u05ea', formatCurrency(ct.registrationValue), 'purple', ct.registrationValue, cp?.registrationValue)}
          {crmKpi('\u05d7\u05d5\u05d6\u05d9\u05dd', formatNum(ct.contracts), 'cyan', ct.contracts, cp?.contracts)}
          {crmKpi('\u05e9\u05d5\u05d5\u05d9 \u05d7\u05d5\u05d6\u05d9\u05dd', formatCurrency(ct.contractValue), 'orange', ct.contractValue, cp?.contractValue)}
          
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
          <div className="chart-grid" style={{gridTemplateColumns: '1fr'}}>
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
    // If there are NO reports at all for this project, show the welcome screen.
    // If there are reports but not for this period, fall through — tabs will still show
    // (based on `reports`, not `currentReports`) and per-tab content will handle empty.
    if (reports.length === 0) return <div className="welcome-center"><div className="icon">{'\ud83d\udced'}</div><h3>No data for this month</h3></div>;

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
      : [];
    const isPmax = dashTab === 'google_pmax' || dashTab === 'google';
    const isFb = dashTab === 'facebook';

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

    // Extract CRM totals for "all" tab KPI display
    let crmTotals = null;
    if (dashTab === 'all') {
      const crmReps = currentReports.filter(r => r.source === 'crm');
      if (crmReps.length > 0) {
        let allCrmR = [];
        crmReps.forEach(r => { if (r.data) allCrmR = allCrmR.concat(r.data); });
        crmTotals = aggregateCrmRows(allCrmR).totals;
      }
    }

    let prevData = null;
    if (compareEnabled) {
      const prevMonth = getPrevMonth(selectedMonth);
      const prevReports = reports.filter(r => r.month === prevMonth);
      const displayPrev = dashTab === 'all'
        ? prevReports.filter(r => r.source !== 'crm')
        : dashTab === 'facebook'
        ? prevReports.filter(r => r.source === 'facebook')
        : dashTab === 'google_pmax'
        ? prevReports.filter(r => r.source === 'google_pmax')
        : dashTab === 'google_search'
        ? prevReports.filter(r => r.source === 'google_search')
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

    const buildTable = (items, prevItems, labelName, tableId) => {
      if (!items || Object.keys(items).length === 0) return null;
      const cols = [{key:'name',label:labelName,get:(_,n)=>n},{key:'clicks',label:'קליקים',get:d=>d.clicks,higher:true},{key:'impressions',label:'חשיפות',get:d=>d.impressions,higher:true},{key:'cpc',label:'עלות לקליק',get:d=>d.clicks>0?d.spend/d.clicks:0,higher:false},{key:'ctr',label:'CTR',get:d=>d.impressions>0?(d.clicks/d.impressions*100):0,higher:true},{key:'cpm',label:'CPM',get:d=>d.impressions>0?(d.spend/d.impressions*1000):0,higher:false},{key:'leads',label:'לידים',get:d=>d.leads,higher:true},{key:'cpl',label:'עלות לליד',get:d=>d.leads>0?d.spend/d.leads:0,higher:false},{key:'spend',label:'תקציב שנוצל',get:d=>d.spend}];
      const sc = sortConfig[tableId];
      let entries = Object.entries(items);
      if (sc) { const col = cols.find(c=>c.key===sc.key); if(col){entries.sort((a,b)=>{const va=col.get(a[1],a[0]),vb=col.get(b[1],b[0]);if(typeof va==='string')return sc.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);return sc.dir==='asc'?va-vb:vb-va;});}} else { entries.sort((a, b) => b[1].spend - a[1].spend); }
      const showCh = compareEnabled && prevItems;
      const ch = (cur, prev, isCost) => {
        if (!showCh || prev == null) return null;
        const pct = changePercent(cur, prev, isCost);
        if (!pct) return null;
        const isPos = isCost ? pct.pct < 0 : pct.pct > 0;
        return <span className={`change-badge ${isPos ? 'positive' : 'negative'}`}>{pct.pct > 0 ? '▲' : '▼'} {Math.abs(pct.pct).toFixed(1)}%</span>;
      };
      const sortIcon = (key) => { if(!sc||sc.key!==key) return ' ⇅'; return sc.dir==='desc'?' ▼':' ▲'; };
      const thStyle = {cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'};
      const extremes = {};
      cols.forEach(c => { if (c.key === 'name' || c.key === 'spend') return; const vals = entries.map(([n,d]) => c.get(d,n)).filter(v => typeof v === 'number' && v > 0); if (vals.length < 2) return; extremes[c.key] = {min: Math.min(...vals), max: Math.max(...vals)}; });
      const cellBg = (key, val) => { const e = extremes[key]; if (!e || val <= 0 || e.min === e.max) return {}; const col = cols.find(c=>c.key===key); if (!col || col.higher === undefined) return {}; if (val === e.max) return col.higher ? {color:'#059669',fontWeight:700} : {color:'#dc2626',fontWeight:700}; if (val === e.min) return col.higher ? {color:'#dc2626',fontWeight:700} : {color:'#059669',fontWeight:700}; return {}; };
      return (<div className="table-wrapper"><table className="data-table"><thead><tr>{cols.map(c=>(<th key={c.key} style={thStyle} onClick={()=>handleSort(tableId,c.key)}>{c.label}{sortIcon(c.key)}</th>))}</tr></thead><tbody>{entries.map(([name, d]) => { const cpl = d.leads > 0 ? d.spend / d.leads : 0; const cpc = d.clicks > 0 ? d.spend / d.clicks : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; const cplClass = cpl > 0 && cpl < 80 ? 'tag-green' : cpl < 120 ? 'tag-blue' : cpl < 150 ? 'tag-purple' : 'tag-red'; return (<tr key={name}><td style={{fontWeight: 600}}>{name}</td><td style={cellBg('clicks',d.clicks)}>{formatNum(d.clicks)} {ch(d.clicks, prevItems?.[name]?.clicks, false)}</td><td style={cellBg('impressions',d.impressions)}>{formatNum(d.impressions)} {ch(d.impressions, prevItems?.[name]?.impressions, false)}</td><td style={cellBg('cpc',cpc)}>{formatCurrency(cpc)} {ch(cpc, prevItems?.[name]?.clicks > 0 ? prevItems[name].spend/prevItems[name].clicks : null, true)}</td><td style={cellBg('ctr',ctr)}>{ctr.toFixed(2)}%</td><td style={cellBg('cpm',cpm)}>{formatCurrency(cpm)}</td><td style={cellBg('leads',d.leads)}>{d.leads} {ch(d.leads, prevItems?.[name]?.leads, false)}</td><td style={cellBg('cpl',cpl)}><span className={`cpl-tag ${cplClass}`}>{formatCurrency(cpl)}</span></td><td>{formatCurrency(d.spend)} {ch(d.spend, prevItems?.[name]?.spend, true)}</td></tr>); })}</tbody></table></div>);
    };


    setTimeout(() => {
      destroyCharts();
      // monthly trend charts removed
      const campNames2 = Object.keys(data.campaigns);
      if (campNames2.length > 0) {
        createChart('campSpend', 'doughnut', campNames2, [{ data: campNames2.map(n => data.campaigns[n].spend), backgroundColor: COLORS.slice(0, campNames2.length) }]);
        createChart('campLeads', 'bar', campNames2, [{ label: 'Leads', data: campNames2.map(n => data.campaigns[n].leads), backgroundColor: 'rgba(16,185,129,0.7)', yAxisID: 'y' }, { label: 'CPL', data: campNames2.map(n => data.campaigns[n].leads > 0 ? data.campaigns[n].spend / data.campaigns[n].leads : 0), borderColor: '#ef4444', type: 'line', yAxisID: 'y1', tension: 0.3 }], { y: { position: 'right' }, y1: { position: 'left', grid: { drawOnChartArea: false } } });
      }
      // gender doughnut charts removed (replaced by table)
      const an = Object.keys(data.ages).filter(a => a !== 'unknown').sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999));
      if (an.length > 0 && dashTab !== 'all' && dashTab !== 'facebook') {
        createChart('ageSpendLeads', 'bar', an, [{ label: '\u05d4\u05d5\u05e6\u05d0\u05d4', data: an.map(a => data.ages[a].spend), backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#3b82f6', borderWidth: 2, yAxisID: 'y' }, { label: '\u05dc\u05d9\u05d3\u05d9\u05dd', data: an.map(a => data.ages[a].leads), backgroundColor: 'rgba(16,185,129,0.15)', borderColor: '#10b981', borderWidth: 2, yAxisID: 'y1' }], { y: { position: 'right', title: { display: true, text: '\u05d4\u05d5\u05e6\u05d0\u05d4 (\u20aa)' } }, y1: { position: 'left', title: { display: true, text: '\u05dc\u05d9\u05d3\u05d9\u05dd' }, grid: { drawOnChartArea: false } } });
        const ageCPLdata = an.map(a => data.ages[a].leads > 0 ? data.ages[a].spend / data.ages[a].leads : 0);
        const ageCPLcolors = ageCPLdata.map(v => v < 80 ? '#10b981' : v < 120 ? '#3b82f6' : v < 150 ? '#8b5cf6' : '#ef4444');
        const ageCPLbg = ageCPLdata.map(v => v < 80 ? 'rgba(16,185,129,0.15)' : v < 120 ? 'rgba(59,130,246,0.15)' : v < 150 ? 'rgba(139,92,246,0.15)' : 'rgba(239,68,68,0.15)');
        createChart('ageCPL', 'bar', an, [{ label: 'CPL (\u20aa)', data: ageCPLdata, backgroundColor: ageCPLbg, borderColor: ageCPLcolors, borderWidth: 2 }]);
        createChart('ageRates', 'bar', an, [{ label: 'CTR %', data: an.map(a => data.ages[a].impressions > 0 ? (data.ages[a].clicks / data.ages[a].impressions * 100) : 0), backgroundColor: 'rgba(6,182,212,0.15)', borderColor: '#06b6d4', borderWidth: 2 }, { label: '\u05d0\u05d7\u05d5\u05d6 \u05d4\u05de\u05e8\u05d4 %', data: an.map(a => data.ages[a].clicks > 0 ? (data.ages[a].leads / data.ages[a].clicks * 100) : 0), backgroundColor: 'rgba(139,92,246,0.15)', borderColor: '#8b5cf6', borderWidth: 2 }]);
        createChart('ageCPM', 'bar', an, [{ label: 'CPM (\u20aa)', data: an.map(a => data.ages[a].impressions > 0 ? (data.ages[a].spend / data.ages[a].impressions * 1000) : 0), backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#f59e0b', borderWidth: 2 }]);
      }
    }, 200);

    const campNames = Object.keys(data.campaigns);
    const adEntries = Object.entries(data.ads).sort((a, b) => b[1].spend - a[1].spend).slice(0, 10);
    const genderNames = Object.keys(data.genders).filter(g => g !== 'unknown');
    const ageNames = Object.keys(data.ages).filter(a => a !== 'unknown');

    const fbReports = currentReports.filter(r => r.source === 'facebook');
    const gReports = currentReports.filter(r => r.source && r.source.startsWith('google'));
    const crmReports = currentReports.filter(r => r.source === 'crm');
    const crmRepReports = currentReports.filter(r => r.source === 'crm_reports');
    // Tab visibility — show if the project has ANY data of this source (any month).
    // Data presence inside the tab is handled by an empty-state below.
    const anyFb = reports.some(r => r.source === 'facebook');
    const anyG = reports.some(r => r.source && r.source.startsWith('google'));
    const anyPmax = reports.some(r => r.source === 'google_pmax');
    const anySearch = reports.some(r => r.source === 'google_search');
    const anyCrm = reports.some(r => r.source === 'crm' || r.source === 'crm_reports');
    const hasFb = anyFb;
    const hasPmax = anyPmax;
    const hasSearch = anySearch;
    const hasG = anyG;
    const hasCrm = anyCrm;

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
          {hasPmax && <button className={`client-tab ${dashTab === 'google_pmax' ? 'active' : ''}`} onClick={() => setDashTab('google_pmax')}>Google PMax</button>}
            {hasSearch && <button className={`client-tab ${dashTab === 'google_search' ? 'active' : ''}`} onClick={() => setDashTab('google_search')}>Google Search</button>}
            {hasG && <button className={`client-tab ${dashTab === 'google' ? 'active' : ''}`} onClick={() => setDashTab('google')}>Google</button>}
          {hasCrm && <button className={`client-tab ${dashTab === 'crm' ? 'active' : ''}`} onClick={() => setDashTab('crm')}>CRM</button>}
        </div>

        {dashTab === 'crm' ? (<>
          <div className="client-tabs" style={{marginBottom: 15}}>
            <button className={`client-tab ${crmSubTab === 'sources' ? 'active' : ''}`} onClick={() => setCrmSubTab('sources')}>{'\ud83d\udcc2 \u05de\u05e7\u05d5\u05e8\u05d5\u05ea \u05d4\u05d2\u05e2\u05d4'}</button>
            <button className={`client-tab ${crmSubTab === 'reports' ? 'active' : ''}`} onClick={() => setCrmSubTab('reports')}>{'\ud83d\udcca \u05de\u05d7\u05d5\u05dc\u05dc \u05d3\u05d5\u05d7\u05d5\u05ea'}</button>
          </div>
          {crmSubTab === 'sources' ? renderCrmDashboard() : renderCrmReportDashboard()}
        </>) : (displayReports.length === 0 && dashTab !== 'all') ? (
          <div className="welcome-center" style={{padding:'60px 20px',textAlign:'center'}}>
            <div className="icon" style={{fontSize:'4em',marginBottom:'10px'}}>{'\ud83d\udced'}</div>
            <h3>{'\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05dc\u05d8\u05d5\u05d5\u05d7 \u05d4\u05ea\u05d0\u05e8\u05d9\u05db\u05d9\u05dd \u05e9\u05e0\u05d1\u05d7\u05e8'}</h3>
            <p style={{color:'#64748b',marginTop:'8px'}}>{'\u05d1\u05d7\u05e8 \u05d8\u05d5\u05d5\u05d7 \u05d0\u05d7\u05e8 \u05d0\u05d5 \u05d4\u05e8\u05e5 \u05e1\u05e0\u05db\u05e8\u05d5\u05df'}</p>
          </div>
        ) : (<>
        <div className="kpi-grid">
          {kpi('\u05ea\u05e7\u05e6\u05d9\u05d1', formatCurrency(activeT.spend), '', activeT.spend, activeP?.spend, true)}
          {dashTab === 'all' ? kpi('\u05dc\u05d9\u05d3\u05d9\u05dd', formatNum(totalLeadsWithCrm), 'green', totalLeadsWithCrm, activeP?.leads) : kpi('\u05dc\u05d9\u05d3\u05d9\u05dd', formatNum(activeT.leads), 'green', activeT.leads, activeP?.leads)}
          {kpi('\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3', formatCurrency(activeT.cpl), 'purple', activeT.cpl, activeP?.cpl, true)}
          {dashTab === 'all' && crmTotals ? kpi('\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05e9\u05ea\u05d5\u05d0\u05de\u05d5', formatNum(crmTotals.meetingsScheduled || 0), 'cyan', crmTotals.meetingsScheduled, null) : null}
          {dashTab === 'all' && crmTotals ? kpi('\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05e9\u05d1\u05d5\u05e6\u05e2\u05d5', formatNum(crmTotals.meetingsCompleted || 0), 'orange', crmTotals.meetingsCompleted, null) : null}
          {dashTab === 'all' && crmTotals ? kpi('\u05d4\u05e8\u05e9\u05de\u05d5\u05ea', formatNum(crmTotals.registrations || 0), 'green', crmTotals.registrations, null) : null}
          {dashTab === 'all' && crmTotals ? kpi('\u05d7\u05d5\u05d6\u05d9\u05dd', formatNum(crmTotals.contracts || 0), 'pink', crmTotals.contracts, null) : null}
        </div>

        {/* FUNNEL */}
        <div className="section">
          <div className="section-header" style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'20px'}}>
            <div className="section-icon" style={{background:'var(--gradient-2)'}}>{'\ud83d\udd3d'}</div>
            <div><h2 style={{fontSize:'1.3em',fontWeight:700,color:'var(--primary)',margin:0}}>{'\u05de\u05e9\u05e4\u05da \u05e9\u05d9\u05d5\u05d5\u05e7\u05d9'}</h2><div style={{fontSize:'0.85em',color:'var(--text-secondary)'}}>{'\u05de\u05e7\u05dc\u05d9\u05e7 \u05d5\u05e2\u05d3 \u05d7\u05d5\u05d6\u05d4'}</div></div>
          </div>
          <div className="card" style={{padding:'24px'}}>
            <div className="funnel">
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-1)'}}>{formatNum(activeT.clicks)}</div><div className="funnel-label">{'\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd'}</div></div>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--accent)',opacity:0.85}}>{formatNum(activeT.impressions)}</div><div className="funnel-label">{'\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea'}</div></div>
              {dashTab === 'all' && crmTotals ? <><div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--cyan)'}}>{formatNum(crmTotals.meetingsScheduled || 0)}</div><div className="funnel-label">{'\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05de\u05ea\u05d5\u05d0\u05de\u05d5\u05ea'}</div></div>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--purple)'}}>{formatNum(crmTotals.meetingsCompleted || 0)}</div><div className="funnel-label">{'\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05e9\u05d1\u05d5\u05e6\u05e2\u05d5'}</div></div>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-2)'}}>{formatNum(crmTotals.registrations || 0)}</div><div className="funnel-label">{'\u05d4\u05e8\u05e9\u05de\u05d5\u05ea'}</div></div>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-3)'}}>{formatNum(crmTotals.contracts || 0)}</div><div className="funnel-label">{'\u05d7\u05d5\u05d6\u05d9\u05dd'}</div></div></> : <>
              <div className="funnel-arrow">&larr;</div>
              <div className="funnel-step"><div className="funnel-bar" style={{background:'var(--gradient-2)'}}>{formatNum(activeT.leads)}</div><div className="funnel-label">{'\u05dc\u05d9\u05d3\u05d9\u05dd'}</div><div className="funnel-rate">{'\u05d4\u05de\u05e8\u05d4'}: {activeT.convRate.toFixed(2)}%</div></div></>}
            </div>
            <div style={{textAlign:'center',marginTop:'10px',fontSize:'0.85em',color:'var(--text-secondary)'}}>
              {'\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3'}: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(activeT.cpl)}</strong> &nbsp;|&nbsp; {'\u05e2\u05dc\u05d5\u05ea \u05dc\u05e7\u05dc\u05d9\u05e7'}: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(activeT.cpc)}</strong> &nbsp;|&nbsp; CPM: <strong style={{color:'var(--accent-dark)'}}>{formatCurrency(activeT.cpm)}</strong>
            </div>
          </div>
        </div>

        {/* Non-FB tabs: keep existing campaigns charts + flat table */}
        {!isFb && campNames.length > 0 && (<div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>{'\ud83d\udccb'}</div>{'\u05e7\u05de\u05e4\u05d9\u05d9\u05e0\u05d9\u05dd'}</div><div className="chart-grid"><div className="chart-card"><h4>{'\ud83d\udcca \u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05ea\u05e7\u05e6\u05d9\u05d1'}</h4><div className="chart-container"><canvas id="campSpend"></canvas></div></div><div className="chart-card"><h4>{'\ud83d\udcb0 \u05dc\u05d9\u05d3\u05d9\u05dd \u05d5-CPL'}</h4><div className="chart-container"><canvas id="campLeads"></canvas></div></div></div>{buildTable(data.campaigns, prevData?.campaigns, '\u05e7\u05de\u05e4\u05d9\u05d9\u05df', 'campaigns')}</div>)}

        {/* FB tab: nested expandable table — Campaign → Ad Set → Ad */}
        {isFb && campNames.length > 0 && (() => {
          // Build hierarchy from raw rows
          const tree = {};
          allRows.forEach(r => {
            const c = r.campaign || '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2';
            const a = r.adSet || '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2';
            const ad = r.adName || '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2';
            const spend = parseFloat(r.spend) || 0;
            const imp = parseFloat(r.impressions) || 0;
            const reach = parseFloat(r.reach) || 0;
            const clicks = parseFloat(r.clicks) || 0;
            const leads = parseFloat(r.leads) || 0;
            if (!tree[c]) tree[c] = { spend:0, impressions:0, reach:0, clicks:0, leads:0, adSets: {} };
            tree[c].spend += spend; tree[c].impressions += imp; tree[c].reach += reach; tree[c].clicks += clicks; tree[c].leads += leads;
            if (!tree[c].adSets[a]) tree[c].adSets[a] = { spend:0, impressions:0, reach:0, clicks:0, leads:0, ads: {} };
            tree[c].adSets[a].spend += spend; tree[c].adSets[a].impressions += imp; tree[c].adSets[a].reach += reach; tree[c].adSets[a].clicks += clicks; tree[c].adSets[a].leads += leads;
            if (!tree[c].adSets[a].ads[ad]) tree[c].adSets[a].ads[ad] = { spend:0, impressions:0, reach:0, clicks:0, leads:0, text:'' };
            tree[c].adSets[a].ads[ad].spend += spend; tree[c].adSets[a].ads[ad].impressions += imp; tree[c].adSets[a].ads[ad].reach += reach; tree[c].adSets[a].ads[ad].clicks += clicks; tree[c].adSets[a].ads[ad].leads += leads;
            if (r.adText) tree[c].adSets[a].ads[ad].text = r.adText;
          });
          const campaignNames = Object.keys(tree).sort((a,b) => tree[b].spend - tree[a].spend);
          const toggleCampaign = (c) => setExpandedCampaigns(prev => { const next = new Set(prev); if (next.has(c)) next.delete(c); else next.add(c); return next; });
          const toggleAdSet = (k) => setExpandedAdSets(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
          const cols = [
            { key:'name', label:'\u05e7\u05de\u05e4\u05d9\u05d9\u05df / \u05e7\u05d1\u05d5\u05e6\u05d4 / \u05de\u05d5\u05d3\u05e2\u05d4' },
            { key:'clicks', label:'\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd' },
            { key:'impressions', label:'\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea' },
            { key:'cpc', label:'\u05e2\u05dc\u05d5\u05ea \u05dc\u05e7\u05dc\u05d9\u05e7' },
            { key:'ctr', label:'CTR' },
            { key:'cpm', label:'CPM' },
            { key:'leads', label:'\u05dc\u05d9\u05d3\u05d9\u05dd' },
            { key:'cpl', label:'\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3' },
            { key:'spend', label:'\u05ea\u05e7\u05e6\u05d9\u05d1 \u05e9\u05e0\u05d5\u05e6\u05dc' },
          ];
          const renderRow = (name, data, level, isExpanded, hasChildren, onToggle, key) => {
            const cpl = data.leads > 0 ? data.spend/data.leads : 0;
            const cpc = data.clicks > 0 ? data.spend/data.clicks : 0;
            const ctr = data.impressions > 0 ? (data.clicks/data.impressions*100) : 0;
            const cpm = data.impressions > 0 ? (data.spend/data.impressions*1000) : 0;
            const cplClass = cpl > 0 && cpl < 80 ? 'tag-green' : cpl < 120 ? 'tag-blue' : cpl < 150 ? 'tag-purple' : 'tag-red';
            const rowBg = level === 0 ? 'transparent' : level === 1 ? 'rgba(59,130,246,0.05)' : 'rgba(16,185,129,0.05)';
            const indent = level * 24;
            const fontW = level === 0 ? 700 : level === 1 ? 600 : 400;
            const fontSize = level === 2 ? '0.9em' : '1em';
            return (
              <tr key={key} style={{background: rowBg, cursor: hasChildren ? 'pointer' : 'default', borderRight: level === 1 ? '3px solid rgba(59,130,246,0.3)' : level === 2 ? '3px solid rgba(16,185,129,0.3)' : 'none'}} onClick={hasChildren ? onToggle : undefined}>
                <td style={{fontWeight: fontW, fontSize, paddingRight: `${8 + indent}px`, unicodeBidi: 'plaintext', textAlign: 'right'}}>
                  <span style={{display:'inline-block', width:'18px', color:'#64748b', marginLeft:'4px'}}>
                    {hasChildren ? (isExpanded ? '\u25bc' : '\u25c0') : ''}
                  </span>
                  {name}
                </td>
                <td style={{fontSize}}>{formatNum(data.clicks)}</td>
                <td style={{fontSize}}>{formatNum(data.impressions)}</td>
                <td style={{fontSize}}>{formatCurrency(cpc)}</td>
                <td style={{fontSize}}>{ctr.toFixed(2)}%</td>
                <td style={{fontSize}}>{formatCurrency(cpm)}</td>
                <td style={{fontSize}}>{data.leads}</td>
                <td style={{fontSize}}><span className={`cpl-tag ${cplClass}`}>{formatCurrency(cpl)}</span></td>
                <td style={{fontSize, fontWeight: 600}}>{formatCurrency(data.spend)}</td>
              </tr>
            );
          };
          return (
            <div className="section">
              <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>{'\ud83d\udccb'}</div>{'\u05e7\u05de\u05e4\u05d9\u05d9\u05e0\u05d9\u05dd, \u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea \u05d5\u05de\u05d5\u05d3\u05e2\u05d5\u05ea'}</div>
              <div style={{fontSize:'0.85em',color:'#64748b',marginBottom:'12px',textAlign:'right'}}>{'\ud83d\udca1 \u05dc\u05d7\u05e5 \u05e2\u05dc \u05e7\u05de\u05e4\u05d9\u05d9\u05df \u05db\u05d3\u05d9 \u05dc\u05e8\u05d0\u05d5\u05ea \u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea, \u05d5\u05e2\u05dc \u05e7\u05d1\u05d5\u05e6\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea \u05db\u05d3\u05d9 \u05dc\u05e8\u05d0\u05d5\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea'}</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr>{cols.map(c => <th key={c.key} style={{whiteSpace:'nowrap'}}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {campaignNames.flatMap(cName => {
                      const cData = tree[cName];
                      const isCExpanded = expandedCampaigns.has(cName);
                      const adSetNames = Object.keys(cData.adSets).sort((a,b) => cData.adSets[b].spend - cData.adSets[a].spend);
                      const rows = [renderRow(cName, cData, 0, isCExpanded, adSetNames.length > 0, () => toggleCampaign(cName), `c-${cName}`)];
                      if (isCExpanded) {
                        adSetNames.forEach(aName => {
                          const aData = cData.adSets[aName];
                          const asKey = `${cName}|${aName}`;
                          const isAExpanded = expandedAdSets.has(asKey);
                          const adNames = Object.keys(aData.ads).sort((x,y) => aData.ads[y].spend - aData.ads[x].spend);
                          rows.push(renderRow(aName, aData, 1, isAExpanded, adNames.length > 0, () => toggleAdSet(asKey), `as-${asKey}`));
                          if (isAExpanded) {
                            adNames.forEach(adName => { rows.push(renderRow(adName, aData.ads[adName], 2, false, false, null, `ad-${asKey}|${adName}`)); });
                          }
                        });
                      }
                      return rows;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Standard ad groups table (Facebook + Search/Display) */}
        {!isPmax && !isFb && (
        <div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>{'\ud83c\udfaf'}</div>{'\u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea'}</div>{buildTable(data.adSets, prevData?.adSets, '\u05e7\u05d1\u05d5\u05e6\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea', 'adsets')}</div>
        )}

        {/* PMax: detailed asset-groups table (replaces both ad-groups + ads tables) */}
        {isPmax && (() => {
          const allAGs = displayReports.flatMap(r => r.summary?.assetGroups || []);
          if (allAGs.length === 0) return null;
          const sorted = [...allAGs].sort((a,b) => (b.spend || 0) - (a.spend || 0));
          return (
            <div className="section">
              <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>{'\ud83c\udfaf'}</div>{'\u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05e0\u05db\u05e1\u05d9\u05dd \u2014 \u05e4\u05d9\u05e8\u05d5\u05d8'}</div>
              <div className="card" style={{overflowX:'auto'}}>
                <table className="data-table"><thead><tr>
                  <th style={{whiteSpace:'nowrap'}}>{'\u05e7\u05d1\u05d5\u05e6\u05ea \u05e0\u05db\u05e1\u05d9\u05dd'}</th>
                  <th style={{whiteSpace:'nowrap'}}>{'\u05e7\u05de\u05e4\u05d9\u05d9\u05df'}</th>
                  <th style={{whiteSpace:'nowrap'}}>{'\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd'}</th>
                  <th style={{whiteSpace:'nowrap'}}>{'\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea'}</th>
                  <th style={{whiteSpace:'nowrap'}}>CTR</th>
                  <th style={{whiteSpace:'nowrap'}}>{'\u05dc\u05d9\u05d3\u05d9\u05dd'}</th>
                  <th style={{whiteSpace:'nowrap'}}>CPL</th>
                  <th style={{whiteSpace:'nowrap'}}>{'\u05d4\u05d5\u05e6\u05d0\u05d4'}</th>
                </tr></thead><tbody>
                  {sorted.map((ag, i) => {
                    const spend = ag.spend || 0;
                    const leads = ag.conversions || ag.leads || 0;
                    const clicks = ag.clicks || 0;
                    const imps = ag.impressions || 0;
                    const cpl = leads > 0 ? spend / leads : 0;
                    const ctr = imps > 0 ? (clicks / imps * 100) : 0;
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
                    );
                  })}
                </tbody></table>
              </div>
            </div>
          );
        })()}

{!isPmax && !isFb &&         <div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-3)'}}>{'\ud83d\udcdd'}</div>{'\u05de\u05d5\u05d3\u05e2\u05d5\u05ea'}</div>{buildTable((() => { const merged = {}; Object.entries(data.ads).forEach(([name, d]) => { const base = name.replace(/[\u200e\u200f\u200b\u200c\u200d\u202a-\u202e\u2066-\u2069\uFEFF]/g, '').replace(/\s*#\d+$/, '').replace(/\s*-\s*\u05e2\u05d5\u05ea\u05e7\s*$/, '').replace(/\s*-\s*\u05e2\u05d5\u05ea\u05e7\s*\d*$/, '').trim(); if (!merged[base]) merged[base] = { spend: 0, leads: 0, clicks: 0, impressions: 0, reach: 0 }; merged[base].spend += d.spend; merged[base].leads += d.leads; merged[base].clicks += d.clicks; merged[base].impressions += d.impressions; merged[base].reach += (d.reach || 0); }); return merged; })(), null, '\u05de\u05d5\u05d3\u05e2\u05d4', 'ads')}</div>}

        {/* GENDER SECTION — table format (like age) */}
        {!isPmax && genderNames.length > 0 && (() => {
          const gd = data.genders;
          const genderLabel = (g) => g === 'female' ? '\u05e0\u05e9\u05d9\u05dd' : g === 'male' ? '\u05d2\u05d1\u05e8\u05d9\u05dd' : g === 'unknown' ? '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2' : g;
          const orderedKeys = ['female', 'male', 'unknown'].filter(g => gd[g]);
          return (<div className="section">
            <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-4)'}}>{'\u26a7'}</div>{'\u05e4\u05d9\u05dc\u05d5\u05d7 \u05de\u05d2\u05d3\u05e8\u05d9'}</div>
            <div className="card"><div className="card-body" style={{overflowX:'auto'}}>
              <table className="data-table"><thead><tr>
                {[{key:'gender',label:'\u05de\u05d2\u05d3\u05e8'},{key:'clicks',label:'\u05e7\u05dc\u05d9\u05e7\u05d9\u05dd'},{key:'impressions',label:'\u05d7\u05e9\u05d9\u05e4\u05d5\u05ea'},{key:'cpc',label:'\u05e2\u05dc\u05d5\u05ea \u05dc\u05e7\u05dc\u05d9\u05e7'},{key:'ctr',label:'CTR'},{key:'cpm',label:'CPM'},{key:'leads',label:'\u05dc\u05d9\u05d3\u05d9\u05dd'},{key:'cpl',label:'\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3'},{key:'spend',label:'\u05ea\u05e7\u05e6\u05d9\u05d1 \u05e9\u05e0\u05d5\u05e6\u05dc'}].map(c=>(<th key={c.key} style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>handleSort('genders',c.key)}>{c.label}{(()=>{const s=sortConfig['genders'];if(!s||s.key!==c.key)return ' \u21c5';return s.dir==='desc'?' \u25bc':' \u25b2';})()}</th>))}
              </tr></thead><tbody>
                {(()=>{
                  const gCols={gender:{get:(d,n)=>n},clicks:{get:d=>d.clicks,higher:true},impressions:{get:d=>d.impressions,higher:true},cpc:{get:d=>d.clicks>0?d.spend/d.clicks:0,higher:false},ctr:{get:d=>d.impressions>0?(d.clicks/d.impressions*100):0,higher:true},cpm:{get:d=>d.impressions>0?(d.spend/d.impressions*1000):0,higher:false},leads:{get:d=>d.leads,higher:true},cpl:{get:d=>d.leads>0?d.spend/d.leads:0,higher:false},spend:{get:d=>d.spend}};
                  const sc=sortConfig['genders'];
                  let sorted=[...orderedKeys];
                  if(sc&&gCols[sc.key]){sorted.sort((a,b)=>{const va=gCols[sc.key].get(gd[a],a),vb=gCols[sc.key].get(gd[b],b);if(typeof va==='string')return sc.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);return sc.dir==='asc'?va-vb:vb-va;});}
                  const gExtremes={};
                  Object.keys(gCols).forEach(k=>{if(k==='gender'||k==='spend')return;const c=gCols[k];const vals=sorted.map(g=>c.get(gd[g],g)).filter(v=>typeof v==='number'&&v>0);if(vals.length<2)return;gExtremes[k]={min:Math.min(...vals),max:Math.max(...vals)};});
                  const gCellBg=(key,val)=>{const e=gExtremes[key];if(!e||val<=0||e.min===e.max)return {};const c=gCols[key];if(!c||c.higher===undefined)return {};if(val===e.max)return c.higher?{color:'#059669',fontWeight:700}:{color:'#dc2626',fontWeight:700};if(val===e.min)return c.higher?{color:'#dc2626',fontWeight:700}:{color:'#059669',fontWeight:700};return {};};
                  return sorted.map(g => { const d = gd[g]; const cpl = d.leads > 0 ? d.spend / d.leads : 0; const cpc = d.clicks > 0 ? d.spend / d.clicks : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; const cplClass = cpl > 0 && cpl < 80 ? 'tag-green' : cpl < 120 ? 'tag-blue' : cpl < 150 ? 'tag-purple' : 'tag-red'; return (
                    <tr key={g}><td style={{fontWeight:600}}>{genderLabel(g)}</td><td style={gCellBg('clicks',d.clicks)}>{formatNum(d.clicks)}</td><td style={gCellBg('impressions',d.impressions)}>{formatNum(d.impressions)}</td><td style={gCellBg('cpc',cpc)}>{formatCurrency(cpc)}</td><td style={gCellBg('ctr',ctr)}>{ctr.toFixed(2)}%</td><td style={gCellBg('cpm',cpm)}>{formatCurrency(cpm)}</td><td style={gCellBg('leads',d.leads)}>{d.leads}</td><td style={gCellBg('cpl',cpl)}><span className={`cpl-tag ${cplClass}`}>{formatCurrency(cpl)}</span></td><td>{formatCurrency(d.spend)}</td></tr>);});
                })()}
              </tbody></table>
            </div></div>
          </div>);
        })()}

        {/* AGE SECTION - full table + 4 charts */}
        {!isPmax && ageNames.length > 0 && (() => {
          const ad = data.ages;
          const sortedAges = ageNames.sort((a, b) => { const na = parseInt(a); const nb = parseInt(b); return na - nb; });
          return (<div className="section">
            <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-1)'}}>{'\ud83d\udcc5'}</div>{'\u05e4\u05d9\u05dc\u05d5\u05d7 \u05d2\u05d9\u05dc\u05d0\u05d9'}</div>
            <div className="card" style={{marginBottom:'20px'}}><div className="card-body" style={{overflowX:'auto'}}>
              <table className="data-table"><thead><tr>
                {[{key:'age',label:'גיל'},{key:'clicks',label:'קליקים'},{key:'impressions',label:'חשיפות'},{key:'cpc',label:'עלות לקליק'},{key:'ctr',label:'CTR'},{key:'cpm',label:'CPM'},{key:'leads',label:'לידים'},{key:'cpl',label:'עלות לליד'},{key:'spend',label:'תקציב שנוצל'}].map(c=>(<th key={c.key} style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>handleSort('ages',c.key)}>{c.label}{(()=>{const s=sortConfig['ages'];if(!s||s.key!==c.key)return ' ⇅';return s.dir==='desc'?' ▼':' ▲';})()}</th>))}
              </tr></thead><tbody>
                {(()=>{const ageCols={age:{get:(d,n)=>n},clicks:{get:d=>d.clicks,higher:true},impressions:{get:d=>d.impressions,higher:true},cpc:{get:d=>d.clicks>0?d.spend/d.clicks:0,higher:false},ctr:{get:d=>d.impressions>0?(d.clicks/d.impressions*100):0,higher:true},cpm:{get:d=>d.impressions>0?(d.spend/d.impressions*1000):0,higher:false},leads:{get:d=>d.leads,higher:true},cpl:{get:d=>d.leads>0?d.spend/d.leads:0,higher:false},spend:{get:d=>d.spend}};const sc=sortConfig['ages'];let sorted=[...sortedAges];if(sc&&ageCols[sc.key]){sorted.sort((a,b)=>{const va=ageCols[sc.key].get(ad[a],a),vb=ageCols[sc.key].get(ad[b],b);if(typeof va==='string')return sc.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);return sc.dir==='asc'?va-vb:vb-va;});}const ageExtremes={};Object.keys(ageCols).forEach(k=>{if(k==='age'||k==='spend')return;const c=ageCols[k];const vals=sorted.map(a=>c.get(ad[a],a)).filter(v=>typeof v==='number'&&v>0);if(vals.length<2)return;ageExtremes[k]={min:Math.min(...vals),max:Math.max(...vals)};});const ageCellBg=(key,val)=>{const e=ageExtremes[key];if(!e||val<=0||e.min===e.max)return {};const c=ageCols[key];if(!c||c.higher===undefined)return {};if(val===e.max)return c.higher?{color:'#059669',fontWeight:700}:{color:'#dc2626',fontWeight:700};if(val===e.min)return c.higher?{color:'#dc2626',fontWeight:700}:{color:'#059669',fontWeight:700};return {};};return sorted.map(age => { const d = ad[age]; const cpl = d.leads > 0 ? d.spend / d.leads : 0; const cpc = d.clicks > 0 ? d.spend / d.clicks : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const conv = d.clicks > 0 ? (d.leads / d.clicks * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; const cplClass = cpl > 0 && cpl < 80 ? 'tag-green' : cpl < 120 ? 'tag-blue' : cpl < 150 ? 'tag-purple' : 'tag-red'; return (
                  <tr key={age}><td style={{fontWeight:600}}>{age}</td><td style={ageCellBg('clicks',d.clicks)}>{formatNum(d.clicks)}</td><td style={ageCellBg('impressions',d.impressions)}>{formatNum(d.impressions)}</td><td style={ageCellBg('cpc',cpc)}>{formatCurrency(cpc)}</td><td style={ageCellBg('ctr',ctr)}>{ctr.toFixed(2)}%</td><td style={ageCellBg('cpm',cpm)}>{formatCurrency(cpm)}</td><td style={ageCellBg('leads',d.leads)}>{d.leads}</td><td style={ageCellBg('cpl',cpl)}><span className={`cpl-tag ${cplClass}`}>{formatCurrency(cpl)}</span></td><td>{formatCurrency(d.spend)}</td></tr>);});})()}
              </tbody></table>
            </div></div>
            {dashTab !== 'all' && dashTab !== 'facebook' && (<>
            <div className="chart-grid">
              <div className="chart-card"><h4>{'\ud83d\udcb0 \u05d4\u05d5\u05e6\u05d0\u05d4 \u05d5\u05dc\u05d9\u05d3\u05d9\u05dd'}</h4><div className="chart-container"><canvas id="ageSpendLeads"></canvas></div></div>
              <div className="chart-card"><h4>{'\ud83d\udcc8 \u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3 (CPL)'}</h4><div className="chart-container"><canvas id="ageCPL"></canvas></div></div>
            </div>
            <div className="chart-grid">
              <div className="chart-card"><h4>{'\ud83d\uddb1 CTR \u05d1\u05d0\u05d7\u05d5\u05d6 \u05d4\u05de\u05e8\u05d4'}</h4><div className="chart-container"><canvas id="ageRates"></canvas></div></div>
              <div className="chart-card"><h4>{'\ud83d\udce1 CPM'}</h4><div className="chart-container"><canvas id="ageCPM"></canvas></div></div>
            </div>
            </>)}
          </div>);
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
                  // Handle both old field names (imageUrl, type) and new GAQL names (image_url, field_type)
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
                        {/* Metrics row */}
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
          <div className="section-title"><div className="section-icon" style={{background:'var(--gradient-2)'}}>{'\ud83d\udca1'}</div>{'\u05ea\u05d5\u05d1\u05e0\u05d5\u05ea \u05d5\u05d4\u05de\u05dc\u05e6\u05d5\u05ea'}</div>
          {(() => {
            const camps = Object.entries(data.campaigns);
         const ads2 = isPmax ? Object.entries(data.adSets || {}) : Object.entries(data.ads);
            const bestCamp = camps.sort((a,b) => { const ca = a[1].leads > 0 ? a[1].spend/a[1].leads : 9999; const cb = b[1].leads > 0 ? b[1].spend/b[1].leads : 9999; return ca - cb; })[0];
            const worstCamp = camps.sort((a,b) => { const ca = a[1].leads > 0 ? a[1].spend/a[1].leads : 0; const cb = b[1].leads > 0 ? b[1].spend/b[1].leads : 0; return cb - ca; })[0];
            const bestAd = ads2.sort((a,b) => { const ca = a[1].leads > 0 ? a[1].spend/a[1].leads : 9999; const cb = b[1].leads > 0 ? b[1].spend/b[1].leads : 9999; return ca - cb; })[0];
            const bestAge = isPmax ? null : (ageNames.length > 0 ? ageNames.sort((a,b) => { const da = data.ages[a]; const db = data.ages[b]; const ca = da.leads > 0 ? da.spend/da.leads : 9999; const cb = db.leads > 0 ? db.spend/db.leads : 9999; return ca - cb; })[0] : null);
            const worstAge = ageNames.length > 0 ? ageNames.sort((a,b) => { const da = data.ages[a]; const db = data.ages[b]; const ca = da.leads > 0 ? da.spend/da.leads : 0; const cb = db.leads > 0 ? db.spend/db.leads : 0; return cb - ca; })[0] : null;
            return (<>
              <div className="insight-box" style={{background:'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',border:'1px solid #bfdbfe',borderRadius:'var(--radius)',padding:'20px 24px',marginBottom:'20px'}}>
                <h3 style={{fontSize:'1em',color:'var(--accent-dark)',marginBottom:'10px'}}>{'\ud83c\udfc6 \u05de\u05d4 \u05e2\u05d5\u05d1\u05d3 \u05d4\u05db\u05d9 \u05d8\u05d5\u05d1'}</h3>
                <ul style={{listStyle:'none',padding:0,direction:'rtl',textAlign:'right'}}>
                  {bestCamp && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>{'\ud83d\udca1'} {'\u05e7\u05de\u05e4\u05d9\u05d9\u05df'} <strong>{bestCamp[0]}</strong> - CPL {'\u05d4\u05e0\u05de\u05d5\u05da \u05d1\u05d9\u05d5\u05ea\u05e8'} ({formatCurrency(bestCamp[1].leads > 0 ? bestCamp[1].spend/bestCamp[1].leads : 0)}) {'\u05e2\u05dd'} {bestCamp[1].leads} {'\u05dc\u05d9\u05d3\u05d9\u05dd'}</li>}
                  {bestAd && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>{'\ud83d\udca1'} {isPmax ? '\u05e7\u05d1\u05d5\u05e6\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea' : '\u05de\u05d5\u05d3\u05e2\u05d4'} <strong>{bestAd[0]}</strong> - {bestAd[1].leads} {'\u05dc\u05d9\u05d3\u05d9\u05dd'} {'\u05d1-'}{formatCurrency(bestAd[1].leads > 0 ? bestAd[1].spend/bestAd[1].leads : 0)} {'\u05dc\u05dc\u05d9\u05d3'}</li>}
                  {!isPmax && bestAge && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>{'\ud83d\udca1'} {'\u05d2\u05d9\u05dc\u05d0\u05d9'} <strong>{bestAge}</strong> - CPL {'\u05d4\u05e0\u05de\u05d5\u05da \u05d1\u05d9\u05d5\u05ea\u05e8'} ({formatCurrency(data.ages[bestAge].leads > 0 ? data.ages[bestAge].spend/data.ages[bestAge].leads : 0)})</li>}
                </ul>
              </div>
              <div className="insight-box" style={{background:'linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%)',border:'1px solid #fecaca',borderRadius:'var(--radius)',padding:'20px 24px',marginBottom:'20px'}}>
                <h3 style={{fontSize:'1em',color:'#dc2626',marginBottom:'10px'}}>{'\u26a0\ufe0f \u05de\u05d4 \u05e6\u05e8\u05d9\u05da \u05dc\u05e9\u05e4\u05e8'}</h3>
                <ul style={{listStyle:'none',padding:0,direction:'rtl',textAlign:'right'}}>
                  {worstCamp && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>{'\ud83d\udca1'} {'\u05e7\u05de\u05e4\u05d9\u05d9\u05df'} <strong>{worstCamp[0]}</strong> - CPL {'\u05d2\u05d1\u05d5\u05d4'} ({formatCurrency(worstCamp[1].leads > 0 ? worstCamp[1].spend/worstCamp[1].leads : 0)}). {'\u05e9\u05d5\u05d5\u05d4 \u05dc\u05e9\u05e7\u05d5\u05dc \u05e9\u05d9\u05e0\u05d5\u05d9 \u05e7\u05e8\u05d9\u05d0\u05d9\u05d9\u05d8\u05d9\u05d1.'}</li>}
                  {worstAge && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>{'\ud83d\udca1'} {'\u05d2\u05d9\u05dc\u05d0\u05d9'} <strong>{worstAge}</strong> - CPL {'\u05d4\u05d2\u05d1\u05d5\u05d4 \u05d1\u05d9\u05d5\u05ea\u05e8'} ({formatCurrency(data.ages[worstAge].leads > 0 ? data.ages[worstAge].spend/data.ages[worstAge].leads : 0)})</li>}
                </ul>
              </div>
              <div className="insight-box" style={{background:'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',border:'1px solid #86efac',borderRadius:'var(--radius)',padding:'20px 24px',marginBottom:'20px'}}>
                <h3 style={{fontSize:'1em',color:'#059669',marginBottom:'10px'}}>{'\ud83c\udfaf \u05d4\u05de\u05dc\u05e6\u05d5\u05ea \u05dc\u05d7\u05d5\u05d3\u05e9 \u05d4\u05d1\u05d0'}</h3>
                <ul style={{listStyle:'none',padding:0,direction:'rtl',textAlign:'right'}}>
                  {bestCamp && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>{'\ud83d\udca1'} {'\u05d4\u05d2\u05d3\u05dc\u05ea \u05ea\u05e7\u05e6\u05d9\u05d1 \u05dc-'}<strong>{bestCamp[0]}</strong> - {'\u05d4-CPL \u05d4\u05e0\u05de\u05d5\u05da \u05d1\u05d9\u05d5\u05ea\u05e8 \u05e2\u05dd \u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05dc\u05d4\u05d2\u05d3\u05dc\u05d4'}</li>}
                  {bestAge && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>{'\ud83d\udca1'} {'\u05d7\u05d9\u05d6\u05d5\u05e7 \u05d2\u05d9\u05dc\u05d0\u05d9'} <strong>{bestAge}</strong> - {'\u05d4\u05db\u05d9 \u05d0\u05e4\u05e7\u05d8\u05d9\u05d1\u05d9\u05d9\u05dd \u05de\u05d1\u05d7\u05d9\u05e0\u05ea \u05e2\u05dc\u05d5\u05ea'}</li>}
                  {worstCamp && <li style={{padding:'6px 0',fontSize:'0.9em',unicodeBidi:'plaintext'}}>{'\ud83d\udca1'} {'\u05d1\u05d3\u05d9\u05e7\u05d4 \u05de\u05d7\u05d3\u05e9 \u05e9\u05dc'} <strong>{worstCamp[0]}</strong> - {'\u05d4\u05d7\u05dc\u05e4\u05ea \u05e7\u05e8\u05d9\u05d0\u05d9\u05d9\u05d8\u05d9\u05d1 \u05d0\u05d5 \u05d4\u05e4\u05e1\u05e7\u05d4'}</li>}
                </ul>
              </div>
            </>);
          })()}
        </div>
        </>)}
      </>
    );
  }, [selectedMonth, compareEnabled, reports, dashTab, crmSubTab, renderCrmDashboard, renderCrmReportDashboard, sortConfig, expandedCampaigns, expandedAdSets]);

  if (loading) return <div className="loading-page">{'\u05d8\u05d5\u05e2\u05df...'}</div>;

  if (!session) {
    return (
      <div className="login-container">
        <h1 className="logo" style={{fontSize: '3em'}}>VITAS</h1>
        <p className="subtitle">{'\u05de\u05e2\u05e8\u05db\u05ea \u05d3\u05d5\u05d7\u05d5\u05ea \u05e9\u05d9\u05d5\u05d5\u05e7 \u05d3\u05d9\u05d2\u05d9\u05d8\u05dc\u05d9'}</p>
        <div className="card">
          <form onSubmit={handleAuth} method="post" action="#">
            <div className="form-group"><label>{'\u05d0\u05d9\u05de\u05d9\u05d9\u05dc'}</label><input id="admin-email" name="email" className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" autoComplete="username" required /></div>
            <div className="form-group"><label>{'\u05e1\u05d9\u05e1\u05dd\u05d4'}</label><input id="admin-password" name="password" className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} dir="ltr" autoComplete="current-password" required /></div>
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
    <div dir="rtl" style={{direction:'rtl',textAlign:'right'}}>
      {refreshing && (() => {
        const ESTIMATED_SECONDS = 22;
        const progress = Math.min(100, (refreshElapsed / ESTIMATED_SECONDS) * 100);
        const remaining = Math.max(0, ESTIMATED_SECONDS - refreshElapsed);
        return (
          <div style={{position:'fixed',top:0,left:0,right:0,zIndex:9999,background:'linear-gradient(135deg, rgba(59,130,246,0.95), rgba(139,92,246,0.95))',color:'white',padding:'14px 24px',boxShadow:'0 4px 20px rgba(0,0,0,0.3)',backdropFilter:'blur(10px)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'18px',flexWrap:'wrap',maxWidth:'1200px',margin:'0 auto'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{width:'22px',height:'22px',border:'3px solid rgba(255,255,255,0.25)',borderTopColor:'#ffffff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}></div>
                <div style={{fontWeight:700,fontSize:'1em'}}>{'\ud83d\udd04 \u05de\u05d5\u05e9\u05da \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05d7\u05d9\u05d9\u05dd \u05de-Facebook \u05d5-Google...'}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'14px',fontSize:'0.9em'}}>
                <div style={{background:'rgba(255,255,255,0.2)',padding:'4px 12px',borderRadius:'20px',fontWeight:600}}>{'\u05d7\u05dc\u05e4\u05d5: '}{refreshElapsed}{'s'}</div>
                <div style={{background:'rgba(255,255,255,0.2)',padding:'4px 12px',borderRadius:'20px'}}>{'\u2248 '}{remaining}{'s \u05e0\u05ea\u05d5\u05e2\u05e8\u05d5'}</div>
              </div>
            </div>
            <div style={{marginTop:'10px',maxWidth:'600px',margin:'10px auto 0',height:'4px',background:'rgba(255,255,255,0.2)',borderRadius:'2px',overflow:'hidden'}}>
              <div style={{width:`${progress}%`,height:'100%',background:'white',transition:'width 0.5s ease-out',boxShadow:'0 0 10px rgba(255,255,255,0.6)'}}></div>
            </div>
          </div>
        );
      })()}
      <style jsx>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div className="header"><div className="header-content"><div className="logo">VITAS REPORTS</div><div className="header-nav"><button className="nav-btn" onClick={refreshAll} disabled={refreshing} title="משוך נתונים חיים מ-Facebook + Google">{refreshing ? '\u27f3 \u05de\u05e8\u05e2\u05e0\u05df...' : '\ud83d\udd04 \u05e8\u05e2\u05e0\u05df \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd'}</button><button className="nav-btn" onClick={refreshFromBmby} disabled={refreshingCrm} title="משוך נתוני CRM חיים מ-BMBY">{refreshingCrm ? '\u27f3 \u05de\u05e8\u05e2\u05e0\u05df CRM...' : '\ud83e\uddfe \u05e8\u05e2\u05e0\u05df CRM'}</button><button className="nav-btn danger" onClick={handleLogout}>{'\u05d9\u05e6\u05d9\u05d0\u05d4'}</button></div></div></div>

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

          {view === 'dashboard' && selectedProject && (<>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25}}>
              <h2 style={{fontSize: '1.8em', fontWeight: 800}}>{selectedClient?.name} / {selectedProject.name}</h2>
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                <select className="form-input" style={{width:'auto',minWidth:'180px'}} value={selectedMonth || activePreset} onChange={e => applyPreset(e.target.value)}>
                  {/* Hidden current-period option so the dropdown LABEL reflects the actual data period being shown */}
                  {selectedMonth && (
                    <option value={selectedMonth} style={{display:'none'}}>{formatMonth(selectedMonth)}</option>
                  )}
                  <option value="today">{'\ud83d\udcc5 \u05d4\u05d9\u05d5\u05dd'}</option>
                  <option value="yesterday">{'\u05d0\u05ea\u05de\u05d5\u05dc'}</option>
                  <option value="last7">{'7 \u05d9\u05de\u05d9\u05dd \u05d0\u05d7\u05e8\u05d5\u05e0\u05d9\u05dd'}</option>
                  <option value="last30">{'30 \u05d9\u05de\u05d9\u05dd \u05d0\u05d7\u05e8\u05d5\u05e0\u05d9\u05dd'}</option>
                  <option value="currentMonth">{'\u05d4\u05d7\u05d5\u05d3\u05e9 \u05d4\u05e0\u05d5\u05db\u05d7\u05d9'}</option>
                  <option value="lastMonth">{'\u05d7\u05d5\u05d3\u05e9 \u05e9\u05e2\u05d1\u05e8'}</option>
                  <option value="custom">{'\u05d8\u05d5\u05d5\u05d7 \u05de\u05d5\u05ea\u05d0\u05dd \u05d0\u05d9\u05e9\u05d9\u05ea...'}</option>
                </select>
                {activePreset === 'custom' && (
                  <div style={{display:'inline-flex',alignItems:'center',gap:'6px',padding:'6px 10px',background:'rgba(0,0,0,0.04)',borderRadius:'8px',fontSize:'0.85em'}}>
                    <span style={{color:'var(--text-secondary)'}}>{'\u05de:'}</span>
                    <input type="date" value={customSince} onChange={e => setCustomSince(e.target.value)} style={{padding:'4px 6px',borderRadius:'4px',fontSize:'0.88em',border:'1px solid #d1d5db'}} />
                    <span style={{color:'var(--text-secondary)'}}>{'\u05e2\u05d3:'}</span>
                    <input type="date" value={customUntil} onChange={e => setCustomUntil(e.target.value)} style={{padding:'4px 6px',borderRadius:'4px',fontSize:'0.88em',border:'1px solid #d1d5db'}} />
                    <button className="btn btn-sm btn-primary" style={{padding:'4px 10px',fontSize:'0.82em'}} onClick={() => applyCustomRange()} disabled={!customSince || !customUntil || refreshing}>{'\u05d4\u05e6\u05d2'}</button>
                  </div>
                )}
                <label style={{fontSize:'0.9em',display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'6px 12px',background:'rgba(59,130,246,0.08)',borderRadius:'8px',border:'1px solid rgba(59,130,246,0.2)'}} title="מציג השוואה של אותה תקופה בחודש הקודם (למשל 7 ימים אחרונים מול 7 ימים בחודש שעבר)">
                  <input type="checkbox" checked={compareEnabled} onChange={e => onComparisonToggle(e.target.checked)} />
                  {'\u05d4\u05e9\u05d5\u05d5\u05d0\u05d4 \u05dc\u05d0\u05d5\u05ea\u05d4 \u05ea\u05e7\u05d5\u05e4\u05d4'}
                </label>
              </div>
            </div>
            {reports.length === 0 ? (<div className="welcome-center"><div className="icon">{'\ud83d\udced'}</div><h3>{'\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05e2\u05d3\u05d9\u05d9\u05df'}</h3><p style={{marginTop:10,color:'var(--text-secondary)'}}>{'\u05dc\u05d7\u05e5 \u05e2\u05dc \u05db\u05e4\u05ea\u05d5\u05e8 \u05d4\u05e8\u05e2\u05e0\u05d5\u05df \u05dc\u05de\u05e9\u05d9\u05db\u05ea \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd'}</p></div>) : renderDashboard()}
          </>)}

          
        </div>
      </div>

      <div className={`modal-overlay ${showAddClient ? 'active' : ''}`} onClick={e => { if (e.target === e.currentTarget) setShowAddClient(false); }}><div className="modal"><h3>{'\u05d4\u05d5\u05e1\u05e3 \u05dc\u05e7\u05d5\u05d7 \u05d7\u05d3\u05e9'}</h3><div className="form-group"><label>{'\u05e9\u05dd \u05dc\u05e7\u05d5\u05d7'}</label><input className="form-input" value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder={'\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: \u05e9.\u05d1\u05e8\u05d5\u05dc'} /></div><div className="form-group"><label>{'\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8\u05d9\u05dd (\u05de\u05d5\u05e4\u05e8\u05d3\u05d9\u05dd \u05d1\u05e4\u05e1\u05d9\u05e7\u05d9\u05dd)'}</label><input className="form-input" value={newClientProjects} onChange={e => setNewClientProjects(e.target.value)} placeholder={'\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: HI PARK, ONCE'} /></div><div className="form-group"><label>{'\u05e6\u05d1\u05e2'}</label><select className="form-input" value={newClientColor} onChange={e => setNewClientColor(e.target.value)}><option value="#3b82f6">{'\u05db\u05d7\u05d5\u05dc'}</option><option value="#10b981">{'\u05d9\u05e8\u05d5\u05e7'}</option><option value="#8b5cf6">{'\u05e1\u05d2\u05d5\u05dc'}</option><option value="#f59e0b">{'\u05db\u05ea\u05d5\u05dd'}</option><option value="#ec4899">{'\u05d5\u05e8\u05d5\u05d3'}</option></select></div><div className="modal-actions"><button className="btn btn-primary" onClick={addClient}>{'\u05d4\u05d5\u05e1\u05e3'}</button><button className="btn btn-outline" onClick={() => setShowAddClient(false)}>{'\u05d1\u05d9\u05d8\u05d5\u05dc'}</button></div></div></div>

      <div className={`modal-overlay ${showAddProject ? 'active' : ''}`} onClick={e => { if (e.target === e.currentTarget) setShowAddProject(false); }}><div className="modal"><h3>{'\u05d4\u05d5\u05e1\u05e3 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05dc-'}{selectedClient?.name}</h3><div className="form-group"><label>{'\u05e9\u05dd \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8'}</label><input className="form-input" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder={'\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: HI PARK'} /></div><div className="modal-actions"><button className="btn btn-primary" onClick={addProject}>{'\u05d4\u05d5\u05e1\u05e3'}</button><button className="btn btn-outline" onClick={() => setShowAddProject(false)}>{'\u05d1\u05d9\u05d8\u05d5\u05dc'}</button></div></div></div>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
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
