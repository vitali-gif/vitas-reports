'use client'
// rebuild trigger
import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatCurrencyCompact, formatNum, formatMonth, mapFacebookRows, mapGoogleRows, mapCrmRows, mapCrmReportRows, aggregateRows, aggregateCrmRows, aggregateCrmReportRows, changePercent, getPrevMonth, COLORS, getRecommendationsWindowMonths } from '../../lib/helpers'
import { normalizeObjections } from '../../lib/objection-normalize.js'
import SkeletonDashboard from '../../lib/skeleton'
import { buildRecommendations, groupByRole, ROLE_META, ROLE_ORDER, compareImpact } from '../../lib/recommendations'
import Chart from 'chart.js/auto'
import * as XLSX from 'xlsx'
import Header from '../components/shell/Header'
import Sidebar from '../components/shell/Sidebar'
import TitleBar from '../components/shell/TitleBar'
import Sparkline from '../components/Sparkline'


// Reusable info tooltip - click ⓘ to open a styled popover with the explanation.
function InfoTip({ text }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!e.target.closest('.info-tip-popover') && !e.target.closest('.info-tip-wrapper')) {
        setOpen(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [open])

  const handleClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right - 4),
      })
    }
    setOpen(!open)
  }

  return (
    <span className="info-tip-wrapper" style={{ position: 'relative', display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }}>
      <span
        ref={triggerRef}
        onClick={handleClick}
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
      {open && typeof document !== 'undefined' && createPortal(
        <div className="info-tip-popover" style={{
          position: 'fixed',
          top: pos.top,
          right: pos.right,
          background: '#1e293b',
          color: '#f1f5f9',
          padding: '14px 16px',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 400,
          lineHeight: 1.6,
          width: 280,
          maxWidth: '90vw',
          whiteSpace: 'pre-line',
          boxShadow: '0 12px 32px rgba(15,23,42,0.4)',
          zIndex: 10000,
          textAlign: 'right',
          direction: 'rtl',
        }}>
          {text.split('\n').map((line, i, arr) => (
            <span key={i}>{line}{i < arr.length - 1 && <br/>}</span>
          ))}
        </div>,
        document.body
      )}
    </span>
  )
}


