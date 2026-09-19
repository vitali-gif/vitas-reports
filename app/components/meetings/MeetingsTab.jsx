'use client';

/**
 * app/components/meetings/MeetingsTab.jsx — טאב "ישיבות שיווק" (שלב 1).
 *
 * הפיצ'ר יושב כאן ולא ב-app/admin/page.js בכוונה: START-HERE-CLAUDE.md מבקש במפורש לא
 * להגדיל עוד את המונולית. הטאב מקבל projectId ו-isClientView, וכל השאר מקומי.
 *
 * ═══ מה שלב 1 כולל ומה לא ═══
 * כולל: רשימת ישיבות, יצירת טיוטה, העלאת תמלול, סיכום ידני, אישור, משימות ושליחה במייל.
 * לא כולל: יומנים, Meet/Teams/Zoom, וסיכום AI. אלה שלבים 2–5, ואין כאן שום כפתור שמתחזה
 * להם — לפי ACCEPTANCE.md, יכולת שלא נבדקה אינה מוצגת כפעילה.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../../lib/api-fetch';
import {
  CalendarDays, Plus, ArrowRight, Upload, FileText, CheckCircle2, AlertCircle,
  Trash2, Send, Loader2, ClipboardList, Users, Clock,
} from 'lucide-react';

const fmtDate = (iso, tz = 'Asia/Jerusalem') => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('he-IL', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch { return '—'; }
};
const todayIL = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

/** שדה טקסט־רב־שורות שכל שורה בו היא פריט. פשוט יותר מעורך רשימות, וקל להדביק לתוכו. */
function ListEditor({ label, hint, value, onChange, rows = 4 }) {
  return (
    <label className="vmeet-field">
      <span className="vmeet-label">{label}</span>
      {hint && <span className="vmeet-hint">{hint}</span>}
      <textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} dir="rtl" />
    </label>
  );
}
const linesToItems = (s) => String(s || '').split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text }));
const itemsToLines = (arr) => (arr || []).map(i => i?.text || '').join('\n');