export default function AdminPage({ isClientView = false, allowedProjectIds = null, initialClients = null }) {
  const DEMO_CLIENT_NAME  = 'קבוצת אורבן'
  const DEMO_PROJECT_NAME = 'מטרופוליס'
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
  const [cityMetric, setCityMetric] = useState('leads')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Lock page scroll while the mobile drawer is open
  useEffect(() => {
    document.body.classList.toggle('no-scroll', sidebarOpen);
    return () => document.body.classList.remove('no-scroll');
  }, [sidebarOpen])
  const [clientAccessList, setClientAccessList] = useState([])
  const [showClientAccess, setShowClientAccess] = useState(false)
  const [showSessionLogs, setShowSessionLogs] = useState(false)
  const [sessionLogs, setSessionLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [caEmail, setCaEmail] = useState('')
  const [caClientId, setCaClientId] = useState('')
  const [caLabel, setCaLabel] = useState('')
  const [caSaving, setCaSaving] = useState(false)
  const [vitasTasks, setVitasTasks] = useState([])
  const [recSubTab, setRecSubTab] = useState('new')
  const [lockingRecKey, setLockingRecKey] = useState('')
  const [ruleDialog, setRuleDialog] = useState(null)  // {recRef, ruleType, params}
  const [creatingRule, setCreatingRule] = useState(false)
  const chartsRef = useRef([])
  const [showAddClient, setShowAddClient] = useState(false)
  const [showAddProject, setShowAddProject] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientProjects, setNewClientProjects] = useState('')
  const [newClientColor, setNewClientColor] = useState('#3b82f6')
  const [newProjectName, setNewProjectName] = useState('')
  const [toast, setToast] = useState('')
  const [namedLeadsModal, setNamedLeadsModal] = useState(null) // {title, names:[]}
  const [sortConfig, setSortConfig] = useState({});
  const [expandedCampaigns, setExpandedCampaigns] = useState(new Set());
  const [expandedAdSets, setExpandedAdSets] = useState(new Set());
  const [expandedCrmSources, setExpandedCrmSources] = useState(new Set());
  const handleSort = (tableId, key) => { setSortConfig(prev => { const cur = prev[tableId]; if (cur && cur.key === key) return {...prev, [tableId]: {key, dir: cur.dir === 'desc' ? 'asc' : 'desc'}}; return {...prev, [tableId]: {key, dir: 'desc'}}; }); };
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isClientView) {
      if (initialClients?.length) setClients(initialClients);
      return;
    }
    if (session) loadClients();
  }, [session, isClientView]); // eslint-disable-line

  const handleAuth = async (e) => {
    e.preventDefault(); setAuthError('');
    try {
      let result;
      if (isSignUp) result = await supabase.auth.signUp({ email, password });
      else result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
    } catch (err) { setAuthError(err.message); }
  };

  const handleLogout = async () => { await supabase.auth.signOut({ scope: 'global' }); setSession(null); };
  const handleClientAccess = () => { setShowClientAccess(true); loadClientAccess(); };
  const handleSessionLogs = async () => {
    setShowSessionLogs(true)
    setLogsLoading(true)
    const res = await fetch('/api/client-log', { headers: { 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' } })
    const data = await res.json()
    setSessionLogs(Array.isArray(data) ? data : [])
    setLogsLoading(false)
  }
  const handleExport = () => { alert('ייצוא לאקסל יהיה זמין בקרוב'); };

  const loadClientAccess = async () => {
    const res = await fetch('/api/client-access', { headers: { 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' } })
    const data = await res.json()
    setClientAccessList(Array.isArray(data) ? data : [])
  }

  const addClientAccess = async () => {
    if (!caEmail.trim() || !caClientId) return
    setCaSaving(true)
    const res = await fetch('/api/client-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' },
      body: JSON.stringify({ email: caEmail.trim(), client_id: caClientId })
    })
    setCaSaving(false)
    if (res.ok) {
      const result = await res.json()
      setCaEmail(''); setCaClientId('')
      await loadClientAccess()
      if (result.emailSent) {
        showToast(`✓ גישה נוספה ל-${result.clientName} (${result.projectCount} פרויקטים) — קישור נשלח במייל`)
      } else {
        const link = result.magicLink || ''
        if (link) {
          navigator.clipboard?.writeText(link).catch(() => {})
          showToast('⚠️ המייל לא נשלח. קישור הועתק ללוח — שלח ללקוח ידנית.')
        } else {
          showToast('✓ גישה נוספה — אך שליחת המייל נכשלה: ' + (result.emailError || 'שגיאה לא ידועה'))
        }
      }
    } else {
      const err = await res.json()
      showToast('שגיאה: ' + (err.error || 'unknown'))
    }
  }

  const deleteClientAccess = async (email, clientId) => {
    const clientName = clients.find(c => c.id === clientId)?.name || clientId
    if (!confirm(`למחוק את כל הגישות של ${email} ל-${clientName}?`)) return
    // Find all row IDs for this email+client combo
    const toDelete = clientAccessList.filter(ca =>
      ca.email === email && ca.projects?.client_id === clientId
    )
    await Promise.all(toDelete.map(ca =>
      fetch('/api/client-access?id=' + ca.id, { method: 'DELETE', headers: { 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' } })
    ))
    setClientAccessList(prev => prev.filter(x => !toDelete.some(d => d.id === x.id)))
    showToast(`✓ גישה נמחקה (${toDelete.length} פרויקטים)`)
  }

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
    if (preset === 'last14') { const end = new Date(today); end.setDate(end.getDate()-1); const start = new Date(today); start.setDate(start.getDate()-14); const s = toYMD(start), e = toYMD(end); return { payload: { since: s, until: e }, key: s + '_' + e }; }
    const y = today.getFullYear()
    if (preset === 'q1') { const s = toYMD(new Date(y,0,1)), e = toYMD(new Date(y,2,31)); return { payload: { since: s, until: e }, key: s+'_'+e }; }
    if (preset === 'q2') { const s = toYMD(new Date(y,3,1)), e = toYMD(new Date(y,5,30)); return { payload: { since: s, until: e }, key: s+'_'+e }; }
    if (preset === 'q3') { const s = toYMD(new Date(y,6,1)), e = toYMD(new Date(y,8,30)); return { payload: { since: s, until: e }, key: s+'_'+e }; }
    if (preset === 'q4') { const s = toYMD(new Date(y,9,1)), e = toYMD(new Date(y,11,31)); return { payload: { since: s, until: e }, key: s+'_'+e }; }
    return null;
  };

  // Internal: call Meta + Google + BMBY in PARALLEL (whichever are needed).
  // Saves 10s on first-time fetches vs the previous sequential meta+google-then-bmby flow.
  const performLiveFetch = async (payload, isBackground, needed) => {
    const { fb = true, gg = true, crm = true } = needed || {};
    if (!isBackground) {
      setRefreshing(true);
      setRefreshStartTime(Date.now());
      setRefreshElapsed(0);
    }
    if (selectedProject && !payload.projectId) payload = { ...payload, projectId: selectedProject.id };
    const headers = { 'Content-Type': 'application/json', 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' };
    const callList = [];
    if (fb)  callList.push({ key: 'fb',  url: '/api/meta/fetch' });
    if (gg)  callList.push({ key: 'gg',  url: '/api/google/fetch' });
    if (crm) callList.push({ key: 'crm', url: '/api/bmby/fetch' });
    if (callList.length === 0) {
      if (!isBackground) setRefreshing(false);
      return true;
    }
    let metaOk = false, googleOk = false, crmOk = false;
    try {
      const results = await Promise.allSettled(
        callList.map(c => fetch(c.url, { method: 'POST', headers, body: JSON.stringify(payload) }).then(r => r.json()))
      );
      callList.forEach((c, i) => {
        const r = results[i];
        const ok = r.status === 'fulfilled' && r.value && r.value.ok;
        if (c.key === 'fb')  metaOk = ok;
        if (c.key === 'gg')  googleOk = ok;
        if (c.key === 'crm') crmOk = ok;
      });
      if (metaOk) setLastMetaSync(new Date());
      if (googleOk) setLastGoogleSync(new Date());
      if (!isBackground) {
        const parts = [];
        if (fb)  parts.push((metaOk ? '\u2713' : '\u00d7') + ' Facebook');
        if (gg)  parts.push((googleOk ? '\u2713' : '\u00d7') + ' Google');
        if (crm) parts.push((crmOk ? '\u2713' : '\u00d7') + ' CRM');
        showToast(parts.join('  |  '));
      } else if (metaOk || googleOk || crmOk) {
        showToast('\u2713 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05e2\u05d5\u05d3\u05db\u05e0\u05d5 \u05d1\u05e8\u05e7\u05e2');  // "נתונים עודכנו ברקע"
      }
      await loadClients();
      if (selectedProject) await loadProjectReports(selectedProject.id);
    } catch (err) {
      if (!isBackground) showToast('\u05e9\u05d2\u05d9\u05d0\u05d4: ' + (err.message || err));
    } finally {
      if (!isBackground) {
        setRefreshing(false);
        setRefreshStartTime(null);
      }
    }
    return metaOk || googleOk || crmOk;
  };

  const triggerFetch = async (payload) => {
    if (refreshing) return false;

    // Compute the cache key the same way presetToPayload + applyCustomRange do
    const targetKey = payload.month || (payload.since + '_' + payload.until);

    // What do we already have cached in 'reports' for this period?
    const haveFb = reports.some(r => r.month === targetKey && r.source === 'facebook');
    const GOOGLE_SCHEMA_VERSION = 2;  // keep in sync with google route.js
    const haveGoog = reports.some(r => r.month === targetKey && r.source && r.source.startsWith('google') && (r.summary?.schemaVersion || 0) >= GOOGLE_SCHEMA_VERSION);
    const CRM_SCHEMA_VERSION = 5;  // keep in sync with route.js + useEffect below
    const crmRow = reports.find(r => r.month === targetKey && r.source === 'crm');
    const haveCrm = !!crmRow && (crmRow.summary?.schemaVersion || 0) >= CRM_SCHEMA_VERSION;
    const haveAll = haveFb && haveGoog && haveCrm;

    // Is this an "open" period (today still updating) or a closed/finalized one?
    const today = new Date().toISOString().slice(0, 10);
    const currentYM = today.slice(0, 7);
    let isOpen = true;  // default to assume open if we can't tell
    if (payload.month) isOpen = payload.month >= currentYM;
    else if (payload.until) isOpen = payload.until >= today;

    // Closed period with full cache: instant render, never re-fetch (data is final).
    if (haveAll && !isOpen) {
      showToast('\u2713 \u05de\u05d8\u05de\u05d5\u05df - \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05e1\u05d5\u05e4\u05d9\u05d9\u05dd');  // "מטמון - נתונים סופיים"
      return true;
    }

    // Open period with full cache: render now, refresh all 3 in background.
    if (haveAll && isOpen) {
      showToast('\u2713 \u05de\u05d5\u05e6\u05d2 \u05de\u05de\u05d8\u05de\u05d5\u05df, \u05de\u05ea\u05e2\u05d3\u05db\u05df \u05d1\u05e8\u05e7\u05e2...');  // "מוצג ממטמון, מתעדכן ברקע"
      performLiveFetch(payload, true, { fb: true, gg: true, crm: true });
      return true;
    }

    // Partial or missing cache: blocking fetch, but only fetch the sources we lack.
    return await performLiveFetch(payload, false, { fb: !haveFb, gg: !haveGoog, crm: !haveCrm });
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
    if (preset === 'custom') return; // UI shows custom date inputs - user must click הצג
    const r = presetToPayload(preset);
    if (!r) return;
    // Set the target selection BEFORE triggering fetch so loadProjectReports keeps it
    setSelectedMonth(r.key);
    const ok = await triggerFetch(r.payload);
    // Reaffirm in case loadProjectReports raced and reset it
    if (ok) setSelectedMonth(r.key);
  };

  const applyCustomRange = async (sinceParam, untilParam) => {
    const s = sinceParam || customSince;
    const u = untilParam || customUntil;
    if (!s || !u) return;
    if (sinceParam) { setCustomSince(sinceParam); setCustomUntil(untilParam); }
    const payload = { since: s, until: u };
    const targetKey = s + '_' + u;
    setSelectedMonth(targetKey);
    const ok = await triggerFetch(payload);
    if (ok) setSelectedMonth(targetKey);
  };

  const refreshFromBmby = async () => {
    if (refreshingCrm) return;
    setRefreshingCrm(true);
    showToast('\u05de\u05d5\u05e9\u05da \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05de-BMBY...');
    try {
      let payload = selectedMonth && !selectedMonth.includes('_')
        ? { month: selectedMonth }
        : selectedMonth
          ? { since: selectedMonth.split('_')[0], until: selectedMonth.split('_')[1] }
          : {};
      if (selectedProject) payload = { ...payload, projectId: selectedProject.id };
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
    const { data } = await supabase.from('clients').select('*, projects(id, name, is_demo)').order('created_at');
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

  const loadProjectTasks = async (projectId) => {
    const { data } = await supabase.from('vitas_tasks').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
    setVitasTasks(data || []);
  };

  const lockRecommendation = async (rec) => {
    if (!selectedProject || !rec || !rec.dedupKey) return;
    setLockingRecKey(rec.dedupKey);
    try {
      // Build a baseline_value: prefer the most representative numeric (conv/rate/share/count)
      const b = rec.baseline || {};
      const baselineValue = Number(b.conv || b.rate || b.share || b.slowestMin || b.fastestMin || b.count || b.leads || b.avgCpl || 0);
      const description = (rec.body || []).join('\n\n') + (rec.suggestion ? '\n\nהמלצה: ' + rec.suggestion : '');
      const res = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' },
        body: JSON.stringify({
          projectId: selectedProject.id,
          role: rec.role,
          title: rec.title,
          description,
          recommendationKey: rec.dedupKey,
          metricType: (rec.baseline && rec.baseline.metric) || rec.type,
          baselineValue,
          baselineMetadata: {
            baseline: rec.baseline || {},
            target: rec.target || {},
            icon: rec.icon,
            type: rec.type,
            predictionValue: rec.prediction && rec.prediction.value,
            predictionDetail: rec.prediction && rec.prediction.detail,
          },
        }),
      });
      const json = await res.json();
      if (res.status === 409) {
        showToast('המלצה זו כבר נמצאת בתוכנית');
      } else if (!res.ok) {
        showToast('שגיאה: ' + (json.error || 'unknown'));
      } else {
        showToast('✓ ננעל בתוכנית · מדידה תופיע בעוד 28 ימים');
        setRecSubTab('pipeline');
      }
      await loadProjectTasks(selectedProject.id);
    } catch (err) {
      showToast('שגיאה: ' + (err.message || err));
    } finally {
      setLockingRecKey('');
    }
  };

  const updateTaskStatus = async (taskId, status) => {
    if (!selectedProject || !taskId) return;
    try {
      const res = await fetch('/api/tasks/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' },
        body: JSON.stringify({ taskId, status }),
      });
      const json = await res.json();
      if (!res.ok) { showToast('שגיאה: ' + (json.error || 'unknown')); return; }
      const labelMap = { pending: 'ממתינה', in_progress: 'בעבודה', done: 'הושלמה', dropped: 'נדחתה' };
      showToast('✓ משימה ' + (labelMap[status] || ''));
      await loadProjectTasks(selectedProject.id);
    } catch (err) {
      showToast('שגיאה: ' + (err.message || err));
    }
  };

  const createMetaRule = async (ruleType, params, recommendationKey) => {
    if (!selectedProject) return;
    setCreatingRule(true);
    try {
      const res = await fetch('/api/meta/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-key': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' },
        body: JSON.stringify({
          projectName: selectedProject.name,
          ruleType,
          params,
          recommendationKey,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const metaErr = json?.meta_error?.message || json?.error || 'unknown error';
        showToast('שגיאה ב-Meta: ' + metaErr);
        return false;
      }
      showToast(`✓ הכלל "${json.ruleName}" נוצר ב-Meta`);
      setRuleDialog(null);
      return true;
    } catch (err) {
      showToast('שגיאת רשת: ' + (err.message || err));
      return false;
    } finally {
      setCreatingRule(false);
    }
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
    setVitasTasks([]); setRecSubTab('new');
    await loadProjectReports(project.id);
    await loadProjectTasks(project.id);
    // Log project selection for client view
    if (isClientView) {
      const sid = typeof window !== 'undefined' ? window.__vitasSessionId : null
      if (sid) {
        fetch('/api/client-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'project_select', sessionId: sid, projectName: project.name })
        }).catch(() => {})
      }
    }
  };

  // ── CLIENT VIEW: auto-select first allowed project when clients load ──
  useEffect(() => {
    if (!isClientView || !allowedProjectIds || !clients.length || selectedProject) return;
    const filtered = clients
      .map(c => ({ ...c, projects: (c.projects || []).filter(p => allowedProjectIds.includes(p.id)) }))
      .filter(c => c.projects.length > 0);
    if (filtered.length > 0 && filtered[0].projects.length > 0) {
      selectProject(filtered[0], filtered[0].projects[0]);
    }
  }, [clients, isClientView]); // eslint-disable-line

  // Tick elapsed time every 500ms while refresh is active (for the banner timer)
  useEffect(() => {
    if (!refreshStartTime) return;
    const interval = setInterval(() => {
      setRefreshElapsed(Math.floor((Date.now() - refreshStartTime) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [refreshStartTime]);

  // Auto-fetch any missing data sources when user picks a period.
  // Replaces the old manual refresh buttons - if Meta/Google/BMBY data is missing
  // for the selected period, fetch it automatically (with debounce).
  useEffect(() => {
    if (isClientView && activePreset !== 'custom') return; // client: cron covers presets; only fetch for custom ranges
    if (!selectedMonth || !selectedProject) return;
    if (refreshing || refreshingCrm) return;
    const hasMeta = reports.some(r => r.month === selectedMonth && r.source === 'facebook');
    const hasGoogle = reports.some(r => r.month === selectedMonth && r.source && r.source.startsWith('google'));
    const CRM_SCHEMA_VERSION = 5  // must match server-side route in api/bmby/fetch
    const crmRow = reports.find(r => r.month === selectedMonth && r.source === 'crm')
    const cachedCrmVersion = crmRow?.summary?.schemaVersion || 0
    const hasCrm = !!crmRow && cachedCrmVersion >= CRM_SCHEMA_VERSION;
    if (hasMeta && hasGoogle && hasCrm) return; // fully cached
    const tm = setTimeout(() => {
      // Unified: triggerFetch handles whichever sources are missing, in PARALLEL.
      // This replaces the previous sequential meta+google → then-bmby flow.
      const payload = selectedMonth.includes('_')
        ? { since: selectedMonth.split('_')[0], until: selectedMonth.split('_')[1] }
        : { month: selectedMonth };
      triggerFetch(payload);
    }, 800);
    return () => clearTimeout(tm);
  }, [selectedMonth, selectedProject?.id, reports.length]);

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
    const isDoughnut = type === 'doughnut' || type === 'pie';
    const enhancedDatasets = datasets.map(ds => isDoughnut
      ? { borderColor: '#FFFFFF', borderWidth: 3, hoverOffset: 8, ...ds }
      : { borderRadius: 4, ...ds });
    const tooltipCfg = {
      backgroundColor: '#0B0F1E', titleColor: '#FFFFFF', bodyColor: '#C9CEDC',
      borderColor: 'transparent', cornerRadius: 8, padding: 10,
      titleFont: { size: 12, weight: '700' }, bodyFont: { size: 12, weight: '500' },
      displayColors: true, boxPadding: 6, rtl: true, textDirection: 'rtl',
    };
    const legendCfg = {
      position: 'bottom', rtl: true, textDirection: 'rtl',
      labels: { boxWidth: 10, boxHeight: 10, padding: 14,
        font: { weight: '600', size: 11 }, usePointStyle: true,
        pointStyle: 'rectRounded', color: '#374151' }
    };
    const config = {
      type, data: { labels, datasets: enhancedDatasets },
      plugins: [arcLabelsPlugin],
      options: {
        responsive: true, maintainAspectRatio: false,
        ...(isDoughnut && { cutout: '62%' }),
        plugins: { legend: legendCfg, tooltip: tooltipCfg },
      }
    };
    if (!isDoughnut) {
      config.options.scales = scalesConfig || {
        y: { beginAtZero: true, position: 'right', grid: { color: '#F2F4F8' },
             ticks: { font: { size: 11 }, color: '#6B7280' } },
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#6B7280' } }
      };
    }
    const chart = new Chart(canvas, config);
    chartsRef.current.push(chart);
  };

  const renderCrmReportDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null;
    destroyCharts();

    const crmRows = reports.filter(r => r.month === selectedMonth && r.source === 'crm');
    const legacyRepRows = reports.filter(r => r.month === selectedMonth && r.source === 'crm_reports');
    let allRows = [];
    crmRows.forEach(r => { if (r.summary && Array.isArray(r.summary.crmRepRows)) allRows = allRows.concat(r.summary.crmRepRows); });
    legacyRepRows.forEach(r => { if (r.data) allRows = allRows.concat(r.data); });
    if (allRows.length === 0) return <div className="welcome-center"><div className="icon">{'\ud83d\udcad'}</div><h3>{'\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9 CRM \u05d3\u05d5\u05d7\u05d5\u05ea \u05dc\u05d7\u05d5\u05d3\u05e9 \u05d6\u05d4'}</h3></div>;
    const repData = aggregateCrmReportRows(allRows);

    const metricKey = cityMetric === 'meetings' ? 'meetings' : cityMetric === 'contracts' ? 'contracts' : 'leads';
    const metricLabel = cityMetric === 'meetings' ? 'פגישות' : cityMetric === 'contracts' ? 'חוזים' : 'לידים';

    // Top 10 cities sorted by selected metric
    const cityEntries = Object.entries(repData.cities)
      .filter(([n]) => n && n !== 'לא צוין')
      .sort((a, b) => (b[1][metricKey] || 0) - (a[1][metricKey] || 0))
      .slice(0, 10);
    const cityNames = cityEntries.map(([n]) => n);
    const cityCounts = cityEntries.map(([, c]) => c[metricKey] || 0);

    setTimeout(() => {
      destroyCharts();
      if (cityNames.length > 0) {
        createChart('crmRepCityChart', 'bar', cityNames, [{
          label: metricLabel, data: cityCounts,
          backgroundColor: COLORS.slice(0, cityNames.length),
          borderRadius: 6,
        }], {
          y: { beginAtZero: true, position: 'right' },
          indexAxis: 'y',
        });
      }
    }, 200);

    if (cityEntries.length === 0) {
      return <div className="welcome-center"><div className="icon">🏘️</div><h3>אין נתוני יישובים לתקופה זו</h3></div>;
    }

    return (
      <div className="section">
        <div className="section-head">
          <div className="ico emerald"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
          <h2>Top 10 יישובים</h2>
          <span className="sub">לפי {metricLabel}</span>
        </div>
        <div className="chart-grid" style={{gridTemplateColumns: '2fr 1fr'}}>
          <div className="chart-card">
            <div className="chart-container" style={{height: 400}}><canvas id="crmRepCityChart"></canvas></div>
            <div style={{display:'flex',justifyContent:'center',gap:6,padding:'10px 0 4px'}}>
              {[['leads','לידים',COLORS[0]],['meetings','פגישות',COLORS[1]],['contracts','חוזים',COLORS[2]]].map(([k,l,col]) => (
                <button key={k} onClick={() => setCityMetric(k)} style={{display:'flex',alignItems:'center',gap:5,fontSize:12,padding:'4px 12px',borderRadius:20,border: cityMetric === k ? `1.5px solid ${col}` : '1.5px solid var(--border)',background: cityMetric === k ? col + '18' : 'transparent',color: cityMetric === k ? col : 'var(--text-secondary)',cursor:'pointer',fontWeight: cityMetric === k ? 700 : 400,transition:'all 0.15s'}}>
                  <span style={{width:10,height:10,borderRadius:'50%',background: cityMetric === k ? col : 'var(--border)',display:'inline-block',flexShrink:0}}/>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="chart-card" style={{padding: '20px'}}>
            <ol style={{listStyle: 'none', padding: 0, margin: 0, fontSize: '15px'}}>
              {cityEntries.map(([name, cityData], i) => (
                <li key={name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',borderBottom: i < cityEntries.length-1 ? '1px solid var(--border)' : 'none'}}>
                  <span style={{display:'flex',alignItems:'center',gap:'10px'}}>
                    <span style={{display:'inline-block',width:24,height:24,borderRadius:'50%',background:COLORS[i] || 'var(--accent)',color:'#fff',fontSize:12,fontWeight:700,textAlign:'center',lineHeight:'24px'}}>{i + 1}</span>
                    <span style={{fontWeight: 600}}>{name}</span>
                  </span>
                  <span style={{color: 'var(--accent)', fontWeight: 700}}>{cityData[metricKey] || 0}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    );
  }, [selectedMonth, reports, cityMetric, setCityMetric]);

  // ==================== CRM RESPONSE TIME SUB-TAB ====================
  const renderCrmResponseDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null;
    destroyCharts();

    const crmRows = reports.filter(r => r.month === selectedMonth && r.source === 'crm');
    const crmNamedLeads = crmRows[0]?.summary?.namedLeads || null;
    const _crmRespLeads = crmNamedLeads?.all || crmNamedLeads;  // v5: namedLeads nested under .all
    let totalLids = 0, respondedCount = 0, noResponseCount = 0;
    const bucketsTotal = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 };
    const bucketsBusiness = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 }
    const bucketMeetingTotals = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 };
    const bucketMeetingWith = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 };
    const byUserMerged = {};
    const dowMerged = {};
    const bySourceMerged = {};
    for (const r of crmRows) {
      const rt = r.summary && r.summary.responseTimeStats;
      if (!rt) continue;
      totalLids += rt.totalLids || 0;
      respondedCount += rt.respondedCount || 0;
      noResponseCount += rt.noResponseCount || 0;
      for (const [k, v] of Object.entries(rt.buckets || {})) bucketsTotal[(k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k] = (bucketsTotal[(k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k] || 0) + v;
      const bBuckets = (rt.business && rt.business.buckets) || {};
      for (const [k, v] of Object.entries(bBuckets)) bucketsBusiness[(k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k] = (bucketsBusiness[(k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k] || 0) + v;
      const bRichBuckets = (rt.business && rt.business.bucketsWithMeeting) || {};
      for (const [k, v] of Object.entries(bRichBuckets)) {
        const key = (k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k;
        bucketMeetingTotals[key] = (bucketMeetingTotals[key] || 0) + (v.total || 0);
        bucketMeetingWith[key] = (bucketMeetingWith[key] || 0) + (v.withMeeting || 0);
      }
      // Day of week merge
      const dow = r.summary && r.summary.dayOfWeekStats;
      if (dow) {
        for (const k of Object.keys(dow)) {
          if (!dowMerged[k]) dowMerged[k] = { name: dow[k].name, leads: 0, scheduled: 0 };
          dowMerged[k].leads += dow[k].leads || 0;
          dowMerged[k].scheduled += dow[k].scheduled || 0;
        }
      }
      const bUser = (rt.business && rt.business.byUser) || {};
      const bSource = (rt.business && rt.business.bySource) || {};
      for (const [k, v] of Object.entries(rt.byUser || {})) {
        if (!byUserMerged[k]) byUserMerged[k] = { count: 0, sumMinutes: 0, sumBusinessMinutes: 0 };
        byUserMerged[k].count += v.count;
        byUserMerged[k].sumMinutes += v.avgMinutes * v.count;
        if (bUser[k]) byUserMerged[k].sumBusinessMinutes += bUser[k].avgMinutes * bUser[k].count;
      }
      for (const [k, v] of Object.entries(rt.bySource || {})) {
        if (!bySourceMerged[k]) bySourceMerged[k] = { count: 0, sumMinutes: 0, sumBusinessMinutes: 0 };
        bySourceMerged[k].count += v.count;
        bySourceMerged[k].sumMinutes += v.avgMinutes * v.count;
        if (bSource[k]) bySourceMerged[k].sumBusinessMinutes += bSource[k].avgMinutes * bSource[k].count;
      }
    }

    if (totalLids === 0) {
      return <div className="welcome-center"><div className="icon">⏱️</div><h3>אין נתוני זמני תגובה לתקופה זו</h3></div>;
    }

    const overallAvgMin = respondedCount > 0
      ? Math.round(Object.values(byUserMerged).reduce((s, v) => s + v.sumMinutes, 0) / respondedCount)
      : 0
    const overallBusinessMin = respondedCount > 0
      ? Math.round(Object.values(byUserMerged).reduce((s, v) => s + (v.sumBusinessMinutes || 0), 0) / respondedCount)
      : 0;

    const bucketLabels = ['0-15m', '15m-1h', '1h-4h', '4h-8h', '8h-1d', '1d-3d', '3d+'];
    const bucketHumanLabels = ['פחות מ-15 דק׳', '15 דק׳-שעה', '1-4 שעות', '4-8 שעות', '8-24 שעות', '1-3 ימים', 'יותר מ-3 ימים'];
    const bucketValues = bucketLabels.map(k => bucketsTotal[k] || 0);

    setTimeout(() => {
      destroyCharts();
      const bucketBusinessValues = bucketLabels.map(k => bucketsBusiness[k] || 0);
      const bucketMeetingValues = bucketLabels.map(k => bucketMeetingWith[k] || 0);
      const conversionRates = bucketLabels.map(k => {
        const tot = bucketMeetingTotals[k] || 0;
        return tot > 0 ? Math.round((bucketMeetingWith[k] || 0) / tot * 100) : 0;
      });
      createChart('responseBucketsChart', 'bar', bucketHumanLabels, [
        { label: 'מספר לידים', type: 'bar', data: bucketBusinessValues, backgroundColor: '#6366F1', borderRadius: 4, maxBarThickness: 38, yAxisID: 'y', order: 2 },
        { label: 'מתוכם - המירו לפגישה', type: 'bar', data: bucketMeetingValues, backgroundColor: '#10B981', borderRadius: 4, maxBarThickness: 38, yAxisID: 'y', order: 3 },
        { label: '% המרה לפגישה', type: 'line', data: conversionRates,
          borderColor: '#F59E0B', backgroundColor: '#F59E0B', tension: 0.35,
          borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6,
          pointBackgroundColor: '#F59E0B', pointBorderColor: '#FFFFFF', pointBorderWidth: 2,
          fill: false, yAxisID: 'y1', order: 1 },
      ], {
        x: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' } } },
        y: { beginAtZero: true, position: 'right', grid: { color: '#F2F4F8' },
             title: { display: true, text: 'מספר לידים', font: { size: 10.5, weight: '700' }, color: '#5E6478' } },
        y1: { beginAtZero: true, position: 'left', max: 100,
              title: { display: true, text: '% המרה', font: { size: 10.5, weight: '700' }, color: '#5E6478' },
              ticks: { callback: v => v + '%' }, grid: { drawOnChartArea: false } },
      });
    }, 200);

    // Day-of-week chart data prep
    const dowOrder = ['0','1','2','3','4','5','6'];
    const dowHasData = dowOrder.some(k => dowMerged[k] && dowMerged[k].leads > 0);
    if (dowHasData) {
      setTimeout(() => {
        const labels = dowOrder.map(k => (dowMerged[k] && dowMerged[k].name) || k);
        const leadsData = dowOrder.map(k => (dowMerged[k] && dowMerged[k].leads) || 0);
        const schedData = dowOrder.map(k => (dowMerged[k] && dowMerged[k].scheduled) || 0);
        const conv = dowOrder.map(k => {
          const ld = (dowMerged[k] && dowMerged[k].leads) || 0;
          const sc = (dowMerged[k] && dowMerged[k].scheduled) || 0;
          return ld > 0 ? Math.round(sc / ld * 100) : 0;
        });
        createChart('dowChart', 'bar', labels, [
          { label: 'לידים', type: 'bar', data: leadsData, backgroundColor: '#6366F1', borderRadius: 4, maxBarThickness: 32, yAxisID: 'y', order: 2 },
          { label: 'מתוכם - המירו לפגישה', type: 'bar', data: schedData, backgroundColor: '#10B981', borderRadius: 4, maxBarThickness: 32, yAxisID: 'y', order: 3 },
          { label: '% המרה לפגישה', type: 'line', data: conv,
            borderColor: '#F59E0B', backgroundColor: '#F59E0B', tension: 0.35,
            borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6,
            pointBackgroundColor: '#F59E0B', pointBorderColor: '#FFFFFF', pointBorderWidth: 2,
            fill: false, yAxisID: 'y1', order: 1 },
        ], {
          x: { grid: { display: false } },
          y: { beginAtZero: true, position: 'right', grid: { color: '#F2F4F8' },
               title: { display: true, text: 'כמות', font: { size: 10.5, weight: '700' }, color: '#5E6478' } },
          y1: { beginAtZero: true, position: 'left', max: 100,
                title: { display: true, text: '% המרה', font: { size: 10.5, weight: '700' }, color: '#5E6478' },
                ticks: { callback: v => v + '%' }, grid: { drawOnChartArea: false } },
        });
      }, 300);
    }

    const fmt = (mn) => {
      if (mn == null) return '-';
      if (mn < 1) return 'מיידי';
      if (mn < 60) return mn + ' דק׳';
      if (mn < 1440) return Math.floor(mn / 60) + ' ש׳ ' + (mn % 60) + ' דק׳';
      const d = Math.floor(mn / 1440);
      const h = Math.floor((mn % 1440) / 60);
      return d + ' ימים' + (h ? ' ' + h + ' ש׳' : '');
    };

    const userList = Object.entries(byUserMerged)
      .filter(([, v]) => v.count > 0)
      .map(([name, v]) => ({ name, count: v.count, avg: Math.round(v.sumMinutes / v.count), bizAvg: Math.round((v.sumBusinessMinutes || 0) / v.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const sourceList = Object.entries(bySourceMerged)
      .filter(([, v]) => v.count >= 3)
      .map(([name, v]) => ({ name, count: v.count, avg: Math.round(v.sumMinutes / v.count), bizAvg: Math.round((v.sumBusinessMinutes || 0) / v.count) }))
      .sort((a, b) => b.bizAvg - a.bizAvg)
      .slice(0, 10);

    return (
      <>
                <div className="kpi-tier primary" style={{gridTemplateColumns:'repeat(4,1fr)',marginBottom:'36px'}}>
          <div className="kpi-c indigo">
            <div className="ic-wrap">
              <div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
            </div>
            <div className="lbl">סה"כ לידים <InfoTip text="כמות הלידים החדשים (LID) שנכנסו ב-BMBY בתקופה הנבחרת. כל LID נספר פעם אחת - ספירה אחרי ניכוי כפילויות." /></div>
            <div className="val">{totalLids}</div>
          </div>
          <div className="kpi-c emerald">
            <div className="ic-wrap">
              <div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
            </div>
            <div className="lbl">קיבלו מענה <InfoTip text="לידים שאיש מכירות אנושי חזר אליהם (יצר משימה, שיחה, פעולה במערכת). תגובות אוטומטיות של BMBY (Update Info Lead) לא נספרות." /></div>
            <div className="val">{respondedCount}</div>
          </div>
          <div className="kpi-c terra">
            <div className="ic-wrap">
              <div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
            </div>
            <div className="lbl">זמן מענה ממוצע <InfoTip text="ממוצע הזמן שלוקח לאיש מכירות אנושי לחזור לליד חדש. מדידה בשעות עסקים בלבד - א-ה 09:00-19:00, שישי 09:00-13:00, ללא שבת וחגי ישראל." /></div>
            <div className="val">{fmt(overallBusinessMin)}</div>
          </div>
          <div className="kpi-c violet" style={_crmRespLeads?.noResponse?.length > 0 ? {cursor:'pointer'} : undefined} onClick={_crmRespLeads?.noResponse?.length > 0 ? () => setNamedLeadsModal({title: 'לידים בלי מענה', names: _crmRespLeads.noResponse}) : undefined}>
            <div className="ic-wrap">
              <div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>
            </div>
            <div className="lbl">בלי מענה <InfoTip text="לידים שאף איש מכירות אנושי לא חזר אליהם - או שרק BMBY השיב אוטומטית, או שלא נרשמה אף פעולה. דורש מעקב." /></div>
            <div className="val">{noResponseCount}</div>
          </div>
        </div>

        <div className="section">
          <div className="section-head"><div className="ico sky"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><h2>התפלגות זמני תגובה</h2><span className="sub">חלוקת לידים ל-7 דליי זמן</span></div>
          <div className="chart-card"><div className="chart-container" style={{height: 320}}><canvas id="responseBucketsChart"></canvas></div></div>
        </div>

        {dowHasData && (
          <div className="section">
            <div className="section-head"><div className="ico violet"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><h2>פילוח לפי יום בשבוע</h2><span className="sub">לידים ו-% המרה לפי יום</span></div>
            <div className="chart-card"><div className="chart-container" style={{height: 320}}><canvas id="dowChart"></canvas></div></div>
          </div>
        )}

        <div className="chart-grid" style={{gridTemplateColumns: '1fr 1fr'}}>
          <div className="section">
            <div className="section-head"><div className="ico amber"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><h2>זמן מענה לפי איש מכירות</h2></div>
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
            <div className="section-head"><div className="ico sky"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="2" y1="20" x2="2" y2="14"/><line x1="7" y1="20" x2="7" y2="8"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="17" y1="20" x2="17" y2="10"/><line x1="22" y1="20" x2="22" y2="2"/></svg></div><h2>הכי איטיים - לפי מקור</h2></div>
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
    );
  }, [selectedMonth, reports]);

    // ==================== CRM OBJECTIONS SUB-TAB ====================
  const renderCrmObjectionsDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null;
    destroyCharts();

    const crmRows = reports.filter(r => r.month === selectedMonth && r.source === 'crm');
    let allRows = [];
    crmRows.forEach(r => { if (r.summary && Array.isArray(r.summary.crmRepRows)) allRows = allRows.concat(r.summary.crmRepRows); });

    const objCounts = {};
    let rowsWithObjection = 0;
    for (const row of allRows) {
      const objs = normalizeObjections(row.objections || '');
      if (objs.length > 0) rowsWithObjection++;
      for (const o of objs) objCounts[o] = (objCounts[o] || 0) + 1;
    }

    const objEntries = Object.entries(objCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const total = objEntries.reduce((s, [, c]) => s + c, 0);

    if (objEntries.length === 0) {
      return <div className="welcome-center"><div className="icon">🚫</div><h3>אין נתוני התנגדויות לתקופה זו</h3></div>;
    }

    const topNames = objEntries.map(([n]) => n);
    const topCounts = objEntries.map(([, c]) => c);

    setTimeout(() => {
      destroyCharts();
      createChart('crmObjChart', 'doughnut', topNames, [{
        data: topCounts,
        backgroundColor: COLORS.slice(0, topNames.length),
      }]);
    }, 200);

    return (
      <div className="section">
        <div className="section-head"><div className="ico rose"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><h2>התנגדויות לידים</h2></div>
        <div className="chart-grid" style={{gridTemplateColumns: '1fr 1fr'}}>
          <div className="chart-card"><div className="chart-container" style={{height: 400}}><canvas id="crmObjChart"></canvas></div></div>
          <div className="chart-card" style={{padding: '20px'}}>
            <ol style={{listStyle: 'none', padding: 0, margin: 0, fontSize: '14px'}}>
              {objEntries.map(([name, count], i) => {
                const pct = total > 0 ? (count / total * 100) : 0;
                return (
                  <li key={name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',borderBottom: i < objEntries.length-1 ? '1px solid var(--border)' : 'none'}}>
                    <span style={{display:'flex',alignItems:'center',gap:'10px'}}>
                      <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:24,height:24,borderRadius:'50%',background:COLORS[i] || 'var(--accent)',color:'#fff',fontSize:12,fontWeight:700,flexShrink:0}}>{i + 1}</span>
                      <span style={{fontWeight: 600}}>{name}</span>
                    </span>
                    <span style={{color: 'var(--accent)', fontWeight: 700}}>{count} <span style={{color:'#888',fontWeight:400,fontSize:12}}>({pct.toFixed(0)}%)</span></span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        {/* MOBILE: top-5 objections as cards. Desktop hides this via CSS. */}
        <ul className="objections-mobile objections-dup">
          {objEntries.slice(0, 5).map(([name, count], i) => {
            const pct = total > 0 ? (count / total * 100) : 0;
            const rankColors = ['rank-rose','rank-violet','rank-indigo','rank-emerald','rank-amber'];
            return (
              <li key={name}>
                <div className={`rank ${rankColors[i] || 'rank-rose'}`}>{i + 1}</div>
                <div className="lbl">{name}</div>
                <div className="count"><span className="pct">{pct.toFixed(0)}%</span>{count}</div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }, [selectedMonth, reports]);

    const renderCrmDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null;
    destroyCharts();

    const crmReports = reports.filter(r => r.month === selectedMonth && r.source === 'crm');
    const crmRepCount = reports.filter(r => r.month === selectedMonth && (r.source === 'crm_reports' || (r.source === 'crm' && r.summary && Array.isArray(r.summary.crmRepRows) && r.summary.crmRepRows.length > 0))).length;
    if (crmReports.length === 0) {
      const isCustomRange = selectedMonth && selectedMonth.includes('_');
      return (
        <div className="welcome-center" style={{padding:'40px 20px',textAlign:'center'}}>
          <div className="icon" style={{fontSize:'3em',marginBottom:'10px'}}>{refreshingCrm ? '⏳' : '💭'}</div>
          {refreshingCrm ? (
            <>
              <h3>{'מושך נתוני CRM מ- BMBY...'}</h3>
              <p style={{color:'#64748b',marginTop:'8px'}}>{'זה לוקח כ-25 שניות לטווח התאריכים הזה'}</p>
            </>
          ) : (
            <>
              <h3>{'אין נתוני CRM לתקופה זו'}</h3>
              <p style={{color:'#64748b',marginTop:'8px'}}>{isCustomRange ? 'טווח מותאם אישי דורש משיכת נתונים חדשה' : 'לחץ על הכפתור כדי למשוך נתונים'}</p>
              <button className="btn btn-primary" style={{marginTop:'16px'}} onClick={refreshFromBmby}>{'🔄 משוך נתונים מ-BMBY'}</button>
            </>
          )}
        </div>
      );
    }

    let allCrmRows = [];
    crmReports.forEach(r => { if (r.data) allCrmRows = allCrmRows.concat(r.data); });
    const crmData = aggregateCrmRows(allCrmRows);
    const crmNamedLeads = crmReports[0]?.summary?.namedLeads || null;
    const _crmLeads = crmNamedLeads?.all || crmNamedLeads;  // v5: namedLeads nested under .all

    // Merge Facebook campaign sources into single 'Facebook' entry - children kept for drill-down
    const _fbCrmKeys = Object.keys(crmData.sources).filter(k => k.includes('פייסבוק') || k.toLowerCase().includes('facebook'));
    if (_fbCrmKeys.length > 0) {
      const _fbMerged = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0, children: [] };
      _fbCrmKeys.forEach(k => { Object.keys(_fbMerged).forEach(f => { if (f === 'children') return; _fbMerged[f] += crmData.sources[k][f] || 0; }); _fbMerged.children.push({ name: k, ...crmData.sources[k] }); delete crmData.sources[k]; });
      crmData.sources['Facebook'] = _fbMerged;
    }
    // Merge Google campaign sources into single 'Google' entry - children kept for drill-down
    const _gCrmKeys = Object.keys(crmData.sources).filter(k => k.includes('גוגל') || k.toLowerCase().includes('google'));
    if (_gCrmKeys.length > 0) {
      const _gMerged = { totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0, registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0, children: [] };
      _gCrmKeys.forEach(k => { Object.keys(_gMerged).forEach(f => { if (f === 'children') return; _gMerged[f] += crmData.sources[k][f] || 0; }); _gMerged.children.push({ name: k, ...crmData.sources[k] }); delete crmData.sources[k]; });
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
        crmData.sources['Facebook'].totalLeads = _fbLeads;
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
        crmData.sources['Google'].totalLeads = _gLeads;
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

    const crmKpi = (label, value, color, current, prev, isCost, tip, namesArr) => {
      const ch = (prev != null && prev !== 0) ? changePercent(current, prev, isCost)
        : (prev === 0 && current > 0) ? { pct: null, isGood: !isCost, newVal: true }
        : null;
      const sl = String(label);
      const iconPaths =
        sl.includes('\u05e1\u05d4') ? <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></> :
        sl.includes('\u05ea\u05d5\u05d0\u05de') ? <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="8 15 11 18 16 13"/></> :
        sl.includes('\u05d1\u05d5\u05e6\u05e2') ? <path d="M11 17l2 2a1 1 0 0 0 1.42 0l4.16-4.16a2 2 0 0 0 0-2.84L15 8h-3a2 2 0 0 0-1.42.59L9 10"/> :
        sl.includes('\u05d1\u05d5\u05d8\u05dc') ? <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></> :
        sl.includes('\u05dc\u05d0 \u05e8') ? <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></> :
        sl.includes('\u05e8\u05dc\u05d5\u05d5') ? <polyline points="20 6 9 17 4 12"/> :
        sl.includes('\u05d4\u05e8\u05e9\u05de') ? <><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></> :
        sl.includes('\u05d7\u05d5\u05d6') ? <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></> :
        sl.includes('\u05e9\u05d5\u05d5\u05d9') ? <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/> :
        sl.includes('\u05e2\u05dc\u05d5\u05ea') ? <><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></> :
        (sl.includes('%') || sl.includes('\u05d0\u05d7\u05d5\u05d6')) ? <><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></> :
        <><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="9"/></>;
      const crmV2Color = { green:'emerald', orange:'terra', pink:'rose', purple:'violet', cyan:'sky', red:'amber', '':'indigo' };
      const v2cls = crmV2Color[color] || 'indigo';
      const _hasNames = namesArr && namesArr.length > 0;
      return (
        <div className={`kpi ${v2cls}`} key={label} style={_hasNames ? {cursor:'pointer'} : undefined} onClick={_hasNames ? () => setNamedLeadsModal({title: label, names: namesArr}) : undefined}>
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {iconPaths}
              </svg>
            </div>
            {ch ? (() => {
              if (ch.newVal) {
                const absDelta = isCost ? formatCurrency(current) : formatNum(Math.round(current));
                return <span className="kpi-trend">↑ +{absDelta} (חדש)</span>;
              }
              const delta = current - prev;
              const absDelta = isCost ? formatCurrency(Math.abs(delta)) : formatNum(Math.abs(Math.round(delta)));
              const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
              const arrow = ch.pct > 0 ? '\u2191' : ch.pct < 0 ? '\u2193' : '\u2212';
              const pctStr = Math.abs(ch.pct).toFixed(0) + '%';
              return (
                <span className={`kpi-trend${ch.pct === 0 ? ' flat' : ''}`}>
                  {arrow} {sign}{absDelta} ({ch.pct === 0 ? '0%' : (ch.pct > 0 ? '+' : '-') + pctStr})
                </span>
              );
            })() : null}
          </div>
          <div className="kpi-label">{label}{tip ? <InfoTip text={tip} /> : null}</div>
          <div className="kpi-value">{value}</div>
          <div className="kpi-spark" style={{height:28,marginTop:'auto'}}/>
        </div>
      );
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

    const crmSchemaVersion = crmReports[0]?.summary?.schemaVersion || 0;
    return (
      <>
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
          <button onClick={refreshFromBmby} disabled={refreshingCrm} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--text-secondary)',background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'4px 10px',cursor:refreshingCrm ? 'wait' : 'pointer',opacity: refreshingCrm ? 0.6 : 1}}>
            {refreshingCrm ? '⏳' : '🔄'} {refreshingCrm ? 'מושך...' : 'רענן CRM'}
            {!refreshingCrm && crmSchemaVersion > 0 && <span style={{fontSize:10,color:'var(--text-muted)',marginRight:2}}>v{crmSchemaVersion}</span>}
          </button>
        </div>
        <div className="kpi-grid">
          {crmKpi('\u05e1\u05d4"\u05db \u05dc\u05d9\u05d3\u05d9\u05dd', formatNum(ct.totalLeads), 'cyan', ct.totalLeads, cp?.totalLeads)}
          {crmKpi('\u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd', formatNum(ct.relevantLeads), 'green', ct.relevantLeads, cp?.relevantLeads)}
          {crmKpi('\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05ea\u05d5\u05d0\u05de\u05d5', formatNum(ct.meetingsScheduled), 'purple', ct.meetingsScheduled, cp?.meetingsScheduled, false, '\u05de\u05e1\u05e4\u05e8 \u05d4\u05dc\u05d9\u05d3\u05d9\u05dd \u05e9\u05e7\u05d1\u05e2\u05d5 \u05e4\u05d2\u05d9\u05e9\u05d4', _crmLeads?.meetingsScheduled)}
          {crmKpi('\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05d1\u05d5\u05e6\u05e2\u05d5', formatNum(ct.meetingsCompleted), 'orange', ct.meetingsCompleted, cp?.meetingsCompleted, false, '\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05e9\u05d4\u05ea\u05e7\u05d9\u05d9\u05de\u05d5 \u05d1\u05e4\u05d5\u05e2\u05dc', _crmLeads?.meetingsCompleted)}
          {crmKpi('\u05d4\u05e8\u05e9\u05de\u05d5\u05ea', formatNum(ct.registrations), 'green', ct.registrations, cp?.registrations, false, null, _crmLeads?.registrations)}
          {crmKpi('\u05d7\u05d5\u05d6\u05d9\u05dd', formatNum(ct.contracts), 'pink', ct.contracts, cp?.contracts, false, null, _crmLeads?.contracts)}
          {_platformSpend > 0 ? crmKpi('סה"כ תקציב', formatCurrency(_platformSpend), 'cyan', _platformSpend, null, true) : null}
          {ct.meetingsCompleted > 0 && _platformSpend > 0 ? crmKpi('עלות לפגישה שבוצעה', formatCurrency(_platformSpend / ct.meetingsCompleted), 'purple', _platformSpend / ct.meetingsCompleted, null, true) : null}
          {ct.contracts > 0 && _platformSpend > 0 ? crmKpi('עלות לחוזה', formatCurrency(_platformSpend / ct.contracts), 'red', _platformSpend / ct.contracts, null, true) : null}
          {(ct.contractValue || 0) > 0 ? crmKpi('שווי חוזים', formatCurrencyCompact(ct.contractValue), 'green', ct.contractValue, cp?.contractValue || null) : null}
        </div>


        {/* CRM Funnel */}
        <div className="section">
          <div className="section-head"><div className="ico sky"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div><h2>{'\u05de\u05e9\u05e4\u05da \u05dc\u05d9\u05d3\u05d9\u05dd'}</h2><span className="sub">{'\u05de\u05dc\u05d9\u05d3 \u05d5\u05e2\u05d3 \u05d7\u05d5\u05d6\u05d4'}</span></div>
          <div className="crm-funnel">
            <div className="crm-fstep sky">
              <div className="v">{formatNum(ct.totalLeads)}</div>
              <div className="l">{'\u05e1\u05d4"\u05db \u05dc\u05d9\u05d3\u05d9\u05dd'}</div>
              <div className="pct">100%</div>
              {compareEnabled && cp ? (() => { const _c=ct.totalLeads; const _p=(cp.totalLeads)||0; const d=_c-_p; if(_p===0&&_c===0)return null; const pStr=_p>0?('('+(d>0?'+':'')+Math.abs(d/_p*100).toFixed(0)+'%)'):d>0?'(חדש)':null; if(!pStr&&d===0)return null; const arrow=d>0?"↑":d<0?"↓":"−"; const sign=d>0?"+":d<0?"-":""; return <span className="kpi-trend" style={{fontSize:9,padding:"2px 5px",marginTop:3}}>{arrow} {sign}{formatNum(Math.abs(Math.round(d)))} {pStr||""}</span>; })() : null}
            </div>
            <div className="crm-farrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
            <div className="crm-fstep">
              <div className="v">{formatNum(ct.relevantLeads)}</div>
              <div className="l">{'\u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9\u05d9\u05dd'}</div>
              <div className="pct">{ct.totalLeads > 0 ? ct.relevantRate.toFixed(0) + '%' : '-'}</div>
              {compareEnabled && cp ? (() => { const _c=ct.relevantLeads; const _p=(cp.relevantLeads)||0; const d=_c-_p; if(_p===0&&_c===0)return null; const pStr=_p>0?('('+(d>0?'+':'')+Math.abs(d/_p*100).toFixed(0)+'%)'):d>0?'(חדש)':null; if(!pStr&&d===0)return null; const arrow=d>0?"↑":d<0?"↓":"−"; const sign=d>0?"+":d<0?"-":""; return <span className="kpi-trend" style={{fontSize:9,padding:"2px 5px",marginTop:3}}>{arrow} {sign}{formatNum(Math.abs(Math.round(d)))} {pStr||""}</span>; })() : null}
            </div>
            <div className="crm-farrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
            <div className="crm-fstep terra">
              <div className="v">{formatNum(ct.meetingsScheduled)}</div>
              <div className="l">{'\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05ea\u05d5\u05d0\u05de\u05d5'}</div>
              <div className="pct">{ct.totalLeads > 0 ? ct.scheduledRate.toFixed(0) + '%' : '-'}</div>
              {compareEnabled && cp ? (() => { const _c=ct.meetingsScheduled; const _p=(cp.meetingsScheduled)||0; const d=_c-_p; if(_p===0&&_c===0)return null; const pStr=_p>0?('('+(d>0?'+':'')+Math.abs(d/_p*100).toFixed(0)+'%)'):d>0?'(חדש)':null; if(!pStr&&d===0)return null; const arrow=d>0?"↑":d<0?"↓":"−"; const sign=d>0?"+":d<0?"-":""; return <span className="kpi-trend" style={{fontSize:9,padding:"2px 5px",marginTop:3}}>{arrow} {sign}{formatNum(Math.abs(Math.round(d)))} {pStr||""}</span>; })() : null}
            </div>
            <div className="crm-farrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
            <div className="crm-fstep emerald">
              <div className="v">{formatNum(ct.meetingsCompleted)}</div>
              <div className="l">{'\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05d1\u05d5\u05e6\u05e2\u05d5'}</div>
              <div className="pct">{ct.meetingsScheduled > 0 ? (ct.meetingsCompleted / ct.meetingsScheduled * 100).toFixed(0) + '%' : '-'}</div>
              {compareEnabled && cp ? (() => { const _c=ct.meetingsCompleted; const _p=(cp.meetingsCompleted)||0; const d=_c-_p; if(_p===0&&_c===0)return null; const pStr=_p>0?('('+(d>0?'+':'')+Math.abs(d/_p*100).toFixed(0)+'%)'):d>0?'(חדש)':null; if(!pStr&&d===0)return null; const arrow=d>0?"↑":d<0?"↓":"−"; const sign=d>0?"+":d<0?"-":""; return <span className="kpi-trend" style={{fontSize:9,padding:"2px 5px",marginTop:3}}>{arrow} {sign}{formatNum(Math.abs(Math.round(d)))} {pStr||""}</span>; })() : null}
            </div>
            <div className="crm-farrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
            <div className="crm-fstep amber">
              <div className="v">{formatNum(ct.registrations)}</div>
              <div className="l">{'\u05d4\u05e8\u05e9\u05de\u05d5\u05ea'}</div>
              <div className="pct">{ct.meetingsCompleted > 0 ? (ct.registrations / ct.meetingsCompleted * 100).toFixed(0) + '%' : '-'}</div>
              {compareEnabled && cp ? (() => { const _c=ct.registrations; const _p=(cp.registrations)||0; const d=_c-_p; if(_p===0&&_c===0)return null; const pStr=_p>0?('('+(d>0?'+':'')+Math.abs(d/_p*100).toFixed(0)+'%)'):d>0?'(חדש)':null; if(!pStr&&d===0)return null; const arrow=d>0?"↑":d<0?"↓":"−"; const sign=d>0?"+":d<0?"-":""; return <span className="kpi-trend" style={{fontSize:9,padding:"2px 5px",marginTop:3}}>{arrow} {sign}{formatNum(Math.abs(Math.round(d)))} {pStr||""}</span>; })() : null}
            </div>
            <div className="crm-farrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
            <div className="crm-fstep rose">
              <div className="v">{formatNum(ct.contracts)}</div>
              <div className="l">{'\u05d7\u05d5\u05d6\u05d9\u05dd'}</div>
              <div className="pct">{ct.registrations > 0 ? (ct.contracts / ct.registrations * 100).toFixed(0) + '%' : '-'}</div>
              {compareEnabled && cp ? (() => { const _c=ct.contracts; const _p=(cp.contracts)||0; const d=_c-_p; if(_p===0&&_c===0)return null; const pStr=_p>0?('('+(d>0?'+':'')+Math.abs(d/_p*100).toFixed(0)+'%)'):d>0?'(חדש)':null; if(!pStr&&d===0)return null; const arrow=d>0?"↑":d<0?"↓":"−"; const sign=d>0?"+":d<0?"-":""; return <span className="kpi-trend" style={{fontSize:9,padding:"2px 5px",marginTop:3}}>{arrow} {sign}{formatNum(Math.abs(Math.round(d)))} {pStr||""}</span>; })() : null}
            </div>
          </div>
        </div>

        {/* CRM Table by Source */}
        <div className="section">
          <div className="section-head"><div className="ico indigo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><h2>נתונים לפי מקור הגעה</h2><span className="sub"> <InfoTip text="פירוט לידים, רלוונטיים, פגישות וחוזים לפי מקור" /></span></div>
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
                  const children = Array.isArray(d.children) ? d.children : [];
                  const hasChildren = children.length > 0;
                  const isOpen = expandedCrmSources.has(name);
                  const toggle = () => setExpandedCrmSources(prev => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
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
                      const cSched = ch.totalLeads > 0 ? (ch.meetingsScheduled / ch.totalLeads * 100).toFixed(1) : '0.0';
                      const cComp  = ch.totalLeads > 0 ? (ch.meetingsCompleted / ch.totalLeads * 100).toFixed(1) : '0.0';
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
                        </tr>);
                    })}
                  </Fragment>);
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
          <div className="desktop-only-msg"><div className="icon">💻</div><div className="body">לצפייה בטבלאות המפורטות, פתח מהמחשב<span className="hint">הטבלאות המלאות זמינות בגרסת המחשב</span></div></div>
          {/* MOBILE: top-5 sources as cards */}
          <ul className="objections-mobile">
            {sourceEntries.slice(0, 5).map(([name, d], i) => {
              const rankColors = ['rank-indigo','rank-emerald','rank-violet','rank-amber','rank-sky'];
              return (
                <li key={name}>
                  <div className={`rank ${rankColors[i] || 'rank-indigo'}`}>{i + 1}</div>
                  <div className="lbl">{name}</div>
                  <div className="count">{d.totalLeads}<span className="pct" style={{marginRight:4,marginLeft:0}}> ליד</span></div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* CRM Charts */}
        <div className="section">
          <div className="section-head"><div className="ico emerald"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><h2>גרפים</h2></div>
          <div className="chart-grid" style={{gridTemplateColumns: '1fr'}}>
            <div className="chart-card"><h4>{'\u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05dc\u05d9\u05d3\u05d9\u05dd'}</h4><div className="chart-container"><canvas id="crmPieChart"></canvas></div></div>
          </div>
        </div>
      </>
    );
  }, [selectedMonth, compareEnabled, reports, expandedCrmSources]);

  const renderDashboard = useCallback(() => {
    if (!selectedMonth || reports.length === 0) return null;
    destroyCharts();

    const currentReports = reports.filter(r => r.month === selectedMonth);
    // If there are NO reports at all for this project, show the welcome screen.
    // If there are reports but not for this period, fall through - tabs will still show
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
          r.data.forEach(row => {
            // Skip rows whose source already counted via Meta/Google API (avoid double-counting in 'All' tab)
            const src = String(row.source || '').toLowerCase();
            if (/פייסבוק|facebook|fb\b|מטא/.test(src)) return;
            if (/גוגל|google|pmax|search|adwords/.test(src)) return;
            crmTotalLeads += (typeof row.totalLeads === 'number' ? row.totalLeads : parseFloat(String(row.totalLeads).replace(/[^0-9.\-]/g, '')) || 0);
          });
        }
      });
    }

    // Extract CRM totals for KPI display.
    // 'all' tab → unfiltered CRM totals.
    // FB/Google tabs → CRM rows filtered to platform-matching sources.
    let crmTotals = null;
    {
      const crmReps = currentReports.filter(r => r.source === 'crm');
      if (crmReps.length > 0) {
        let allCrmR = [];
        crmReps.forEach(r => { if (r.data) allCrmR = allCrmR.concat(r.data); });
        let filteredR = allCrmR;
        if (dashTab === 'facebook') {
          filteredR = allCrmR.filter(r => /פייסבוק|facebook/i.test(r.source || ''));
        } else if (dashTab === 'google' || dashTab === 'google_pmax' || dashTab === 'google_search') {
          filteredR = allCrmR.filter(r => /גוגל|google|pmax|search/i.test(r.source || ''));
        }
        if (filteredR.length > 0) crmTotals = aggregateCrmRows(filteredR).totals;
      }
    }

    const dashCrmNamedLeads = currentReports.find(r => r.source === 'crm')?.summary?.namedLeads || null;

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

    let prevCrmTotals = null;
    let prevCrmTotalLeads = 0;
    if (compareEnabled) {
      const prevMonth2 = getPrevMonth(selectedMonth);
      const prevCrmReps = reports.filter(r => r.month === prevMonth2 && r.source === 'crm');
      if (prevCrmReps.length > 0) {
        let allPrevCrm = [];
        prevCrmReps.forEach(r => { if (r.data) allPrevCrm = allPrevCrm.concat(r.data); });
        let filtPrev = allPrevCrm;
        if (dashTab === 'facebook') filtPrev = allPrevCrm.filter(r => /פייסבוק|facebook/i.test(r.source || ''));
        else if (dashTab === 'google' || dashTab === 'google_pmax' || dashTab === 'google_search') filtPrev = allPrevCrm.filter(r => /גוגל|google|pmax|search/i.test(r.source || ''));
        if (filtPrev.length > 0) prevCrmTotals = aggregateCrmRows(filtPrev).totals;
        // Compute CRM-only (non-ad) leads for prev period — mirrors crmTotalLeads logic
        if (dashTab === 'all') {
          allPrevCrm.forEach(row => {
            const src = String(row.source || '').toLowerCase();
            if (/פייסבוק|facebook|fb|מטא/.test(src)) return;
            if (/גוגל|google|pmax|search|adwords/.test(src)) return;
            prevCrmTotalLeads += (typeof row.totalLeads === 'number' ? row.totalLeads : parseFloat(String(row.totalLeads).replace(/[^0-9.\-]/g, '')) || 0);
          });
        }
      }
    }

    const allMonths = [...new Set(reports.map(r => r.month))].sort();
    const trendData = allMonths.map(m => {
      let mRows = [];
      reports.filter(r => r.month === m && r.source !== 'crm' && r.source !== 'crm_reports').forEach(r => { mRows = mRows.concat(r.data || []); });
      let crmMRows = [];
      reports.filter(r => r.month === m && r.source === 'crm').forEach(r => { if (r.data) crmMRows = crmMRows.concat(r.data); });
      const crmMT = crmMRows.length > 0 ? aggregateCrmRows(crmMRows).totals : null;
      return { month: m, ...aggregateRows(mRows).totals,
        meetingsScheduled: crmMT?.meetingsScheduled || 0,
        meetingsCompleted: crmMT?.meetingsCompleted || 0,
        registrations: crmMT?.registrations || 0,
        contracts: crmMT?.contracts || 0,
      };
    });

    const t = data.totals;
    const p = prevData?.totals;

    // v2 color map: old name → new class
    const v2Color = { green:'emerald', orange:'terra', pink:'rose', purple:'violet', cyan:'sky', red:'amber', '':'indigo' };

    // v2 KPI SVG icons (inline, no lucide dep)
    const kpiSvgIcon = (label) => {
      if (label === 'לידים')           return <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>;
      if (label === 'עלות לליד' || label === 'CPL') return <><circle cx="8" cy="8" r="5"/><path d="M14.5 12.5A5 5 0 1 1 20 18a5 5 0 0 1-5.5-5.5z"/></>; 
      if (label === 'תקציב')           return <><path d="M21 12V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/><path d="M21 12h-5a2 2 0 0 0 0 4h5"/></>;
      if (label === 'פגישות שתואמו')  return <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="8 15 11 18 16 13"/></>;
      if (label === 'פגישות שבוצעו')  return <><path d="M11 17l2 2a1 1 0 0 0 1.42 0l4.16-4.16a2 2 0 0 0 0-2.84L15 8h-3a2 2 0 0 0-1.42.59L9 10"/><path d="M16 16l-3.41-3.41a2 2 0 0 0-2.83 0L8 14.34a2 2 0 0 0 0 2.83L9.66 18.83a2 2 0 0 0 2.83 0L13 18.34"/></>;
      if (label === 'הרשמות')          return <><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></>;
      if (label === 'חוזים')           return <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 14c1.5 0 2-1 4-1s2.5 1 4 1 2-1 2-1"/><path d="M8 18h8"/></>;
      return <><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="9"/></>;
    };

    const kpi = (label, value, color, current, prev, isCost, namesArr) => {
      const ch = (prev != null && prev !== 0) ? changePercent(current, prev, isCost)
        : (prev === 0 && current > 0) ? { pct: null, isGood: !isCost, newVal: true }
        : null;
      const v2cls = v2Color[color] || 'indigo';
      // sparkline: extract this metric's values from trendData
      const metricKey = label === 'לידים' ? 'leads' : label === 'תקציב' ? 'spend' : label === 'עלות לליד' ? 'cpl' : label === 'פגישות שתואמו' ? 'meetingsScheduled' : label === 'פגישות שבוצעו' ? 'meetingsCompleted' : label === 'הרשמות' ? 'registrations' : label === 'חוזים' ? 'contracts' : null;
      const sparkVals = metricKey && trendData.length >= 2 ? trendData.map(d => d[metricKey] || 0) : null;
      const trendPct = ch ? (ch.pct > 0 ? '+' : '') + Math.abs(ch.pct).toFixed(0) + '%' : null;
      const _hasNames = namesArr && namesArr.length > 0;
      return (
        <div className={`kpi ${v2cls}`} key={label} style={_hasNames ? {cursor:'pointer'} : undefined} onClick={_hasNames ? () => setNamedLeadsModal({title: label, names: namesArr}) : undefined}>
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {kpiSvgIcon(label)}
              </svg>
            </div>
            {ch ? (() => {
              if (ch.newVal) {
                const absDelta = isCost ? formatCurrency(current) : formatNum(Math.round(current));
                return <span className="kpi-trend">↑ +{absDelta} (חדש)</span>;
              }
              const delta = current - prev;
              const absDelta = isCost ? formatCurrency(Math.abs(delta)) : formatNum(Math.abs(Math.round(delta)));
              const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
              const arrow = ch.pct > 0 ? '↑' : ch.pct < 0 ? '↓' : '−';
              const pctStr = Math.abs(ch.pct).toFixed(0) + '%';
              return (
                <span className={`kpi-trend${ch.pct === 0 ? ' flat' : ''}`}>
                  {arrow} {sign}{absDelta} ({ch.pct === 0 ? '0%' : (ch.pct > 0 ? '+' : '-') + pctStr})
                </span>
              );
            })() : null}
          </div>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value">{value}</div>
          {sparkVals ? <Sparkline values={sparkVals} /> : <div className="kpi-spark" style={{height:28,marginTop:'auto'}}/>}
        </div>
      );
    };

    const buildTable = (items, prevItems, labelName, tableId, source = '') => {
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
      const cellMark = (key, val) => { const e = extremes[key]; if (!e || val <= 0 || e.min === e.max) return null; const col = cols.find(c=>c.key===key); if (!col || col.higher === undefined) return null; if (val === e.max) return <span style={{fontSize:9,marginRight:2,opacity:0.75}}>{col.higher ? '\u25b2' : '\u25bc'}</span>; if (val === e.min) return <span style={{fontSize:9,marginRight:2,opacity:0.75}}>{col.higher ? '\u25bc' : '\u25b2'}</span>; return null; };
      const extremes = {};
      cols.forEach(c => { if (c.key === 'name' || c.key === 'spend') return; const vals = entries.map(([n,d]) => c.get(d,n)).filter(v => typeof v === 'number' && v > 0); if (vals.length < 2) return; extremes[c.key] = {min: Math.min(...vals), max: Math.max(...vals)}; });
      const cellBg = (key, val) => { const e = extremes[key]; if (!e || val <= 0 || e.min === e.max) return {}; const col = cols.find(c=>c.key===key); if (!col || col.higher === undefined) return {}; if (val === e.max) return col.higher ? {color:'#059669',fontWeight:800} : {color:'#dc2626',fontWeight:800}; if (val === e.min) return col.higher ? {color:'#dc2626',fontWeight:800} : {color:'#059669',fontWeight:800}; return {}; };
      return (<><div className="table-wrapper"><table className="data-table"><thead><tr>{cols.map(c=>(<th key={c.key} style={thStyle} onClick={()=>handleSort(tableId,c.key)}>{c.label}{sortIcon(c.key)}</th>))}</tr></thead><tbody>{entries.map(([name, d]) => { const cpl = d.leads > 0 ? d.spend / d.leads : 0; const cpc = d.clicks > 0 ? d.spend / d.clicks : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; const cplClass = cpl > 0 && cpl < 80 ? 'tag-green' : cpl < 120 ? 'tag-blue' : cpl < 150 ? 'tag-purple' : 'tag-red'; return (<tr key={name}><td style={{fontWeight: 600}}>{source ? <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'20px',height:'20px',borderRadius:'5px',background:source==='google'?'var(--rose-50)':'var(--sky-50)',color:source==='google'?'var(--rose)':'var(--sky)',fontWeight:800,fontSize:'11px',marginLeft:'6px',flexShrink:0}}>{source==='google'?'G':'F'}</span> : null}{name}{source ? <span className={`platform-tag${source==='google'?' google':''}`} style={{marginRight:'8px'}}>{source==='google'?'GOOGLE':'FACEBOOK'}</span> : null}</td><td style={cellBg('clicks',d.clicks)}>{cellMark('clicks',d.clicks)}{formatNum(d.clicks)} {ch(d.clicks, prevItems?.[name]?.clicks, false)}</td><td style={cellBg('impressions',d.impressions)}>{cellMark('impressions',d.impressions)}{formatNum(d.impressions)} {ch(d.impressions, prevItems?.[name]?.impressions, false)}</td><td style={cellBg('cpc',cpc)}>{cellMark('cpc',cpc)}{formatCurrency(cpc)} {ch(cpc, prevItems?.[name]?.clicks > 0 ? prevItems[name].spend/prevItems[name].clicks : null, true)}</td><td style={cellBg('ctr',ctr)}>{cellMark('ctr',ctr)}{ctr.toFixed(2)}%</td><td style={cellBg('cpm',cpm)}>{cellMark('cpm',cpm)}{formatCurrency(cpm)}</td><td style={cellBg('leads',d.leads)}>{cellMark('leads',d.leads)}{d.leads} {ch(d.leads, prevItems?.[name]?.leads, false)}</td><td style={cellBg('cpl',cpl)}><span className={`cpl-tag ${cplClass}`}>{formatCurrency(cpl)}</span></td><td>{formatCurrency(d.spend)} {ch(d.spend, prevItems?.[name]?.spend, true)}</td></tr>); })}</tbody></table></div>
          <div className="desktop-only-msg"><div className="icon">💻</div><div className="body">לצפייה בטבלאות המפורטות, פתח מהמחשב<span className="hint">הטבלאות המלאות זמינות בגרסת המחשב</span></div></div></>);
    };


    setTimeout(() => {
      destroyCharts();
      // monthly trend charts removed
      const campNames2 = Object.keys(data.campaigns);
      if (campNames2.length > 0) {
        createChart('campSpend', 'doughnut', campNames2, [{ data: campNames2.map(n => data.campaigns[n].spend), backgroundColor: COLORS.slice(0, campNames2.length) }]);
        createChart('campLeads', 'bar', campNames2, [
          { label: '\u05dc\u05d9\u05d3\u05d9\u05dd', data: campNames2.map(n => data.campaigns[n].leads),
            backgroundColor: '#10B981', maxBarThickness: 80, yAxisID: 'y', order: 2 },
          { label: 'CPL', data: campNames2.map(n => data.campaigns[n].leads > 0 ? data.campaigns[n].spend / data.campaigns[n].leads : 0),
            type: 'line', borderColor: '#F43F5E', backgroundColor: '#F43F5E',
            tension: 0.35, borderWidth: 2.5,
            pointRadius: 5, pointHoverRadius: 7,
            pointBackgroundColor: '#F43F5E', pointBorderColor: '#FFFFFF', pointBorderWidth: 2,
            yAxisID: 'y1', order: 1 }
        ], {
          x: { grid: { display: false }, ticks: { font: { size: 10.5, weight: '700' } } },
          y: { position: 'right', beginAtZero: true, grid: { color: '#F2F4F8' },
               title: { display: true, text: '\u05dc\u05d9\u05d3\u05d9\u05dd', font: { size: 10.5, weight: '700' }, color: '#5E6478' } },
          y1: { position: 'left', beginAtZero: true, grid: { drawOnChartArea: false },
                title: { display: true, text: '\u20aa CPL', font: { size: 10.5, weight: '700' }, color: '#5E6478' },
                ticks: { callback: v => '\u20aa' + Math.round(v) } }
        });
      }
      // gender doughnut charts removed (replaced by table)
      const an = Object.keys(data.ages).filter(a => a !== 'unknown').sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999));
      if (an.length > 0 && dashTab !== 'all' && dashTab !== 'facebook') {
        createChart('ageSpendLeads', 'bar', an, [
          { label: '\u05d4\u05d5\u05e6\u05d0\u05d4', data: an.map(a => data.ages[a].spend),
            backgroundColor: '#6366F1', maxBarThickness: 40, yAxisID: 'y', order: 2 },
          { label: '\u05dc\u05d9\u05d3\u05d9\u05dd', data: an.map(a => data.ages[a].leads),
            type: 'line', borderColor: '#10B981', backgroundColor: '#10B981',
            tension: 0.35, borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6,
            pointBackgroundColor: '#10B981', pointBorderColor: '#FFFFFF', pointBorderWidth: 2,
            yAxisID: 'y1', order: 1 }],
          { x: { grid: { display: false } },
            y: { position: 'right', beginAtZero: true, grid: { color: '#F2F4F8' },
                 title: { display: true, text: '\u05d4\u05d5\u05e6\u05d0\u05d4 (\u20aa)', font: { size: 10.5, weight: '700' }, color: '#5E6478' },
                 ticks: { callback: v => '\u20aa' + v.toLocaleString() } },
            y1: { position: 'left', beginAtZero: true, grid: { drawOnChartArea: false },
                  title: { display: true, text: '\u05dc\u05d9\u05d3\u05d9\u05dd', font: { size: 10.5, weight: '700' }, color: '#5E6478' } } });
        const ageCPLdata = an.map(a => data.ages[a].leads > 0 ? data.ages[a].spend / data.ages[a].leads : 0);
        const ageCPLcolors = ageCPLdata.map(v => v < 80 ? '#10b981' : v < 120 ? '#3b82f6' : v < 150 ? '#8b5cf6' : '#ef4444');
        const ageCPLbg = ageCPLdata.map(v => v < 80 ? 'rgba(16,185,129,0.15)' : v < 120 ? 'rgba(59,130,246,0.15)' : v < 150 ? 'rgba(139,92,246,0.15)' : 'rgba(239,68,68,0.15)');
        createChart('ageCPL', 'bar', an, [{ label: 'CPL (\u20aa)', data: ageCPLdata, backgroundColor: ageCPLbg, maxBarThickness: 48 }]);
        createChart('ageRates', 'bar', an, [
          { label: 'CTR %', data: an.map(a => data.ages[a].impressions > 0 ? (data.ages[a].clicks / data.ages[a].impressions * 100) : 0),
            backgroundColor: '#0EA5E9', maxBarThickness: 40 },
          { label: '\u05d0\u05d7\u05d5\u05d6 \u05d4\u05de\u05e8\u05d4 %',
            data: an.map(a => data.ages[a].clicks > 0 ? (data.ages[a].leads / data.ages[a].clicks * 100) : 0),
            backgroundColor: '#8B5CF6', maxBarThickness: 40 }]);
        createChart('ageCPM', 'bar', an, [{ label: 'CPM (\u20aa)', data: an.map(a => data.ages[a].impressions > 0 ? (data.ages[a].spend / data.ages[a].impressions * 1000) : 0), backgroundColor: '#F59E0B', maxBarThickness: 48 }]);
      }
    }, 200);

    const campNames = Object.keys(data.campaigns);
    const adEntries = Object.entries(data.ads).sort((a, b) => b[1].spend - a[1].spend).slice(0, 10);
    const genderNames = Object.keys(data.genders).filter(g => g !== 'unknown');
    const ageNames = Object.keys(data.ages).filter(a => a !== 'unknown');

    const fbReports = currentReports.filter(r => r.source === 'facebook');
    const gReports = currentReports.filter(r => r.source && r.source.startsWith('google'));
    const crmReports = currentReports.filter(r => r.source === 'crm');
    const crmRepReports = currentReports.filter(r =>
      r.source === 'crm_reports' || (r.source === 'crm' && r.summary && Array.isArray(r.summary.crmRepRows) && r.summary.crmRepRows.length > 0)
    );
    // Tab visibility - show if the project has ANY data of this source (any month).
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
    const activeP = p;

    // Total leads including CRM for "all" tab display
    const totalLeadsWithCrm = dashTab === 'all' ? t.leads + crmTotalLeads : activeT.leads;

    return (
      <>
        {/* Source Tabs */}
        <div className="client-tabs">
          <button className={`client-tab ${dashTab === 'all' ? 'active' : ''}`} onClick={() => setDashTab('all')}>{'\u05d4\u05db\u05dc'}</button>
          {hasCrm && <button className={`client-tab ${dashTab === 'crm' ? 'active' : ''}`} onClick={() => setDashTab('crm')}>CRM</button>}
          {hasFb && <button className={`client-tab ${dashTab === 'facebook' ? 'active' : ''}`} onClick={() => setDashTab('facebook')}>Facebook</button>}
          {hasPmax && <button className={`client-tab ${dashTab === 'google_pmax' ? 'active' : ''}`} onClick={() => setDashTab('google_pmax')}>Google PMax</button>}
            {hasSearch && <button className={`client-tab ${dashTab === 'google_search' ? 'active' : ''}`} onClick={() => setDashTab('google_search')}>Google Search</button>}
            {hasG && <button className={`client-tab ${dashTab === 'google' ? 'active' : ''}`} onClick={() => setDashTab('google')}>Google</button>}
            {hasCrm && <button className={`client-tab tab-reco-hide-mobile ${dashTab === 'recommendations' ? 'active' : ''}`} onClick={() => setDashTab('recommendations')}>💡 המלצות חכמות</button>}
        </div>

        {dashTab === 'recommendations' ? (() => {
          // 60-day rolling window - recommendations are ALWAYS based on the last 60 days,
          // independent of selectedMonth (which only affects the KPI/chart tabs).
          const recWindowMonths = getRecommendationsWindowMonths(60);
          const crmRowsRec = reports.filter(r => recWindowMonths.includes(r.month) && r.source === 'crm');
          const fbRowsRec  = reports.filter(r => recWindowMonths.includes(r.month) && r.source === 'facebook');
          const ggRowsRec  = reports.filter(r => recWindowMonths.includes(r.month) && r.source === 'google');
          let _totalLids = 0;
          const _bucketTotals = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 };
          const _bucketWith  = { '0-15m': 0, '15m-1h': 0, '1h-4h': 0, '4h-8h': 0, '8h-1d': 0, '1d-3d': 0, '3d+': 0 };
          const _dowMerged = {};
          const _crmRepRows = [];
          const _byUser = {};
          const _sources = {};
          for (const r of crmRowsRec) {
            const rt = r.summary && r.summary.responseTimeStats; if (rt) {
              _totalLids += rt.totalLids || 0;
              const biz = (rt.business && rt.business.bucketsWithMeeting) || {};
              const bizB = (rt.business && rt.business.buckets) || {};
              for (const [k,v] of Object.entries(bizB)) {
                const key = (k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k;
                _bucketTotals[key] = (_bucketTotals[key] || 0) + v;
              }
              for (const [k, v] of Object.entries(biz)) {
                const key = (k === '4h-24h' || k === '4h-1d') ? '4h-8h' : k;
                _bucketWith[key] = (_bucketWith[key] || 0) + (v.withMeeting || 0);
              }
              // Merge byUser - sum count + weighted-avg minutes
              const bUser = (rt.business && rt.business.byUser) || {};
              for (const [name, v] of Object.entries(bUser)) {
                if (!_byUser[name]) _byUser[name] = { count: 0, sumMin: 0 };
                _byUser[name].count += v.count || 0;
                _byUser[name].sumMin += (v.avgMinutes || 0) * (v.count || 0);
              }
            }
            const dow = r.summary && r.summary.dayOfWeekStats;
            if (dow) for (const k of Object.keys(dow)) {
              if (!_dowMerged[k]) _dowMerged[k] = { name: dow[k].name, leads: 0, scheduled: 0 };
              _dowMerged[k].leads += dow[k].leads || 0;
              _dowMerged[k].scheduled += dow[k].scheduled || 0;
            }
            if (Array.isArray(r.summary && r.summary.crmRepRows)) {
              _crmRepRows.push(...r.summary.crmRepRows);
            }
            // Merge sources from per-source CRM rows (stored in data[])
            if (Array.isArray(r.data)) {
              for (const row of r.data) {
                const src = (row.source || '').toString().trim() || 'ללא מקור';
                if (!_sources[src]) _sources[src] = { totalLeads: 0, nonRelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0 };
                _sources[src].totalLeads += Number(row.totalLeads) || 0;
                _sources[src].nonRelevantLeads += Number(row.irrelevantLeads || row.nonRelevantLeads) || 0;
                _sources[src].meetingsScheduled += Number(row.meetingsScheduled) || 0;
                _sources[src].meetingsCompleted += Number(row.meetingsCompleted) || 0;
              }
            }
          }
          // Finalize byUser averages
          const _byUserFinal = {};
          for (const [name, v] of Object.entries(_byUser)) {
            _byUserFinal[name] = { count: v.count, avgMinutes: v.count > 0 ? Math.round(v.sumMin / v.count) : 0 };
          }
          // Build ad-level rows from Meta/Google reports (r.data[] has per-row ad records)
          const _fbAdRows = [];
          for (const r of fbRowsRec) if (Array.isArray(r.data)) _fbAdRows.push(...r.data);
          const _ggAdRows = [];
          for (const r of ggRowsRec) if (Array.isArray(r.data)) _ggAdRows.push(...r.data);
          // Build a lookup of adName → creative details (imageUrl/videoUrl/permalink).
          // Sourced from r.summary.activeAds (only effective_status=ACTIVE ads - full
          // list since the fix to remove the top-5 slice).
          // Also union with summary.activeAdNames for backwards compatibility with
          // older fetches where the slice was still applied.
          const _activeAdsByName = {};
          for (const r of [...fbRowsRec, ...ggRowsRec]) {
            const ads = (r.summary && r.summary.activeAds) || [];
            for (const a of ads) {
              // Meta route stores ads with `name` field; alias to adName for the lookup
              const nm = a && (a.adName || a.name);
              if (nm && !_activeAdsByName[nm]) _activeAdsByName[nm] = { ...a, adName: nm };
            }
            // Also include any ad names from activeAdNames list (no creative meta)
            const names = (r.summary && r.summary.activeAdNames) || [];
            for (const nm of names) {
              if (nm && !_activeAdsByName[nm]) _activeAdsByName[nm] = { adName: nm };
            }
          }

          // Compute totalSpend across the 60-day window (Meta + Google ad-level rows)
          let _totalSpend = 0;
          for (const r of _fbAdRows) _totalSpend += Number(r.spend) || 0;
          for (const r of _ggAdRows) _totalSpend += Number(r.spend) || 0;
          // Compute costPerMeeting - use completed meetings (more conservative than scheduled,
          // aligns with actual sales pipeline value). Falls back to scheduled if no completed.
          let _completedMeetings = 0;
          let _scheduledMeetings = 0;
          for (const s of Object.values(_sources)) {
            _completedMeetings += s.meetingsCompleted || 0;
            _scheduledMeetings += s.meetingsScheduled || 0;
          }
          const _meetingsDenominator = _completedMeetings > 0 ? _completedMeetings : _scheduledMeetings;
          const _costPerMeeting = _meetingsDenominator > 0 ? _totalSpend / _meetingsDenominator : 0;

          const recs = buildRecommendations({
            bucketTotals: _bucketTotals, bucketWith: _bucketWith,
            dowMerged: _dowMerged, totalLids: _totalLids,
            crmRepRows: _crmRepRows,
            byUser: _byUserFinal,
            sources: _sources,
            fbRows: _fbAdRows, googRows: _ggAdRows,
            costPerMeeting: _costPerMeeting,
            totalSpend: _totalSpend,
            activeAdsByName: _activeAdsByName,
          });
          // Build dedup lookup: which dedupKeys already have an OPEN task in vitas_tasks
          const openTaskKeys = new Set();
          const tasksByKey = {};
          for (const t of vitasTasks) {
            tasksByKey[t.recommendation_key] = t;
            if (t.status === 'pending' || t.status === 'in_progress') openTaskKeys.add(t.recommendation_key);
          }
          // Split recs into new (not in pipeline) vs already-locked (matches open task)
          const newRecs = recs.filter(r => !openTaskKeys.has(r.dedupKey));
          const groupedNew = groupByRole(newRecs);
          // Pipeline tasks: all tasks for the project, simple counting (no in_progress/done split)
          const activeTasksCount = vitasTasks.filter(t => t.status !== 'dropped' && t.status !== 'done').length;

          const fmtDate = (s) => {
            if (!s) return '';
            const [y,m,d] = String(s).slice(0,10).split('-');
            return `${d}.${m}.${y.slice(2)}`;
          };

          const renderCard = (rec, i) => {
            const isLocking = lockingRecKey === rec.dedupKey;
            return (
              <div key={i} className="rec-card">
                <div className="rec-title"><span className="rec-icon">{rec.icon}</span><h3>{rec.title}</h3></div>
                <div className="rec-body">{rec.body.map((p, j) => <p key={j}>{p}</p>)}</div>
                {rec.suggestion && <div className="rec-suggestion">{rec.suggestion}</div>}
                {rec.prediction && (
                  <div className="rec-prediction">
                    <span className="pred-value">{rec.prediction.value}</span>
                    <div>
                      <div className="pred-label">{rec.prediction.label}</div>
                      <div className="pred-detail">{rec.prediction.detail}</div>
                    </div>
                  </div>
                )}
                {rec.measure && rec.measure.length > 0 && (
                  <div className="rec-measure">
                    <div className="rec-measure-title">איך נדע אם זה עבד החודש הבא?</div>
                    <ul>{rec.measure.map((m, k) => <li key={k}>{m}</li>)}</ul>
                  </div>
                )}
                {rec.assets && (rec.assets.best || rec.assets.worst) && (
                  <div className="rec-ads-preview">
                    {rec.assets.best && (
                      <div className="rec-ad-card rec-ad-best">
                        <div className="rec-ad-badge">✅ קריאטיב מנצח</div>
                        <div className="rec-ad-name">{rec.assets.best.adName}</div>
                        {rec.assets.best.videoUrl ? (
                          <video src={rec.assets.best.videoUrl} className="rec-ad-media" controls muted playsInline preload="metadata" poster={rec.assets.best.imageUrl || undefined} />
                        ) : rec.assets.best.imageUrl ? (
                          <img src={rec.assets.best.imageUrl} className="rec-ad-media" alt={rec.assets.best.adName} loading="lazy" style={isDemoProject ? {filter:'blur(8px)'} : undefined} />
                        ) : (
                          <div className="rec-ad-noimg">אין תמונה זמינה</div>
                        )}
                        {rec.assets.best.title && <div className="rec-ad-title">{rec.assets.best.title}</div>}
                        {rec.assets.best.body && <div className="rec-ad-body">{rec.assets.best.body}</div>}
                        {rec.assets.best.permalink && <a href={rec.assets.best.permalink} target="_blank" rel="noopener noreferrer" className="rec-ad-link">פתח בפייסבוק ↗</a>}
                      </div>
                    )}
                    {rec.assets.worst && (
                      <div className="rec-ad-card rec-ad-worst">
                        <div className="rec-ad-badge">❌ קריאטיב מבוזבז</div>
                        <div className="rec-ad-name">{rec.assets.worst.adName}</div>
                        {rec.assets.worst.videoUrl ? (
                          <video src={rec.assets.worst.videoUrl} className="rec-ad-media" controls muted playsInline preload="metadata" poster={rec.assets.worst.imageUrl || undefined} />
                        ) : rec.assets.worst.imageUrl ? (
                          <img src={rec.assets.worst.imageUrl} className="rec-ad-media" alt={rec.assets.worst.adName} loading="lazy" style={isDemoProject ? {filter:'blur(8px)'} : undefined} />
                        ) : (
                          <div className="rec-ad-noimg">אין תמונה זמינה</div>
                        )}
                        {rec.assets.worst.title && <div className="rec-ad-title">{rec.assets.worst.title}</div>}
                        {rec.assets.worst.body && <div className="rec-ad-body">{rec.assets.worst.body}</div>}
                        {rec.assets.worst.permalink && <a href={rec.assets.worst.permalink} target="_blank" rel="noopener noreferrer" className="rec-ad-link">פתח בפייסבוק ↗</a>}
                      </div>
                    )}
                  </div>
                )}
                <div className="rec-foot">
                  {rec.type === 'creative_performance' && rec.assets && rec.assets.worst && (
                    <button
                      className="rec-auto-btn"
                      onClick={() => setRuleDialog({
                        rec,
                        ruleType: 'pause_high_cpl_ads',
                        params: {
                          minSpend: 200,
                          cplThreshold: Math.round((rec.baseline?.avgCpl || 100) * 1.6),
                          lookbackDays: 14,
                        },
                      })}
                      title="צור כלל ב-Meta שמשהה אוטומטית כל מודעה בקמפיין שעוברת CPL מסוים - לנצח"
                    >
                      🤖 צור כלל אוטומטי
                    </button>
                  )}
                  {rec.type === 'day_of_week' && (
                    <button
                      className="rec-auto-btn"
                      onClick={() => {
                        const dayMap = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
                        const dow = dayMap[rec.baseline?.metric?.replace(/^day_/, '')] ?? 0;
                        setRuleDialog({
                          rec,
                          ruleType: 'boost_budget_on_day',
                          params: { dayOfWeek: dow, pctIncrease: 30 },
                        });
                      }}
                      title="צור כלל ב-Meta שמעלה אוטומטית את התקציב ביום הזה - לנצח"
                    >
                      🤖 צור כלל אוטומטי
                    </button>
                  )}
                  <button
                    className="btn-primary"
                    disabled={isLocking}
                    onClick={() => lockRecommendation(rec)}
                    title="נעל את ההמלצה הזאת בתוכנית העבודה - תוכל לעקוב אחרי הביצוע והאימפקט"
                  >
                    {isLocking ? '⏳ נועל...' : '✓ אנחנו עושים את זה'}
                  </button>
                </div>
              </div>
            );
          };

          // Build currentInput shape for compareImpact - same structure as buildRecommendations input
          const _impactInput = {
            bucketTotals: _bucketTotals, bucketWith: _bucketWith,
            dowMerged: _dowMerged, crmRepRows: _crmRepRows,
            byUser: _byUserFinal, sources: _sources,
            fbRows: _fbAdRows, googRows: _ggAdRows,
          };

          // Compute impact verdict for each task
          const tasksWithImpact = vitasTasks.map(t => ({ task: t, impact: compareImpact(t, _impactInput) }));

          const renderPipelineCard = ({ task, impact }) => {
            const meta = ROLE_META[task.role] || {};
            const md = task.baseline_metadata || {};
            const predValue = md.predictionValue;
            const isManuallyClosed = task.status === 'dropped' || task.status === 'done';
            // Visual indicator from impact verdict
            const indicatorStyle = {
              pending: { bg: '#f1f5f9', color: '#64748b', icon: '⏳' },
              green:   { bg: '#d1fae5', color: '#047857', icon: '🟢' },
              red:     { bg: '#fee2e2', color: '#b91c1c', icon: '🔴' },
              gray:    { bg: '#f1f5f9', color: '#475569', icon: '⚪' },
              unknown: { bg: '#fef3c7', color: '#92400e', icon: '❓' },
            }[impact.status] || { bg: '#f1f5f9', color: '#64748b', icon: '⏳' };
            return (
              <div key={task.id} className="pipeline-card" style={{borderRight: `4px solid ${meta.color || '#64748b'}`, opacity: isManuallyClosed ? 0.65 : 1}}>
                <div className="pipeline-card-head">
                  <div style={{flex: 1}}>
                    <div className="pipeline-card-title">
                      <span style={{fontSize:'1.2em'}}>{md.icon || meta.icon || '📌'}</span>
                      {task.task_title}
                    </div>
                    <div className="pipeline-card-meta">
                      <span className="pipeline-role-chip" style={{background: (meta.color || '#64748b') + '22', color: meta.color || '#64748b'}}>{meta.icon} {meta.label || task.role}</span>
                      <span className="pipeline-date">ננעלה ב-{fmtDate(task.meeting_date)} · לפני {impact.daysSinceLock || 0} ימים</span>
                      {isManuallyClosed && <span className="pipeline-status-chip" style={{background: '#f1f5f9', color: '#64748b'}}>נסגרה ידנית</span>}
                    </div>
                  </div>
                  {predValue && <div className="pipeline-pred">{predValue}</div>}
                </div>
                <div className="pipeline-card-body">{task.task_description}</div>
                {!isManuallyClosed && (
                  <div className="impact-indicator" style={{background: indicatorStyle.bg, color: indicatorStyle.color}}>
                    <span className="impact-icon">{indicatorStyle.icon}</span>
                    <div className="impact-content">
                      {impact.status === 'pending' && (
                        <>
                          <div className="impact-label">{impact.label}</div>
                          <div className="impact-sub">המדידה תופיע בעוד {impact.daysRemaining} ימים</div><div style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'8px'}}><div style={{flex:1,height:'4px',background:'var(--border)',borderRadius:'2px',overflow:'hidden'}}><div style={{height:'100%',background:'var(--indigo)',borderRadius:'2px',width:`${Math.max(4, Math.round((1-(impact.daysRemaining||28)/28)*100))}%`}} /></div><span style={{fontSize:'11px',fontWeight:700,color:'var(--text-3)',whiteSpace:'nowrap'}}>עוד {impact.daysRemaining} ימים</span></div>
                        </>
                      )}
                      {(impact.status === 'green' || impact.status === 'red' || impact.status === 'gray') && (
                        <>
                          <div className="impact-label">
                            {impact.status === 'green' && 'אימפקט חיובי'}
                            {impact.status === 'red' && 'אימפקט שלילי'}
                            {impact.status === 'gray' && 'אין שינוי משמעותי'}
                            <span className="impact-pct">{impact.pctChange > 0 ? '+' : ''}{impact.pctChange}%</span>
                          </div>
                          <div className="impact-sub">{impact.label} · {Math.round(impact.baselineValue * 10) / 10} → {Math.round(impact.currentValue * 10) / 10}</div>
                        </>
                      )}
                      {impact.status === 'unknown' && (
                        <>
                          <div className="impact-label">לא ניתן למדוד</div>
                          <div className="impact-sub">{impact.reason || 'נתונים חסרים'}</div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div className="pipeline-actions">
                  {!isManuallyClosed && (
                    <button className="pipeline-btn" onClick={() => updateTaskStatus(task.id, 'dropped')}>סגור · לא רלוונטי יותר</button>
                  )}
                  {isManuallyClosed && (
                    <button className="pipeline-btn" onClick={() => updateTaskStatus(task.id, 'pending')}>↩️ פתח מחדש</button>
                  )}
                </div>
              </div>
            );
          };

          // Group by impact status - completely replaces the old 4-section grouping
          const tasksPending = tasksWithImpact.filter(x => x.impact.status === 'pending' && x.task.status !== 'dropped' && x.task.status !== 'done');
          const tasksMeasured = tasksWithImpact.filter(x => ['green', 'red', 'gray'].includes(x.impact.status) && x.task.status !== 'dropped' && x.task.status !== 'done');
          const tasksClosed = tasksWithImpact.filter(x => x.task.status === 'dropped' || x.task.status === 'done');

          return (
            <div className="section">
              <div className="section-head"><div className="ico violet"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg></div><h2>המלצות חכמות לחודש הבא</h2></div>

              <div className="client-tabs rec-subtabs" style={{marginBottom: 18}}>
                <button className={`client-tab ${recSubTab === 'new' ? 'active' : ''}`} onClick={() => setRecSubTab('new')}>
                  💡 חדשות {newRecs.length > 0 && <span className="subtab-badge">{newRecs.length}</span>}
                </button>
                <button className={`client-tab ${recSubTab === 'pipeline' ? 'active' : ''}`} onClick={() => setRecSubTab('pipeline')}>
                  📋 בתוכנית {activeTasksCount > 0 && <span className="subtab-badge">{activeTasksCount}</span>}
                </button>
              </div>

              {recSubTab === 'new' ? (
                newRecs.length === 0 ? (
                  <div className="welcome-center" style={{padding:'40px 20px',textAlign:'center'}}>
                    <div className="icon" style={{fontSize:'3.5em',marginBottom:'10px'}}>✨</div>
                    <h3>{recs.length === 0 ? 'אין כרגע המלצות מובהקות' : 'כל ההמלצות החדשות נוספו לתוכנית'}</h3>
                    <p style={{color:'var(--text-secondary)',marginTop:'8px',maxWidth:'520px',margin:'8px auto'}}>
                      {recs.length === 0
                        ? 'הנתונים בחלון 60 הימים לא מציגים דפוס חזק מספיק כדי להוציא המלצה אחראית. ייתכן שהדפוסים יתבהרו כשייאסף יותר מידע, או שהפרויקט מתפקד מאוזן.'
                        : 'כל הדפוסים המובהקים הקיימים כבר ננעלו בתוכנית העבודה. עבור לטאב "📋 בתוכנית" כדי לעקוב אחריהם.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <p style={{color:'var(--text-secondary)',fontSize:'0.9em',marginBottom:'18px'}}>מצאנו {newRecs.length === 1 ? 'דפוס מובהק חדש' : `${newRecs.length} דפוסים מובהקים חדשים`} שעדיין לא בתוכנית העבודה. לחץ "✓ אנחנו עושים את זה" על כל אחד כדי להתחייב - האימפקט יימדד אוטומטית אחרי 28 ימים.</p>
                    {ROLE_ORDER.map(role => {
                      const items = groupedNew[role] || [];
                      const meta = ROLE_META[role];
                      if (items.length === 0) {
                        return (
                          <div key={role} className="role-group role-empty">
                            <div className="role-header" style={{borderRight: `4px solid ${meta.color}`}}>
                              <span className="role-icon">{meta.icon}</span>
                              <div>
                                <div className="role-label">{meta.label}</div>
                                <div className="role-desc">{meta.desc}</div>
                              </div>
                              <span className="role-count" style={{color: meta.color}}>אין המלצה</span>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={role} className="role-group">
                          <div className="role-header" style={{borderRight: `4px solid ${meta.color}`}}>
                            <span className="role-icon">{meta.icon}</span>
                            <div>
                              <div className="role-label">{meta.label}</div>
                              <div className="role-desc">{meta.desc}</div>
                            </div>
                            <span className="role-count" style={{color: meta.color}}>{items.length === 1 ? 'המלצה אחת' : `${items.length} המלצות`}</span>
                          </div>
                          <div className="role-cards">
                            {items.map((rec, i) => renderCard(rec, i))}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )
              ) : (
                // Pipeline tab
                tasksPending.length === 0 && tasksMeasured.length === 0 && tasksClosed.length === 0 ? (
                  <div className="welcome-center" style={{padding:'40px 20px',textAlign:'center'}}>
                    <div className="icon" style={{fontSize:'3.5em',marginBottom:'10px'}}>📋</div>
                    <h3>התוכנית ריקה</h3>
                    <p style={{color:'var(--text-secondary)',marginTop:'8px',maxWidth:'520px',margin:'8px auto'}}>עדיין לא ננעלו המלצות בתוכנית. עבור לטאב "💡 חדשות" ולחץ על "✓ אנחנו עושים את זה" כדי להתחייב לפעולה. האימפקט יימדד אוטומטית אחרי 28 ימים.</p>
                  </div>
                ) : (
                  <>
                    {tasksMeasured.length > 0 && (
                      <div className="pipeline-section">
                        <div className="pipeline-section-title">📊 נמדדו ({tasksMeasured.length})</div>
                        {tasksMeasured.map(renderPipelineCard)}
                      </div>
                    )}
                    {tasksPending.length > 0 && (
                      <div className="pipeline-section">
                        <div className="pipeline-section-title">⏳ ממתינות למדידה ({tasksPending.length})</div>
                        {tasksPending.map(renderPipelineCard)}
                      </div>
                    )}
                    {tasksClosed.length > 0 && (
                      <div className="pipeline-section">
                        <div className="pipeline-section-title">📦 נסגרו ידנית ({tasksClosed.length})</div>
                        {tasksClosed.map(renderPipelineCard)}
                      </div>
                    )}
                  </>
                )
              )}

              {ruleDialog && (
                <div className="rule-dialog-backdrop" onClick={() => !creatingRule && setRuleDialog(null)}>
                  <div className="rule-dialog" onClick={e => e.stopPropagation()}>
                    <div className="rule-dialog-title">🤖 יצירת כלל אוטומטי ב-Meta</div>
                    <div className="rule-dialog-body">
                      {ruleDialog.ruleType === 'pause_high_cpl_ads' && (
                        <>
                          <p><strong>מה הכלל יעשה:</strong></p>
                          <p>ישהה אוטומטית כל מודעה בקמפיינים של <strong>{selectedProject?.name}</strong> שצוברת CPL גבוה מהסף שתגדיר, אחרי שהיא בזבזה לפחות {ruleDialog.params.minSpend}₪.</p>
                          <div className="rule-dialog-input">
                            <label>סף CPL להשהיה (₪):</label>
                            <input
                              type="number"
                              value={ruleDialog.params.cplThreshold}
                              onChange={e => setRuleDialog({...ruleDialog, params: {...ruleDialog.params, cplThreshold: Number(e.target.value)}})}
                              min={10}
                            />
                          </div>
                          <div className="rule-dialog-input">
                            <label>סף הוצאה מינימלי לפני בדיקה (₪):</label>
                            <input
                              type="number"
                              value={ruleDialog.params.minSpend}
                              onChange={e => setRuleDialog({...ruleDialog, params: {...ruleDialog.params, minSpend: Number(e.target.value)}})}
                              min={50}
                            />
                          </div>
                        </>
                      )}
                      {ruleDialog.ruleType === 'boost_budget_on_day' && (
                        <>
                          <p><strong>מה הכלל יעשה:</strong></p>
                          <p>יעלה את התקציב היומי של כל קבוצת מודעות בקמפיינים של <strong>{selectedProject?.name}</strong> ב-{ruleDialog.params.pctIncrease}%, רק בימים {['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][ruleDialog.params.dayOfWeek]}.</p>
                          <div className="rule-dialog-input">
                            <label>אחוז העלאה (%):</label>
                            <input
                              type="number"
                              value={ruleDialog.params.pctIncrease}
                              onChange={e => setRuleDialog({...ruleDialog, params: {...ruleDialog.params, pctIncrease: Number(e.target.value)}})}
                              min={5}
                              max={300}
                            />
                          </div>
                        </>
                      )}
                      <p className="rule-dialog-note">⚠️ הכלל ייווצר ב-Meta Ads Manager תחת "Automated Rules" וירוץ אוטומטית עד שתשהה/תמחק אותו שם.</p>
                    </div>
                    <div className="rule-dialog-actions">
                      <button className="pipeline-btn" disabled={creatingRule} onClick={() => setRuleDialog(null)}>ביטול</button>
                      <button
                        className="pipeline-btn pipeline-btn-primary"
                        disabled={creatingRule}
                        onClick={() => createMetaRule(ruleDialog.ruleType, ruleDialog.params, ruleDialog.rec?.dedupKey)}
                      >
                        {creatingRule ? '⏳ יוצר...' : '✓ צור כלל ב-Meta'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })() : dashTab === 'crm' ? (<>
          <div className="client-tabs" style={{marginBottom: 15}}>
            <button className={`client-tab ${crmSubTab === 'sources' ? 'active' : ''}`} onClick={() => setCrmSubTab('sources')}>📂 מקורות הגעה</button>
            <button className={`client-tab ${crmSubTab === 'response' ? 'active' : ''}`} onClick={() => setCrmSubTab('response')}>⏱️ זמני תגובה</button>
            <button className={`client-tab ${crmSubTab === 'objections' ? 'active' : ''}`} onClick={() => setCrmSubTab('objections')}>🚫 התנגדויות</button>
            <button className={`client-tab ${crmSubTab === 'reports' ? 'active' : ''}`} onClick={() => setCrmSubTab('reports')}>🏘️ יישובים</button>
          </div>
          {crmSubTab === 'sources' ? renderCrmDashboard() : crmSubTab === 'objections' ? renderCrmObjectionsDashboard() : crmSubTab === 'response' ? renderCrmResponseDashboard() : renderCrmReportDashboard()}
        </>) : (displayReports.length === 0 && dashTab !== 'all') ? (
          <div className="welcome-center" style={{padding:'60px 20px',textAlign:'center'}}>
            <div className="icon" style={{fontSize:'4em',marginBottom:'10px'}}>{'\ud83d\udced'}</div>
            <h3>{'\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05dc\u05d8\u05d5\u05d5\u05d7 \u05d4\u05ea\u05d0\u05e8\u05d9\u05db\u05d9\u05dd \u05e9\u05e0\u05d1\u05d7\u05e8'}</h3>
            <p style={{color:'#64748b',marginTop:'8px'}}>{'\u05d1\u05d7\u05e8 \u05d8\u05d5\u05d5\u05d7 \u05d0\u05d7\u05e8 \u05d0\u05d5 \u05d4\u05e8\u05e5 \u05e1\u05e0\u05db\u05e8\u05d5\u05df'}</p>
          </div>
        ) : (<>
        <div className="kpi-grid">
          {kpi('\u05ea\u05e7\u05e6\u05d9\u05d1', formatCurrency(activeT.spend), '', activeT.spend, activeP?.spend, true)}
          {dashTab === 'all' ? kpi('\u05dc\u05d9\u05d3\u05d9\u05dd', formatNum(totalLeadsWithCrm), 'green', totalLeadsWithCrm, activeP != null ? (activeP.leads + prevCrmTotalLeads) : null) : kpi('\u05dc\u05d9\u05d3\u05d9\u05dd', formatNum(activeT.leads), 'green', activeT.leads, activeP?.leads)}
          {kpi('\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3', formatCurrency(activeT.cpl), 'purple', activeT.cpl, activeP?.cpl, true)}
          {crmTotals ? kpi('\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05e9\u05ea\u05d5\u05d0\u05de\u05d5', formatNum(crmTotals.meetingsScheduled || 0), 'cyan', crmTotals.meetingsScheduled, prevCrmTotals?.meetingsScheduled) : null}
          {crmTotals ? kpi('\u05e4\u05d2\u05d9\u05e9\u05d5\u05ea \u05e9\u05d1\u05d5\u05e6\u05e2\u05d5', formatNum(crmTotals.meetingsCompleted || 0), 'orange', crmTotals.meetingsCompleted, prevCrmTotals?.meetingsCompleted) : null}
          {crmTotals ? kpi('\u05d4\u05e8\u05e9\u05de\u05d5\u05ea', formatNum(crmTotals.registrations || 0), 'green', crmTotals.registrations, prevCrmTotals?.registrations) : null}
          {crmTotals ? kpi('\u05d7\u05d5\u05d6\u05d9\u05dd', formatNum(crmTotals.contracts || 0), 'pink', crmTotals.contracts, prevCrmTotals?.contracts) : null}
          {crmTotals && crmTotals.meetingsCompleted > 0 ? kpi('עלות לפגישה שבוצעה', formatCurrency(activeT.spend / crmTotals.meetingsCompleted), 'purple', activeT.spend / crmTotals.meetingsCompleted, (prevCrmTotals?.meetingsCompleted > 0 && activeP?.spend) ? activeP.spend / prevCrmTotals.meetingsCompleted : null, true) : null}
          {crmTotals && crmTotals.contracts > 0 ? kpi('עלות לחוזה', formatCurrency(activeT.spend / crmTotals.contracts), 'red', activeT.spend / crmTotals.contracts, (prevCrmTotals?.contracts > 0 && activeP?.spend) ? activeP.spend / prevCrmTotals.contracts : null, true) : null}
          {crmTotals && (crmTotals.contractValue || 0) > 0 ? kpi('שווי חוזים', formatCurrencyCompact(crmTotals.contractValue), 'green', crmTotals.contractValue, prevCrmTotals?.contractValue || null) : null}
        </div>

        {/* FUNNEL */}
        <div className="section">
          <div className="section-head">
            <div className="ico violet"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></div>
            <h2>משפך שיווקי</h2>
            <span className="sub">מקליק ועד חוזה</span>
          </div>
          {(() => {
            const fCh = (cur, prev) => {
              if (!compareEnabled || prev == null || prev === 0) return null;
              const delta = cur - prev;
              const pct = ((delta) / prev) * 100;
              const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
              const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '−';
              const absDelta = formatNum(Math.abs(Math.round(delta)));
              const pctStr = Math.abs(pct).toFixed(0) + '%';
              const isFlat = delta === 0;
              return <span className={`kpi-trend${isFlat ? ' flat' : ''}`} style={{fontSize:10,padding:'2px 6px',marginTop:4,display:'inline-block'}}>{arrow} {sign}{absDelta} ({isFlat ? '0%' : (delta > 0 ? '+' : '-') + pctStr})</span>;
            };
            return crmTotals ? (
            <div className="funnel">
              <div className="fstep sky">
                <div className="flabel">קליקים</div>
                <div className="fvalue">{formatNum(activeT.clicks)}</div>
                <div className="frate"><span className="pct">{activeT.impressions > 0 ? (activeT.clicks / activeT.impressions * 100).toFixed(2) + '%' : '-'}</span> CTR</div>
                {fCh(activeT.clicks, p?.clicks)}
              </div>
              <div className="farrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
              <div className="fstep">
                <div className="flabel">חשיפות</div>
                <div className="fvalue">{formatNum(activeT.impressions)}</div>
                <div className="frate"><span className="pct">100%</span> מצטבר</div>
                {fCh(activeT.impressions, p?.impressions)}
              </div>
              <div className="farrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
              <div className="fstep terra">
                <div className="flabel">פגישות מתואמות</div>
                <div className="fvalue">{formatNum(crmTotals.meetingsScheduled || 0)}</div>
                <div className="frate"><span className="pct">{totalLeadsWithCrm > 0 ? ((crmTotals.meetingsScheduled || 0) / totalLeadsWithCrm * 100).toFixed(1) + '%' : '-'}</span> מלידים</div>
                {fCh(crmTotals.meetingsScheduled || 0, prevCrmTotals?.meetingsScheduled)}
              </div>
              <div className="farrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
              <div className="fstep emerald">
                <div className="flabel">פגישות שבוצעו</div>
                <div className="fvalue">{formatNum(crmTotals.meetingsCompleted || 0)}</div>
                <div className="frate"><span className="pct">{totalLeadsWithCrm > 0 ? (crmTotals.meetingsCompleted / totalLeadsWithCrm * 100).toFixed(1) + '%' : '-'}</span> מלידים</div>
                {fCh(crmTotals.meetingsCompleted || 0, prevCrmTotals?.meetingsCompleted)}
              </div>
              <div className="farrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
              <div className="fstep amber">
                <div className="flabel">הרשמות</div>
                <div className="fvalue">{formatNum(crmTotals.registrations || 0)}</div>
                <div className="frate"><span className="pct">{crmTotals.meetingsCompleted > 0 ? (crmTotals.registrations / crmTotals.meetingsCompleted * 100).toFixed(0) + '%' : '-'}</span> משבוצעו</div>
                {fCh(crmTotals.registrations || 0, prevCrmTotals?.registrations)}
              </div>
              <div className="farrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
              <div className="fstep rose">
                <div className="flabel">חוזים</div>
                <div className="fvalue">{formatNum(crmTotals.contracts || 0)}</div>
                <div className="frate"><span className="pct">{crmTotals.registrations > 0 ? (crmTotals.contracts / crmTotals.registrations * 100).toFixed(0) + '%' : '-'}</span> מהרשמות</div>
                {fCh(crmTotals.contracts || 0, prevCrmTotals?.contracts)}
              </div>
            </div>
            ) : (
            <div className="funnel" style={{gridTemplateColumns:'1fr 14px 1fr 14px 1fr'}}>
              <div className="fstep rose">
                <div className="flabel">לידים</div>
                <div className="fvalue">{formatNum(activeT.leads)}</div>
                <div className="frate"><span className="pct">{activeT.convRate.toFixed(2)}%</span> המרה</div>
              </div>
              <div className="farrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
              <div className="fstep sky">
                <div className="flabel">קליקים</div>
                <div className="fvalue">{formatNum(activeT.clicks)}</div>
                <div className="frate"><span className="pct">{activeT.impressions > 0 ? (activeT.clicks / activeT.impressions * 100).toFixed(2) + '%' : '-'}</span> CTR</div>
              </div>
              <div className="farrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></div>
              <div className="fstep">
                <div className="flabel">חשיפות</div>
                <div className="fvalue">{formatNum(activeT.impressions)}</div>
                <div className="frate"><span className="pct">100%</span> מצטבר</div>
              </div>
            </div>
            );
          })()}
        </div>

                {/* Non-FB tabs: keep existing campaigns charts + flat table */}
        {isPmax && campNames.length > 0 && (<div className="section"><div className="section-head"><div className="ico amber"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div><h2>קמפיינים</h2><span className="sub"><InfoTip text="סיכום ביצועים פר קמפיין" /></span></div><div className="chart-grid"><div className="chart-card"><h4>{'\u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05ea\u05e7\u05e6\u05d9\u05d1'}</h4><div className="chart-container"><canvas id="campSpend"></canvas></div></div><div className="chart-card"><h4>{'\u05dc\u05d9\u05d3\u05d9\u05dd \u05d5-CPL'}</h4><div className="chart-container"><canvas id="campLeads"></canvas></div></div></div>{buildTable(data.campaigns, prevData?.campaigns, '\u05e7\u05de\u05e4\u05d9\u05d9\u05df', 'campaigns', 'google')}</div>)}

        {/* Nested expandable table - Campaign → Ad Set → Ad - for FB, All, Google Search */}
        {(isFb || dashTab === 'all' || dashTab === 'google_search') && campNames.length > 0 && (() => {
          // Build hierarchy from raw rows — inject _reportSource from the parent report
          const treeRows = [];
          displayReports.forEach(rep => { if (rep.data) rep.data.forEach(row => treeRows.push({...row, _reportSource: rep.source || ''})); });
          const tree = {};
          treeRows.forEach(r => {
            const c = r.campaign || '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2';
            const a = r.adSet || '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2';
            const ad = r.adName || '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2';
            const spend = parseFloat(r.spend) || 0;
            const imp = parseFloat(r.impressions) || 0;
            const reach = parseFloat(r.reach) || 0;
            const clicks = parseFloat(r.clicks) || 0;
            const leads = parseFloat(r.leads) || 0;
            if (!tree[c]) tree[c] = { spend:0, impressions:0, reach:0, clicks:0, leads:0, adSets: {}, source: r._reportSource || '', status: r.campaignStatus || '' };
            tree[c].spend += spend; tree[c].impressions += imp; tree[c].reach += reach; tree[c].clicks += clicks; tree[c].leads += leads;
            if (r.campaignStatus) tree[c].status = r.campaignStatus;
            if (!tree[c].adSets[a]) tree[c].adSets[a] = { spend:0, impressions:0, reach:0, clicks:0, leads:0, ads: {}, status: r.adSetStatus || '' };
            tree[c].adSets[a].spend += spend; tree[c].adSets[a].impressions += imp; tree[c].adSets[a].reach += reach; tree[c].adSets[a].clicks += clicks; tree[c].adSets[a].leads += leads;
            if (r.adSetStatus) tree[c].adSets[a].status = r.adSetStatus;
            if (!tree[c].adSets[a].ads[ad]) tree[c].adSets[a].ads[ad] = { spend:0, impressions:0, reach:0, clicks:0, leads:0, text:'', status: r.adStatus || '' };
            tree[c].adSets[a].ads[ad].spend += spend; tree[c].adSets[a].ads[ad].impressions += imp; tree[c].adSets[a].ads[ad].reach += reach; tree[c].adSets[a].ads[ad].clicks += clicks; tree[c].adSets[a].ads[ad].leads += leads;
            if (r.adStatus) tree[c].adSets[a].ads[ad].status = r.adStatus;
            if (r.adText) tree[c].adSets[a].ads[ad].text = r.adText;
          });
          const campaignNames = Object.keys(tree).sort((a,b) => tree[b].spend - tree[a].spend);
          const toggleCampaign = (c) => setExpandedCampaigns(prev => { const next = new Set(prev); if (next.has(c)) next.delete(c); else next.add(c); return next; });
          const toggleAdSet = (k) => setExpandedAdSets(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
          const cols = [
            { key:'name', label:'\u05e7\u05de\u05e4\u05d9\u05d9\u05df / \u05e7\u05d1\u05d5\u05e6\u05d4 / \u05de\u05d5\u05d3\u05e2\u05d4' },
            { key:'status', label:'\u05e1\u05d8\u05d0\u05d8\u05d5\u05e1' },
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
                  {level === 0 && data.source ? <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:'20px',height:'20px',borderRadius:'5px',background:data.source.includes('google')?'var(--rose-50)':'var(--sky-50)',color:data.source.includes('google')?'var(--rose)':'var(--sky)',fontWeight:800,fontSize:'11px',marginLeft:'6px',flexShrink:0}}>{data.source.includes('google')?'G':'F'}</span> : null}
                  {name}
                  {level === 0 && data.source ? <span className={`platform-tag${data.source.includes('google')?' google':''}`} style={{marginRight:'8px'}}>{data.source.includes('facebook')?'FACEBOOK':'GOOGLE'}</span> : null}
                </td>
                <td style={{fontSize,whiteSpace:'nowrap'}}>{(() => { const st = data.status || ''; const isActive = st === 'ENABLED'; const isPaused = st === 'PAUSED'; const bg = isActive ? 'rgba(16,185,129,0.12)' : isPaused ? 'rgba(245,158,11,0.12)' : 'rgba(100,116,139,0.12)'; const col = isActive ? '#059669' : isPaused ? '#d97706' : '#64748b'; const label = isActive ? '\u05e4\u05e2\u05d9\u05dc' : isPaused ? '\u05de\u05d5\u05e9\u05d4\u05d4' : st === 'REMOVED' ? '\u05d4\u05d5\u05e1\u05e8' : st || '-'; return st ? <span style={{background:bg,color:col,borderRadius:'999px',padding:'2px 8px',fontSize:'11px',fontWeight:700,whiteSpace:'nowrap',display:'inline-block'}}>{label}</span> : <span style={{color:'#cbd5e1'}}>-</span>; })()}</td>
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
              <div className="section-head"><div className="ico amber"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div><h2>{'\u05e7\u05de\u05e4\u05d9\u05d9\u05e0\u05d9\u05dd, \u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05de\u05d5\u05d3\u05e2\u05d5\u05ea \u05d5\u05de\u05d5\u05d3\u05e2\u05d5\u05ea'}</h2><span className="sub"><InfoTip text="טבלאה מאוחדת עם כל הרמות של החשבון הפרסומי" /></span></div>
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
          <div className="desktop-only-msg"><div className="icon">💻</div><div className="body">לצפייה בטבלאות המפורטות, פתח מהמחשב<span className="hint">הטבלאות המלאות זמינות בגרסת המחשב</span></div></div>
            </div>
          );
        })()}

        {/* Standard ad groups table (Facebook + Search/Display) */}
        {/* Ad-sets table removed for All/Google Search - nested campaigns table covers it */}

        {/* PMax: detailed asset-groups table (replaces both ad-groups + ads tables) */}
        {isPmax && (() => {
          const allAGs = displayReports.flatMap(r => r.summary?.assetGroups || []);
          if (allAGs.length === 0) return (
            <div className="section">
              <div className="section-head"><div className="ico indigo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div><h2>\u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05e0\u05db\u05e1\u05d9\u05dd</h2><span className="sub">Performance Max Asset Groups</span></div>
              <div className="card" style={{padding:'32px',textAlign:'center',color:'var(--text-3)'}}>
                <div style={{fontSize:'2em',marginBottom:'12px'}}>\ud83d\udce6</div>
                <div style={{fontWeight:600,fontSize:'0.95em',color:'var(--text-2)',marginBottom:'8px'}}>\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9 \u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05e0\u05db\u05e1\u05d9\u05dd \u05dc\u05ea\u05e7\u05d5\u05e4\u05d4 \u05d6\u05d5</div>
                <div style={{fontSize:'0.85em'}}>\u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05e0\u05d8\u05e2\u05e0\u05d5 \u05dc\u05dc\u05d0 \u05e4\u05e8\u05d8\u05d9 \u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05e0\u05db\u05e1\u05d9\u05dd, \u05d0\u05d5 \u05e9\u05e9\u05d9\u05e7\u05ea \u05d4-API \u05dc\u05d0 \u05d4\u05d7\u05d6\u05d9\u05e8\u05d4 \u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea. \u05d8\u05e2\u05df \u05de\u05d7\u05d3\u05e9 \u05d3\u05e8\u05da \u05d4\u05de\'\u05e0\u05d4 \u05db\u05d3\u05d9 \u05dc\u05e7\u05d1\u05dc \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05de\u05e2\u05d5\u05d3\u05db\u05e0\u05d9\u05dd.</div>
              </div>
            </div>
          );
          const sorted = [...allAGs].sort((a,b) => (b.spend || 0) - (a.spend || 0));
          return (
            <div className="section">
              <div className="section-head"><div className="ico indigo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div><h2>קבוצות נכסים</h2><span className="sub">Performance Max Asset Groups</span></div>
              <div className="card" style={{overflowX:'auto'}}>
                <table className="data-table"><thead><tr>
                  <th style={{whiteSpace:'nowrap'}}>{'\u05e7\u05d1\u05d5\u05e6\u05ea \u05e0\u05db\u05e1\u05d9\u05dd'}</th>
                  <th style={{whiteSpace:'nowrap'}}>{'\u05e7\u05de\u05e4\u05d9\u05d9\u05df'}</th>
                  <th style={{whiteSpace:'nowrap'}}>{'\u05e1\u05d8\u05d0\u05d8\u05d5\u05e1'}</th>
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
                        <td style={{fontWeight:600,unicodeBidi:'plaintext',textAlign:'right'}}>{ag.name || '-'}</td>
                        <td style={{fontSize:'0.85em',color:'#64748b',unicodeBidi:'plaintext'}}>{ag.campaign || '-'}</td>
                        <td>{(() => { const st = ag.status || ''; const isA = st==='ENABLED'; const isP = st==='PAUSED'; const bg = isA ? 'rgba(16,185,129,0.12)' : isP ? 'rgba(245,158,11,0.12)' : 'rgba(100,116,139,0.12)'; const col = isA ? '#059669' : isP ? '#d97706' : '#64748b'; const lbl = isA ? 'פעיל' : isP ? 'מושהה' : st==='REMOVED' ? 'הוסר' : st || '-'; return <span style={{background:bg,color:col,borderRadius:'999px',padding:'2px 8px',fontSize:'11px',fontWeight:700,whiteSpace:'nowrap',display:'inline-block'}}>{lbl}</span>; })()}</td>
                        <td>{formatNum(clicks)}</td>
                        <td>{formatNum(imps)}</td>
                        <td>{ctr.toFixed(2)}%</td>
                        <td style={{fontWeight:700,color:leads>0?'#059669':'#94a3b8'}}>{Math.round(leads)}</td>
                        <td style={{fontWeight:600}}>{leads > 0 ? formatCurrency(cpl) : '-'}</td>
                        <td style={{fontWeight:600}}>{formatCurrency(spend)}</td>
                      </tr>
                    );
                  })}
                </tbody></table>
              </div>
            </div>
          );
        })()}

{false && !isPmax && !isFb && <div className="section"><div className="section-title"><div className="section-icon" style={{background:'var(--gradient-3)'}}>{'\ud83d\udcdd'}</div>{'\u05de\u05d5\u05d3\u05e2\u05d5\u05ea'} <InfoTip text="כל המודעות עם הביצועים שלהן (כפילויות 'עותק 1' אוחדו)" /></div>{buildTable((() => { const merged = {}; Object.entries(data.ads).forEach(([name, d]) => { const base = name.replace(/[\u200e\u200f\u200b\u200c\u200d\u202a-\u202e\u2066-\u2069\uFEFF]/g, '').replace(/\s*#\d+$/, '').replace(/\s*-\s*\u05e2\u05d5\u05ea\u05e7\s*$/, '').replace(/\s*-\s*\u05e2\u05d5\u05ea\u05e7\s*\d*$/, '').trim(); if (!merged[base]) merged[base] = { spend: 0, leads: 0, clicks: 0, impressions: 0, reach: 0 }; merged[base].spend += d.spend; merged[base].leads += d.leads; merged[base].clicks += d.clicks; merged[base].impressions += d.impressions; merged[base].reach += (d.reach || 0); }); return merged; })(), null, '\u05de\u05d5\u05d3\u05e2\u05d4', 'ads')}</div>}

        {!isPmax && (genderNames.length > 0 || ageNames.length > 0) && (<div className="section section-demographics">
          <div className="section-head"><div className="ico indigo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><h2>פילוח דמוגרפי</h2><span className="sub">חלוקת ביצועים לפי מגדר וקבוצת גיל</span></div>
        <div style={{display:'flex',gap:'20px',alignItems:'flex-start'}}>
          <div style={{flex:1,minWidth:0}}>
          {!isPmax && genderNames.length > 0 && (() => {
          const gd = data.genders;
          const genderLabel = (g) => g === 'female' ? '\u05e0\u05e9\u05d9\u05dd' : g === 'male' ? '\u05d2\u05d1\u05e8\u05d9\u05dd' : g === 'unknown' ? '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2' : g;
          const orderedKeys = ['female', 'male', 'unknown'].filter(g => gd[g]);
          return (<div style={{marginBottom: ageNames.length > 0 ? '28px' : 0}}>
            <h3 style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'1.05em',fontWeight:600,color:'var(--text-primary)',margin:'0 0 12px 0'}}><span style={{fontSize:'1.2em'}}>⚧</span>פילוח מגדרי</h3>
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
                  const gPill=(key,val,display)=>{const e=gExtremes[key];if(!e||val<=0||e.min===e.max)return display;const c=gCols[key];if(!c||c.higher===undefined)return display;const isGood=(val===e.max&&c.higher)||(val===e.min&&!c.higher);const isBad=(val===e.max&&!c.higher)||(val===e.min&&c.higher);if(!isGood&&!isBad)return display;const bg=isGood?'rgba(16,185,129,0.13)':'rgba(239,68,68,0.10)';const col=isGood?'#059669':'#dc2626';return <span style={{background:bg,color:col,fontWeight:800,borderRadius:'999px',padding:'2px 9px',display:'inline-block',whiteSpace:'nowrap'}}>{display}</span>;};
                  return sorted.map(g => { const d = gd[g]; const cpl = d.leads > 0 ? d.spend / d.leads : 0; const cpc = d.clicks > 0 ? d.spend / d.clicks : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; const cplClass = cpl > 0 && cpl < 80 ? 'tag-green' : cpl < 120 ? 'tag-blue' : cpl < 150 ? 'tag-purple' : 'tag-red'; return (
                    <tr key={g}><td style={{fontWeight:600}}>{genderLabel(g)}</td><td>{gPill('clicks',d.clicks,formatNum(d.clicks))}</td><td>{gPill('impressions',d.impressions,formatNum(d.impressions))}</td><td>{gPill('cpc',cpc,formatCurrency(cpc))}</td><td>{gPill('ctr',ctr,ctr.toFixed(2)+'%')}</td><td>{gPill('cpm',cpm,formatCurrency(cpm))}</td><td>{gPill('leads',d.leads,String(d.leads))}</td><td><span className={`cpl-tag ${cplClass}`}>{formatCurrency(cpl)}</span></td><td>{formatCurrency(d.spend)}</td></tr>);});
                })()}
              </tbody></table>
            </div></div>
          </div>);
        })()}
          </div>
          <div style={{flex:1,minWidth:0}}>
          {!isPmax && ageNames.length > 0 && (() => {
          const ad = data.ages;
          const sortedAges = ageNames.sort((a, b) => { const na = parseInt(a); const nb = parseInt(b); return na - nb; });
          return (<div>
            <h3 style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'1.05em',fontWeight:600,color:'var(--text-primary)',margin:'0 0 12px 0'}}><span style={{fontSize:'1.2em'}}>📅</span>פילוח גילאי</h3>
            <div className="card" style={{marginBottom:'20px'}}><div className="card-body" style={{overflowX:'auto'}}>
              <table className="data-table"><thead><tr>
                {[{key:'age',label:'גיל'},{key:'clicks',label:'קליקים'},{key:'impressions',label:'חשיפות'},{key:'cpc',label:'עלות לקליק'},{key:'ctr',label:'CTR'},{key:'cpm',label:'CPM'},{key:'leads',label:'לידים'},{key:'cpl',label:'עלות לליד'},{key:'spend',label:'תקציב שנוצל'}].map(c=>(<th key={c.key} style={{cursor:'pointer',userSelect:'none',whiteSpace:'nowrap'}} onClick={()=>handleSort('ages',c.key)}>{c.label}{(()=>{const s=sortConfig['ages'];if(!s||s.key!==c.key)return ' ⇅';return s.dir==='desc'?' ▼':' ▲';})()}</th>))}
              </tr></thead><tbody>
                {(()=>{const ageCols={age:{get:(d,n)=>n},clicks:{get:d=>d.clicks,higher:true},impressions:{get:d=>d.impressions,higher:true},cpc:{get:d=>d.clicks>0?d.spend/d.clicks:0,higher:false},ctr:{get:d=>d.impressions>0?(d.clicks/d.impressions*100):0,higher:true},cpm:{get:d=>d.impressions>0?(d.spend/d.impressions*1000):0,higher:false},leads:{get:d=>d.leads,higher:true},cpl:{get:d=>d.leads>0?d.spend/d.leads:0,higher:false},spend:{get:d=>d.spend}};const sc=sortConfig['ages'];let sorted=[...sortedAges];if(sc&&ageCols[sc.key]){sorted.sort((a,b)=>{const va=ageCols[sc.key].get(ad[a],a),vb=ageCols[sc.key].get(ad[b],b);if(typeof va==='string')return sc.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);return sc.dir==='asc'?va-vb:vb-va;});}const ageExtremes={};Object.keys(ageCols).forEach(k=>{if(k==='age'||k==='spend')return;const c=ageCols[k];const vals=sorted.map(a=>c.get(ad[a],a)).filter(v=>typeof v==='number'&&v>0);if(vals.length<2)return;ageExtremes[k]={min:Math.min(...vals),max:Math.max(...vals)};});const agePill=(key,val,display)=>{const e=ageExtremes[key];if(!e||val<=0||e.min===e.max)return display;const c=ageCols[key];if(!c||c.higher===undefined)return display;const isGood=(val===e.max&&c.higher)||(val===e.min&&!c.higher);const isBad=(val===e.max&&!c.higher)||(val===e.min&&c.higher);if(!isGood&&!isBad)return display;const bg=isGood?'rgba(16,185,129,0.13)':'rgba(239,68,68,0.10)';const col=isGood?'#059669':'#dc2626';return <span style={{background:bg,color:col,fontWeight:800,borderRadius:'999px',padding:'2px 9px',display:'inline-block',whiteSpace:'nowrap'}}>{display}</span>;};return sorted.map(age => { const d = ad[age]; const cpl = d.leads > 0 ? d.spend / d.leads : 0; const cpc = d.clicks > 0 ? d.spend / d.clicks : 0; const ctr = d.impressions > 0 ? (d.clicks / d.impressions * 100) : 0; const conv = d.clicks > 0 ? (d.leads / d.clicks * 100) : 0; const cpm = d.impressions > 0 ? (d.spend / d.impressions * 1000) : 0; const cplClass = cpl > 0 && cpl < 80 ? 'tag-green' : cpl < 120 ? 'tag-blue' : cpl < 150 ? 'tag-purple' : 'tag-red'; return (
                  <tr key={age}><td style={{fontWeight:600}}>{age}</td><td>{agePill('clicks',d.clicks,formatNum(d.clicks))}</td><td>{agePill('impressions',d.impressions,formatNum(d.impressions))}</td><td>{agePill('cpc',cpc,formatCurrency(cpc))}</td><td>{agePill('ctr',ctr,ctr.toFixed(2)+'%')}</td><td>{agePill('cpm',cpm,formatCurrency(cpm))}</td><td>{agePill('leads',d.leads,String(d.leads))}</td><td><span className={`cpl-tag ${cplClass}`}>{formatCurrency(cpl)}</span></td><td>{formatCurrency(d.spend)}</td></tr>);});})()}
              </tbody></table>
            </div></div>
            {dashTab !== 'all' && dashTab !== 'facebook' && (<>
            <div className="chart-grid">
              <div className="chart-card"><h4>{'\u05d4\u05d5\u05e6\u05d0\u05d4 \u05d5\u05dc\u05d9\u05d3\u05d9\u05dd'}</h4><div className="chart-container"><canvas id="ageSpendLeads"></canvas></div></div>
              <div className="chart-card"><h4>{'\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05d3 (CPL)'}</h4><div className="chart-container"><canvas id="ageCPL"></canvas></div></div>
            </div>
            <div className="chart-grid">
              <div className="chart-card"><h4>CTR \u05d1\u05d0\u05d7\u05d5\u05d6 \u05d4\u05de\u05e8\u05d4</h4><div className="chart-container"><canvas id="ageRates"></canvas></div></div>
              <div className="chart-card"><h4>CPM</h4><div className="chart-container"><canvas id="ageCPM"></canvas></div></div>
            </div>
            </>)}
          </div>);
        })()}
          </div>
        </div>
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
            <div className="section section-top-ads">
              <div className="section-head">
                <div className="ico violet"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="8 6 2 6 2 12 8 12"/><polyline points="16 6 22 6 22 12 16 12"/><path d="M12 19v-7"/><path d="M8 19h8"/><path d="M8 12c0 2.21 1.79 4 4 4s4-1.79 4-4V6H8v6z"/></svg></div>
                <h2>המודעות הכי מובילות ב-Facebook</h2>
                <span className="sub">Top {topAds.length}</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))',gap:'20px'}}>
                {topAds.map((ad, i) => {
                  const metrics = ad.metrics || {};
                  const cpl = metrics.leads > 0 ? metrics.spend / metrics.leads : 0;
                  const hasVideo = Boolean(ad.videoUrl);
                  const previewImg = ad.imageUrl || ad.thumbnailUrl;
                  const demoBlur = isDemoProject ? {filter:'blur(8px)'} : undefined;
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
                          <div>{'\ud83d\udcca'} {ad.campaign || '-'}</div>
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
            <div className="section section-asset-gallery">
              <div className="section-head"><div className="ico amber"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div><h2>קמפיינים Google Search</h2></div>
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
                        <div style={{fontSize:'0.72em',color:'#94a3b8',unicodeBidi:'plaintext'}}>{'\ud83d\udcca'} {ag.campaign || '-'}</div>
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

        </>)}
      </>
    );
  }, [selectedMonth, compareEnabled, reports, dashTab, crmSubTab, cityMetric, recSubTab, vitasTasks, lockingRecKey, ruleDialog, creatingRule, renderCrmDashboard, renderCrmReportDashboard, renderCrmObjectionsDashboard, renderCrmResponseDashboard, sortConfig, expandedCampaigns, expandedAdSets, expandedCrmSources]);

  if (loading && !isClientView) return <div className="loading-page">{'\u05d8\u05d5\u05e2\u05df...'}</div>;

  if (!session && !isClientView) {
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
          <p style={{textAlign: 'center', marginTop: 15, fontSize: '0.85em', color: 'var(--text-secondary)'}}><span style={{cursor: 'pointer', color: 'var(--accent)'}} onClick={() => setIsSignUp(!isSignUp)}>{isSignUp ? '\u05d9\u05e9 \u05dc\u05d9 \u05d7\u05e9\u05d1\u05d5\u05df - \u05db\u05e0\u05d9\u05e1\u05d4' : '\u05de\u05e9\u05ea\u05de\u05e9 \u05d7\u05d3\u05e9 - \u05d4\u05e8\u05e9\u05de\u05d4'}</span></p>
        </div>
      </div>
    );
  }

  const getClientProjects = (clientId) => {
    const client = clients.find(c => c.id === clientId);
    return client?.projects || [];
  };

  // ── Demo mode detection ─────────────────────────────────────────────────────
  const isDemoProject = !!(selectedProject?.is_demo)

  // ── visibleClients: filter by allowedProjectIds in client view ──────────
  const visibleClients = (isClientView && allowedProjectIds)
    ? clients
        .map(c => ({ ...c, projects: (c.projects || []).filter(p => allowedProjectIds.includes(p.id)) }))
        .filter(c => c.projects.length > 0)
    : clients;

  return (
    <div dir="rtl" style={{direction:'rtl',textAlign:'right'}}>
      {refreshing && (() => {
        // elapsed only — no estimated time


        return (
          <div style={{position:'fixed',top:0,left:0,right:0,zIndex:9999,background:'linear-gradient(135deg, rgba(59,130,246,0.95), rgba(139,92,246,0.95))',color:'white',padding:'14px 24px',boxShadow:'0 4px 20px rgba(0,0,0,0.3)',backdropFilter:'blur(10px)'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:'18px',flexWrap:'wrap',maxWidth:'1200px',margin:'0 auto'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{width:'22px',height:'22px',border:'3px solid rgba(255,255,255,0.25)',borderTopColor:'#ffffff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}></div>
                <div style={{fontWeight:700,fontSize:'1em'}}>{'\ud83d\udd04 \u05de\u05d5\u05e9\u05da \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05d7\u05d9\u05d9\u05dd \u05de-Facebook \u05d5-Google...'}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'14px',fontSize:'0.9em'}}>
                <div style={{background:'rgba(255,255,255,0.2)',padding:'4px 12px',borderRadius:'20px',fontWeight:600}}>{'\u05d7\u05dc\u05e3: '}{refreshElapsed}{'s'}</div>

              </div>
            </div>
            <div style={{marginTop:'10px',maxWidth:'600px',margin:'10px auto 0',height:'4px',background:'rgba(255,255,255,0.2)',borderRadius:'2px',overflow:'hidden'}}>
              <div style={{width:'40%',height:'100%',background:'white',animation:'loadingSlide 1.5s ease-in-out infinite',boxShadow:'0 0 10px rgba(255,255,255,0.6)'}}></div>
            </div>
          </div>
        );
      })()}
      <style jsx>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes loadingSlide{0%{margin-right:-40%} 100%{margin-right:100%}} @keyframes loadingSlide{0%{transform:translateX(-150%)} 100%{transform:translateX(300%)}}`}</style>
      <div className={`sidebar-overlay${sidebarOpen ? ' active' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      <Header
        onMenuOpen={() => setSidebarOpen(true)}
        onExport={!isClientView && !isDemoProject ? handleExport : undefined}
        onClientAccess={!isClientView ? handleClientAccess : undefined}
        onSessionLogs={!isClientView ? handleSessionLogs : undefined}
        onLogout={handleLogout}
        loadingIndicator={(refreshing || refreshingCrm) ? (
          <div style={{display:'inline-flex',alignItems:'center',gap:8,padding:'6px 12px',background:'rgba(99,102,241,0.1)',borderRadius:20,color:'var(--accent)',fontWeight:600,fontSize:13}}>
            <span style={{display:'inline-block',width:12,height:12,border:'2px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
            {refreshingCrm ? 'מושך CRM...' : 'מושך נתונים...'}
          </div>
        ) : null}
      />

      <div className="app-layout">
        <Sidebar
          clients={visibleClients}
          activeClient={selectedClient?.name}
          activeProject={selectedProject?.name}
          onSelectClient={(client) => { setSelectedClient(client); setSelectedProject(null); setView('welcome'); }}
          onSelectProject={(client, project) => { selectProject(client, project); setSidebarOpen(false); }}
          onAddClient={!isClientView ? () => setShowAddClient(true) : undefined}
          onAddProject={!isClientView ? () => setShowAddProject(true) : undefined}
          footerText="VITAS Reports v3.2"
          lockedProjects={['REHAVIA']}
          demoProjects={clients.flatMap(c=>(c.projects||[]).filter(p=>p.is_demo).map(p=>p.name))}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onExport={!isClientView && !isDemoProject ? handleExport : undefined}
          onClientAccess={!isClientView ? handleClientAccess : undefined}
        />

        <div className="main-content">
          {view === 'welcome' && (<div className="welcome-center"><div className="icon">{'\ud83d\udcca'}</div><h2>{'\u05d1\u05e8\u05d5\u05db\u05d9\u05dd \u05d4\u05d1\u05d0\u05d9\u05dd'}</h2><p>{'\u05d1\u05d7\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05de\u05d4\u05ea\u05e4\u05e8\u05d9\u05d8 \u05db\u05d3\u05d9 \u05dc\u05e6\u05e4\u05d5\u05ea \u05d1\u05d3\u05d5\u05d7, \u05d0\u05d5 \u05d4\u05e2\u05dc\u05d4 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05d7\u05d3\u05e9\u05d9\u05dd'}</p></div>)}

          {view === 'dashboard' && selectedProject && (<>
                        {isDemoProject && (
              <div style={{background:'linear-gradient(135deg,#4338ca,#6366f1)',color:'white',padding:'8px 20px',fontSize:13,fontWeight:700,textAlign:'center',letterSpacing:'0.04em'}}>
                🎯 מצב הדגמה — הנתונים בדויים לצורך הצגה בלבד
              </div>
            )}
            <TitleBar
              crumb={['סקירה', selectedProject?.name || '', '']}
              client={isDemoProject ? DEMO_CLIENT_NAME : selectedClient?.name}
              project={isDemoProject ? DEMO_PROJECT_NAME : selectedProject?.name}
              activePreset={activePreset}
              since={customSince}
              until={customUntil}
              onApplyPreset={applyPreset}
              onApplyRange={applyCustomRange}
              comparisonOn={compareEnabled}
              onToggleComparison={() => onComparisonToggle(!compareEnabled)}
            />
            {reports.length === 0 ? ((refreshing || refreshingCrm) ? <SkeletonDashboard /> : <div className="welcome-center"><div className="icon">{'\ud83d\udced'}</div><h3>{'\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05e2\u05d3\u05d9\u05d9\u05df'}</h3><p style={{marginTop:10,color:'var(--text-secondary)'}}>{'\u05dc\u05d7\u05e5 \u05e2\u05dc \u05db\u05e4\u05ea\u05d5\u05e8 \u05d4\u05e8\u05e2\u05e0\u05d5\u05df \u05dc\u05de\u05e9\u05d9\u05db\u05ea \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd'}</p></div>) : renderDashboard()}
          </>)}

          
        </div>
      </div>

      <div className={`modal-overlay ${showAddClient ? 'active' : ''}`} onClick={e => { if (e.target === e.currentTarget) setShowAddClient(false); }}><div className="modal"><h3>{'\u05d4\u05d5\u05e1\u05e3 \u05dc\u05e7\u05d5\u05d7 \u05d7\u05d3\u05e9'}</h3><div className="form-group"><label>{'\u05e9\u05dd \u05dc\u05e7\u05d5\u05d7'}</label><input className="form-input" value={newClientName} onChange={e => setNewClientName(e.target.value)} placeholder={'\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: \u05e9.\u05d1\u05e8\u05d5\u05dc'} /></div><div className="form-group"><label>{'\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8\u05d9\u05dd (\u05de\u05d5\u05e4\u05e8\u05d3\u05d9\u05dd \u05d1\u05e4\u05e1\u05d9\u05e7\u05d9\u05dd)'}</label><input className="form-input" value={newClientProjects} onChange={e => setNewClientProjects(e.target.value)} placeholder={'\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: HI PARK, ONCE'} /></div><div className="form-group"><label>{'\u05e6\u05d1\u05e2'}</label><select className="form-input" value={newClientColor} onChange={e => setNewClientColor(e.target.value)}><option value="#3b82f6">{'\u05db\u05d7\u05d5\u05dc'}</option><option value="#10b981">{'\u05d9\u05e8\u05d5\u05e7'}</option><option value="#8b5cf6">{'\u05e1\u05d2\u05d5\u05dc'}</option><option value="#f59e0b">{'\u05db\u05ea\u05d5\u05dd'}</option><option value="#ec4899">{'\u05d5\u05e8\u05d5\u05d3'}</option></select></div><div className="modal-actions"><button className="btn btn-primary" onClick={addClient}>{'\u05d4\u05d5\u05e1\u05e3'}</button><button className="btn btn-outline" onClick={() => setShowAddClient(false)}>{'\u05d1\u05d9\u05d8\u05d5\u05dc'}</button></div></div></div>

      <div className={`modal-overlay ${showAddProject ? 'active' : ''}`} onClick={e => { if (e.target === e.currentTarget) setShowAddProject(false); }}><div className="modal"><h3>{'\u05d4\u05d5\u05e1\u05e3 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05dc-'}{selectedClient?.name}</h3><div className="form-group"><label>{'\u05e9\u05dd \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8'}</label><input className="form-input" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder={'\u05dc\u05d3\u05d5\u05d2\u05de\u05d4: HI PARK'} /></div><div className="modal-actions"><button className="btn btn-primary" onClick={addProject}>{'\u05d4\u05d5\u05e1\u05e3'}</button><button className="btn btn-outline" onClick={() => setShowAddProject(false)}>{'\u05d1\u05d9\u05d8\u05d5\u05dc'}</button></div></div></div>

      {showClientAccess && (
        <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) setShowClientAccess(false); }}>
          <div className="modal" style={{maxWidth:560,width:'100%',direction:'rtl',maxHeight:'80vh',overflow:'auto'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
              <h3 style={{margin:0,fontSize:17,fontWeight:700}}>👥 ניהול גישת לקוחות</h3>
              <button onClick={() => setShowClientAccess(false)} style={{background:'none',border:'none',cursor:'pointer',fontSize:22,color:'#64748b'}}>&times;</button>
            </div>
            <p style={{fontSize:13,color:'var(--text-secondary)',marginBottom:16,lineHeight:1.6}}>
              הוסף מייל של איש קשר וקשר אותו ללקוח. הוא יוכל להיכנס ל-<strong>reports.vitas.co.il/client</strong> עם קישור קסם ויראה את <strong>כל הפרויקטים</strong> של אותו לקוח.
            </p>

            {/* Add form */}
            <div style={{background:'var(--surface)',borderRadius:12,padding:'16px',marginBottom:20,display:'flex',flexDirection:'column',gap:10}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <label style={{fontSize:12,fontWeight:600,color:'var(--text-secondary)',display:'block',marginBottom:4}}>מייל איש קשר</label>
                  <input className="form-input" type="email" value={caEmail} onChange={e => setCaEmail(e.target.value)}
                    placeholder="client@example.com" style={{direction:'ltr',textAlign:'left'}} />
                </div>
                <div>
                  <label style={{fontSize:12,fontWeight:600,color:'var(--text-secondary)',display:'block',marginBottom:4}}>לקוח</label>
                  <select className="form-input" value={caClientId} onChange={e => setCaClientId(e.target.value)}>
                    <option value="">-- בחר לקוח --</option>
                    {clients.map(cl => (
                      <option key={cl.id} value={cl.id}>{cl.name} ({(cl.projects||[]).length} פרויקטים)</option>
                    ))}
                  </select>
                </div>
              </div>
              <button className="btn btn-primary" onClick={addClientAccess} disabled={caSaving || !caEmail || !caClientId}
                style={{alignSelf:'flex-end',padding:'8px 20px'}}>
                {caSaving ? 'שומר...' : '+ הוסף גישה ושלח קישור'}
              </button>
            </div>

            {/* List — grouped by email + client */}
            {(() => {
              // Group rows: email → clientId → rows[]
              const groups = {}
              clientAccessList.forEach(ca => {
                const cid = ca.projects?.client_id || 'unknown'
                const key = ca.email + '|||' + cid
                if (!groups[key]) groups[key] = { email: ca.email, clientId: cid, clientName: ca.projects?.clients?.name || '—', rows: [] }
                groups[key].rows.push(ca)
              })
              const entries = Object.values(groups)
              if (!entries.length) return <div style={{textAlign:'center',padding:'24px 0',color:'var(--text-secondary)',fontSize:13}}>אין גישות מוגדרות עדיין</div>
              return (
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--border)'}}>
                      <th style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:'var(--text-secondary)',fontSize:12}}>מייל</th>
                      <th style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:'var(--text-secondary)',fontSize:12}}>לקוח</th>
                      <th style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:'var(--text-secondary)',fontSize:12}}>פרויקטים</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(g => (
                      <tr key={g.email + g.clientId} style={{borderBottom:'1px solid var(--surface)'}}>
                        <td style={{padding:'10px',direction:'ltr',textAlign:'left',fontFamily:'monospace',fontSize:12}}>{g.email}</td>
                        <td style={{padding:'10px',fontWeight:700,color:'var(--text)'}}>{g.clientName}</td>
                        <td style={{padding:'10px'}}>
                          <span style={{display:'inline-flex',alignItems:'center',gap:5,background:'var(--indigo-50,rgba(91,94,244,0.08))',color:'var(--indigo)',borderRadius:20,padding:'3px 10px',fontSize:12,fontWeight:600}}>
                            {g.rows.length} פרויקטים
                          </span>
                        </td>
                        <td style={{padding:'10px',textAlign:'center'}}>
                          <button onClick={() => deleteClientAccess(g.email, g.clientId)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--danger)',fontSize:16,padding:'2px 6px'}} title="מחק גישה">🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()}

            <div style={{marginTop:20,padding:'12px',background:'#eff6ff',borderRadius:8,fontSize:12,color:'#1e40af',lineHeight:1.6}}>
              <strong>קישור לדאשבורד לקוח:</strong>{' '}
              <span style={{direction:'ltr',display:'inline-block'}}>{typeof window !== 'undefined' ? window.location.origin : ''}/client</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Session Logs Modal ── */}
      {showSessionLogs && (
        <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) setShowSessionLogs(false) }}>
          <div className="modal" style={{maxWidth:700,width:'100%',direction:'rtl',maxHeight:'80vh',overflow:'auto'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
              <h3 style={{margin:0,fontSize:17,fontWeight:700}}>👁 לוג כניסות לקוחות</h3>
              <button onClick={() => setShowSessionLogs(false)} style={{background:'none',border:'none',cursor:'pointer',fontSize:22,color:'#64748b'}}>&times;</button>
            </div>
            {logsLoading ? (
              <div style={{textAlign:'center',padding:'32px 0',color:'var(--text-secondary)'}}>טוען...</div>
            ) : sessionLogs.length === 0 ? (
              <div style={{textAlign:'center',padding:'32px 0',color:'var(--text-secondary)',fontSize:13}}>אין כניסות מתועדות עדיין</div>
            ) : (
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:'2px solid var(--border)'}}>
                    <th style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:'var(--text-secondary)',fontSize:12}}>מייל</th>
                    <th style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:'var(--text-secondary)',fontSize:12}}>לקוח</th>
                    <th style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:'var(--text-secondary)',fontSize:12}}>כניסה</th>
                    <th style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:'var(--text-secondary)',fontSize:12}}>זמן בדשבורד</th>
                    <th style={{padding:'8px 10px',textAlign:'right',fontWeight:600,color:'var(--text-secondary)',fontSize:12}}>סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionLogs.map(s => {
                    const mins = Math.floor((s.durSec || 0) / 60)
                    const secs = (s.durSec || 0) % 60
                    const dur = s.durSec > 0 ? `${mins}:${String(secs).padStart(2,'0')}` : '—'
                    const loginTime = new Date(s.logged_in_at).toLocaleString('he-IL', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})
                    return (
                      <tr key={s.id} style={{borderBottom:'1px solid var(--surface)'}}>
                        <td style={{padding:'10px',direction:'ltr',textAlign:'left',fontFamily:'monospace',fontSize:12}}>{s.email}</td>
                        <td style={{padding:'10px',fontWeight:600}}>{s.client_name || '—'}</td>
                        <td style={{padding:'10px',color:'var(--text-secondary)',fontSize:12}}>{loginTime}</td>
                        <td style={{padding:'10px',fontWeight:600,color:'var(--indigo,#5B5EF4)'}}>{dur}</td>
                        <td style={{padding:'10px',fontSize:12,color:'var(--text-secondary)'}}>{s.selected_project || '—'}</td>
                        <td style={{padding:'10px'}}>
                          {s.isActive
                            ? <span style={{background:'rgba(16,185,129,0.12)',color:'#059669',borderRadius:20,padding:'3px 10px',fontSize:12,fontWeight:600}}>● פעיל כעת</span>
                            : <span style={{background:'var(--surface)',color:'var(--text-secondary)',borderRadius:20,padding:'3px 10px',fontSize:12}}>יצא</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <div style={{marginTop:16,fontSize:12,color:'var(--text-secondary)',textAlign:'center'}}>
              מציג {sessionLogs.length} כניסות אחרונות · "פעיל" = heartbeat לפני פחות מ-3 דקות
            </div>
          </div>
        </div>
      )}

      {namedLeadsModal && (
        <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) setNamedLeadsModal(null); }} style={{zIndex:9999}}>
          <div className="modal" style={{maxWidth:420,maxHeight:'75vh',display:'flex',flexDirection:'column',direction:'rtl'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
              <h3 style={{margin:0,fontSize:16,fontWeight:700}}>{namedLeadsModal.title}</h3>
              <button onClick={() => setNamedLeadsModal(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,lineHeight:1,color:'#64748b',padding:'0 4px'}}>&times;</button>
            </div>
            {namedLeadsModal.names.length === 0 ? (
              <p style={{color:'#94a3b8',textAlign:'center',margin:'24px 0'}}>אין נתונים להצגה</p>
            ) : (
              <ul style={{margin:0,padding:0,listStyle:'none',overflowY:'auto',flex:1}}>
                {namedLeadsModal.names.map((name, i) => (
                  <li key={i} style={{padding:'9px 12px',borderBottom:'1px solid var(--border)',fontSize:14,display:'flex',alignItems:'center',gap:10}}>
                    <span style={{width:22,height:22,borderRadius:'50%',background:'var(--indigo-50)',color:'var(--indigo)',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</span>
                    {name}
                  </li>
                ))}
              </ul>
            )}
            <div style={{marginTop:14,textAlign:'left'}}>
              <span style={{fontSize:12,color:'#94a3b8'}}>{namedLeadsModal.names.length} רשומות</span>
            </div>
          </div>
        </div>
      )}

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