// ═══════════════════════════════════════════════════════════════════════════
// מסך 1 — רשימת הישיבות
// ═══════════════════════════════════════════════════════════════════════════
function MeetingsList({ data, onOpen, onNew, canEdit }) {
  const { meetings = [], dueForReview = [], openTasks = [] } = data || {};
  const [showTasks, setShowTasks] = useState(false);
  const upcoming = meetings.find(m => m.start_at && new Date(m.start_at) >= new Date() && m.status !== 'cancelled');
  const past = meetings.filter(m => m !== upcoming);

  return (
    <div className="vmeet-root">
      <div className="vmeet-head">
        <div>
          <h2>ישיבות שיווק ומכירות</h2>
          <p>כל ההחלטות, המשימות והמעקב במקום אחד</p>
        </div>
        {canEdit && <button type="button" className="vmeet-btn vmeet-btn-primary" onClick={onNew}><Plus size={18} aria-hidden="true" />ישיבה חדשה</button>}
      </div>

      {(dueForReview.length > 0 || openTasks.length > 0) && (
        <div className="vmeet-banner">
          <AlertCircle size={20} aria-hidden="true" />
          <div>
            <strong>{dueForReview.length > 0 ? 'משימות לבדיקה בישיבה הבאה' : 'משימות פתוחות'}</strong>
            <span>{dueForReview.length > 0
              ? `${dueForReview.length} משימות שהגיע מועד הבדיקה שלהן`
              : `${openTasks.length} משימות פתוחות מישיבות קודמות`}</span>
          </div>
          <button type="button" className="vmeet-btn" onClick={() => setShowTasks(v => !v)}>
            {showTasks ? 'הסתרת המשימות' : 'הצגת המשימות'}
          </button>
        </div>
      )}

      {showTasks && (
        <div className="vmeet-panel">
          <table className="vmeet-table">
            <thead><tr><th>משימה</th><th>אחראי</th><th>עד תאריך</th><th>מועד בדיקה</th><th>סטטוס</th></tr></thead>
            <tbody>
              {openTasks.map(t => (
                <tr key={t.id}>
                  <td>{t.title}</td>
                  <td>{t.assignee_email || t.assignee_label || <em className="vmeet-todo">להשלמה</em>}</td>
                  <td>{t.due_at || <em className="vmeet-todo">להשלמה</em>}</td>
                  <td>{t.review_at || '—'}</td>
                  <td>{t.status === 'needs_details' ? <em className="vmeet-todo">דורשת השלמה</em> : t.status}</td>
                </tr>
              ))}
              {!openTasks.length && <tr><td colSpan={5} className="vmeet-empty">אין משימות פתוחות</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {upcoming && (
        <section className="vmeet-panel">
          <h3 className="vmeet-section-title"><CalendarDays size={18} aria-hidden="true" />הישיבה הקרובה</h3>
          <div className="vmeet-upcoming">
            <div className="vmeet-upcoming-title">{upcoming.title}</div>
            <dl className="vmeet-meta">
              <div><dt>מועד</dt><dd>{fmtDate(upcoming.start_at, upcoming.timezone)}</dd></div>
              <div><dt>מארגן</dt><dd>{upcoming.organizer_email}</dd></div>
              <div><dt>משימות פתוחות</dt><dd>{upcoming.openTasks}</dd></div>
            </dl>
            <div className="vmeet-actions">
              <button type="button" className="vmeet-btn" onClick={() => onOpen(upcoming.id)}><FileText size={16} aria-hidden="true" />פרטי הישיבה</button>
              {upcoming.join_url && <a className="vmeet-btn" href={upcoming.join_url} target="_blank" rel="noopener noreferrer">הצטרפות לפגישה</a>}
            </div>
          </div>
        </section>
      )}

      <section className="vmeet-panel">
        <h3 className="vmeet-section-title"><Clock size={18} aria-hidden="true" />ישיבות קודמות</h3>
        <table className="vmeet-table">
          <thead><tr><th>תאריך</th><th>ישיבה</th><th>סטטוס סיכום</th><th>משימות פתוחות</th><th>פעולה</th></tr></thead>
          <tbody>
            {past.map(m => (
              <tr key={m.id}>
                <td>{m.start_at ? fmtDate(m.start_at, m.timezone) : <em className="vmeet-todo">ללא מועד</em>}</td>
                <td>{m.title}</td>
                <td>
                  {m.summaryStatus === 'approved' ? <span className="vmeet-chip vmeet-chip-ok">אושר</span>
                    : m.summaryStatus === 'draft' ? <span className="vmeet-chip vmeet-chip-warn">טיוטה לאישור</span>
                    : <span className="vmeet-chip">אין סיכום</span>}
                </td>
                <td>{m.openTasks}</td>
                <td><button type="button" className="vmeet-btn vmeet-btn-sm" onClick={() => onOpen(m.id)}>פתיחת סיכום</button></td>
              </tr>
            ))}
            {!past.length && <tr><td colSpan={5} className="vmeet-empty">עוד לא נוצרו ישיבות</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// מסך 2 — ישיבה חדשה
// ═══════════════════════════════════════════════════════════════════════════
function MeetingForm({ projectId, onCancel, onCreated }) {
  const [f, setF] = useState({ title: '', date: todayIL(), start: '10:00', end: '11:00', agenda: '', joinUrl: '' });
  const [invitees, setInvitees] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setErr('');
    if (!f.title.trim()) { setErr('חסרה כותרת לישיבה'); return; }
    if (f.date && f.start && f.end && f.start >= f.end) { setErr('שעת הסיום חייבת להיות אחרי שעת ההתחלה'); return; }
    setBusy(true);
    try {
      const body = {
        projectId, title: f.title, agenda: f.agenda, joinUrl: f.joinUrl || null, timezone: 'Asia/Jerusalem',
        startAt: f.date && f.start ? `${f.date}T${f.start}:00+03:00` : null,
        endAt: f.date && f.end ? `${f.date}T${f.end}:00+03:00` : null,
        invitees: invitees.split('\n').map(l => l.trim()).filter(Boolean).map(line => (
          line.includes('@') ? { email: line } : { roleLabel: line }
        )),
      };
      const res = await apiFetch('/api/meetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onCreated(j.meeting.id);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="vmeet-root">
      <div className="vmeet-head">
        <div><h2>ישיבה חדשה</h2><p>שמירת טיוטה אינה שולחת הזמנות ואינה יוצרת אירוע ביומן</p></div>
        <button type="button" className="vmeet-btn" onClick={onCancel}><ArrowRight size={16} aria-hidden="true" />חזרה לרשימה</button>
      </div>

      <div className="vmeet-panel">
        <div className="vmeet-grid">
          <label className="vmeet-field vmeet-span2"><span className="vmeet-label">כותרת הישיבה</span>
            <input type="text" value={f.title} onChange={set('title')} dir="rtl" placeholder="ישיבת שיווק חודשית" /></label>
          <label className="vmeet-field"><span className="vmeet-label">תאריך</span>
            <input type="date" value={f.date} onChange={set('date')} /></label>
          <label className="vmeet-field"><span className="vmeet-label">שעת התחלה</span>
            <input type="time" value={f.start} onChange={set('start')} /></label>
          <label className="vmeet-field"><span className="vmeet-label">שעת סיום</span>
            <input type="time" value={f.end} onChange={set('end')} /></label>
          <label className="vmeet-field"><span className="vmeet-label">אזור זמן</span>
            <input type="text" value="שעון ישראל" readOnly /></label>
        </div>

        <ListEditor label="מוזמנים" rows={4} value={invitees} onChange={setInvitees}
          hint="שורה לכל מוזמן. כתובת אימייל תישלח אליה סיכום; תפקיד בלי כתובת יסומן להשלמה ולא יישלח לאיש." />
        <ListEditor label="סדר יום" rows={4} value={f.agenda} onChange={(v) => setF(p => ({ ...p, agenda: v }))} />
        <label className="vmeet-field"><span className="vmeet-label">קישור לפגישה (אופציונלי)</span>
          <input type="url" value={f.joinUrl} onChange={set('joinUrl')} dir="ltr" placeholder="https://" /></label>

        <div className="vmeet-note">
          <AlertCircle size={16} aria-hidden="true" />
          חיבור יומן ויצירת פגישה אוטומטית עדיין אינם זמינים. אפשר להדביק כאן קישור לפגישה שנוצרה ביומן שלך.
        </div>

        {err && <div className="vmeet-error" role="alert">{err}</div>}
        <div className="vmeet-actions vmeet-actions-end">
          <button type="button" className="vmeet-btn" onClick={onCancel}>ביטול</button>
          <button type="button" className="vmeet-btn vmeet-btn-primary" onClick={save} disabled={busy}>
            {busy ? <Loader2 size={16} className="vmeet-spin" aria-hidden="true" /> : null}שמירת טיוטה
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// מסך 3 — סיכום, משימות ואישור
// ═══════════════════════════════════════════════════════════════════════════
function MeetingDetail({ meetingId, onBack, canEdit, reload }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ keyPoints: '', decisions: '', openQuestions: '' });
  const [tasks, setTasks] = useState([]);
  const [recipients, setRecipients] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const res = await apiFetch(`/api/meetings/${meetingId}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setD(j);
      const s = j.currentSummary;
      setForm({ keyPoints: itemsToLines(s?.key_points), decisions: itemsToLines(s?.decisions), openQuestions: itemsToLines(s?.open_questions) });
      setTasks((j.tasks || []).map(t => ({ ...t })));
      setRecipients((j.invitees || []).map(i => i.email).filter(Boolean).join('\n'));
    } catch (e) { setErr(e.message || String(e)); }
  }, [meetingId]);

  useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    setBusy('upload'); setErr('');
    try {
      const content = await file.text();
      const res = await apiFetch(`/api/meetings/${meetingId}/transcript`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, filename: file.name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      if (j.duplicate) setErr('הקובץ הזה כבר הועלה לישיבה — לא נוצרו מקטעים כפולים.');
      await load();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };

  const saveDraft = async () => {
    setBusy('draft'); setErr('');
    try {
      const res = await apiFetch(`/api/meetings/${meetingId}/summary`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyPoints: linesToItems(form.keyPoints),
          decisions: linesToItems(form.decisions),
          openQuestions: linesToItems(form.openQuestions),
          tasks: tasks.filter(t => t.status === 'proposed' || !t.id).map(t => ({
            title: t.title, description: t.description, assigneeEmail: t.assignee_email,
            assigneeLabel: t.assignee_label, dueAt: t.due_at, reviewAt: t.review_at, humanAdded: true,
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setD(j); setTasks((j.tasks || []).map(t => ({ ...t })));
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(''); }
  };

  const approve = async () => {
    const version = d?.currentSummary?.version;
    if (!version) { setErr('אין טיוטת סיכום לאישור. שמור טיוטה קודם.'); return; }
    setBusy('approve'); setErr('');
    try {
      const res = await apiFetch(`/api/meetings/${meetingId}/summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, recipients: recipients.split('\n').map(s => s.trim()).filter(Boolean) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setD(j); setTasks((j.tasks || []).map(t => ({ ...t })));
      if (j.share?.failed) setErr(`הסיכום אושר, אך ${j.share.failed} מיילים לא נשלחו${j.share.error ? ` (${j.share.error})` : ''}. אפשר לנסות שוב בלי לאשר מחדש.`);
      reload?.();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(''); }
  };

  const patchTask = (i, k, v) => setTasks(ts => ts.map((t, idx) => (idx === i ? { ...t, [k]: v } : t)));
  const addTask = () => setTasks(ts => [...ts, { title: '', status: 'proposed', assignee_email: '', due_at: '', review_at: '' }]);
  const removeTask = (i) => setTasks(ts => ts.filter((_, idx) => idx !== i));

  const saveLiveTask = async (t) => {
    setBusy('task'); setErr('');
    try {
      const res = await apiFetch(`/api/meeting-tasks/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: t.title, assigneeEmail: t.assignee_email || null, assigneeLabel: t.assignee_label || null,
          dueAt: t.due_at || null, reviewAt: t.review_at || null, status: t.status,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(''); }
  };

  if (!d) return <div className="vmeet-root"><div className="vmeet-panel">{err ? <div className="vmeet-error">{err}</div> : 'טוען…'}</div></div>;

  const m = d.meeting;
  const s = d.currentSummary;
  const approved = s?.status === 'approved';
  const transcript = (d.artifacts || []).find(a => a.kind === 'transcript');
  const incomplete = tasks.filter(t => !t.assignee_email || !t.due_at).length;

  return (
    <div className="vmeet-root">
      <div className="vmeet-head">
        <div>
          <h2>סיכום ישיבת השיווק</h2>
          <p>{m.title} · {m.start_at ? fmtDate(m.start_at, m.timezone) : 'ללא מועד'}
            {approved ? <span className="vmeet-chip vmeet-chip-ok">אושר</span> : s ? <span className="vmeet-chip vmeet-chip-warn">טיוטה לאישור</span> : null}</p>
        </div>
        <button type="button" className="vmeet-btn" onClick={onBack}><ArrowRight size={16} aria-hidden="true" />חזרה לרשימה</button>
      </div>

      {err && <div className="vmeet-error" role="alert">{err}</div>}

      <section className="vmeet-panel">
        <h3 className="vmeet-section-title"><FileText size={18} aria-hidden="true" />תמלול הישיבה</h3>
        {transcript ? (
          <p className="vmeet-ok"><CheckCircle2 size={16} aria-hidden="true" />
            {transcript.filename || 'תמלול'} · {transcript.segment_count} מקטעים</p>
        ) : (
          <p className="vmeet-hint">אין עדיין תמלול. איסוף אוטומטי מהספקים אינו זמין בשלב הזה — אפשר לצרף קובץ TXT, VTT או SRT.</p>
        )}
        {canEdit && (
          <div className="vmeet-actions">
            <input ref={fileRef} type="file" accept=".txt,.vtt,.srt,text/plain" onChange={e => upload(e.target.files?.[0])} hidden id="vmeet-file" />
            <label htmlFor="vmeet-file" className="vmeet-btn">
              {busy === 'upload' ? <Loader2 size={16} className="vmeet-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
              {transcript ? 'החלפת התמלול' : 'צירוף תמלול'}
            </label>
          </div>
        )}
      </section>

      <section className="vmeet-panel">
        <h3 className="vmeet-section-title"><ClipboardList size={18} aria-hidden="true" />הסיכום</h3>
        {approved && <p className="vmeet-hint">הגרסה הזאת אושרה. עריכה תיצור גרסה חדשה ולא תדרוס את המאושרת.</p>}
        <ListEditor label="הנקודות החשובות" value={form.keyPoints} onChange={v => setForm(p => ({ ...p, keyPoints: v }))} hint="שורה לכל נקודה" />
        <ListEditor label="החלטות שהתקבלו" value={form.decisions} onChange={v => setForm(p => ({ ...p, decisions: v }))} hint="רק החלטות מפורשות, לא כל הצעה שעלתה" />
        <ListEditor label="שאלות פתוחות" value={form.openQuestions} onChange={v => setForm(p => ({ ...p, openQuestions: v }))} hint="מחלוקות ופרטים שלא הוכרעו" />
      </section>

      <section className="vmeet-panel">
        <h3 className="vmeet-section-title"><Users size={18} aria-hidden="true" />משימות</h3>
        <table className="vmeet-table vmeet-tasks">
          <thead><tr><th>משימה</th><th>אחראי (אימייל)</th><th>עד תאריך</th><th>מועד בדיקה</th><th>סטטוס</th><th /></tr></thead>
          <tbody>
            {tasks.map((t, i) => {
              const live = t.id && t.status !== 'proposed';
              return (
                <tr key={t.id || `new-${i}`}>
                  <td><input type="text" value={t.title || ''} onChange={e => patchTask(i, 'title', e.target.value)} dir="rtl" disabled={!canEdit} /></td>
                  <td><input type="email" value={t.assignee_email || ''} onChange={e => patchTask(i, 'assignee_email', e.target.value)} dir="ltr"
                    className={!t.assignee_email ? 'vmeet-incomplete' : ''} placeholder="להשלמה" disabled={!canEdit} /></td>
                  <td><input type="date" value={t.due_at || ''} onChange={e => patchTask(i, 'due_at', e.target.value)}
                    className={!t.due_at ? 'vmeet-incomplete' : ''} disabled={!canEdit} /></td>
                  <td><input type="date" value={t.review_at || ''} onChange={e => patchTask(i, 'review_at', e.target.value)} disabled={!canEdit} /></td>
                  <td>
                    {live ? (
                      <select value={t.status} onChange={e => patchTask(i, 'status', e.target.value)} disabled={!canEdit}>
                        <option value="open">לביצוע</option>
                        <option value="in_progress">בתהליך</option>
                        <option value="done">בוצע</option>
                        <option value="blocked">תקוע</option>
                        <option value="needs_details">דורשת השלמה</option>
                        <option value="cancelled">בוטלה</option>
                      </select>
                    ) : <span className="vmeet-chip">מוצעת</span>}
                  </td>
                  <td>
                    {canEdit && (live
                      ? <button type="button" className="vmeet-btn vmeet-btn-sm" onClick={() => saveLiveTask(t)} disabled={busy === 'task'}>שמירה</button>
                      : <button type="button" className="vmeet-icon-btn" onClick={() => removeTask(i)} aria-label="הסרת משימה"><Trash2 size={15} /></button>)}
                  </td>
                </tr>
              );
            })}
            {!tasks.length && <tr><td colSpan={6} className="vmeet-empty">אין משימות</td></tr>}
          </tbody>
        </table>
        {canEdit && <button type="button" className="vmeet-btn vmeet-btn-sm" onClick={addTask}><Plus size={15} aria-hidden="true" />הוספת משימה</button>}
        {incomplete > 0 && (
          <p className="vmeet-note"><AlertCircle size={16} aria-hidden="true" />
            {incomplete} משימות בלי אחראי או בלי תאריך יעד. אפשר לאשר את הסיכום, אבל הן יסומנו כדורשות השלמה ולא יישלחו לאיש.</p>
        )}
      </section>

      {canEdit && (
        <section className="vmeet-panel">
          <h3 className="vmeet-section-title"><Send size={18} aria-hidden="true" />נמעני הסיכום</h3>
          <ListEditor label="נמענים" rows={3} value={recipients} onChange={setRecipients}
            hint="שורה לכל כתובת. נשלחים הסיכום והמשימות בלבד; הקלטה ותמלול אינם מצורפים." />
          {(d.shares || []).length > 0 && (
            <p className="vmeet-hint">שליחה אחרונה: {d.shares[0].delivery_status === 'sent' ? 'נשלח' : 'נכשל'} · {d.shares[0].recipient_email}</p>
          )}
          <div className="vmeet-actions vmeet-actions-end">
            <button type="button" className="vmeet-btn" onClick={saveDraft} disabled={!!busy}>
              {busy === 'draft' ? <Loader2 size={16} className="vmeet-spin" aria-hidden="true" /> : null}שמירת טיוטה
            </button>
            <button type="button" className="vmeet-btn vmeet-btn-primary" onClick={approve} disabled={!!busy || !s}>
              {busy === 'approve' ? <Loader2 size={16} className="vmeet-spin" aria-hidden="true" /> : null}
              {approved ? 'שליחה חוזרת' : 'אישור ושליחת הסיכום'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
export default function MeetingsTab({ projectId, isClientView = false }) {
  const [view, setView] = useState({ name: 'list' });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  // בשלב 1 הלקוח צופה בלבד. מי עורך ומי מאשר ייקבע במדיניות בשלב 3, יחד עם הזהויות.
  const canEdit = !isClientView;

  const load = useCallback(async () => {
    if (!projectId) return;
    setErr('');
    try {
      const res = await apiFetch(`/api/meetings?projectId=${encodeURIComponent(projectId)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j);
    } catch (e) { setErr(e.message || String(e)); }
  }, [projectId]);

  useEffect(() => { setView({ name: 'list' }); load(); }, [load]);

  if (err && !data) return <div className="vmeet-root"><div className="vmeet-panel"><div className="vmeet-error">{err}</div></div></div>;
  if (!data) return <div className="vmeet-root"><div className="vmeet-panel">טוען…</div></div>;

  if (view.name === 'new') {
    return <MeetingForm projectId={projectId} onCancel={() => setView({ name: 'list' })}
      onCreated={(id) => { load(); setView({ name: 'detail', id }); }} />;
  }
  if (view.name === 'detail') {
    return <MeetingDetail meetingId={view.id} canEdit={canEdit} reload={load} onBack={() => { load(); setView({ name: 'list' }); }} />;
  }
  return <MeetingsList data={data} canEdit={canEdit} onNew={() => setView({ name: 'new' })} onOpen={(id) => setView({ name: 'detail', id })} />;
}
