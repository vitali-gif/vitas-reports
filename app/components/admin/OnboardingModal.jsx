'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, Circle, CircleDot, MinusCircle, ChevronDown, Sparkles, X } from 'lucide-react'
import { apiFetch } from '../../../lib/api-fetch'
import { STAGES, OWNERS, STATUSES, stepDone, onboardingSummary } from '../../../lib/onboarding-steps.js'

// "קליטת לקוחות" (ויטלי, 6.11): באיזה שלב כל פרויקט, מי אחראי על מה, ולמה כל שלב חשוב —
// כדי ששחר (השותף) יבין את התהליך ויוכל לקחת חלק. השלבים ב-lib/onboarding-steps.js, הנתונים ב-/api/onboarding.
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: '2-digit' }) : '—')
const STATUS_ICON = { done: CheckCircle2, doing: CircleDot, na: MinusCircle, todo: Circle }

function autoText(key, detail) {
  if (key === 'users') return detail.users ? `${detail.users} משתמשים עם גישה` : null
  if (key === 'history') return detail.months != null ? `${detail.months} חודשי נתונים` : null
  if (key === 'adid') return detail.adIdPct != null ? `${detail.adIdPct}% מלידי הפייסבוק עם מזהה מודעה` : 'אין עדיין נתוני CRM לפי מודעה'
  if (key === 'login') return detail.lastLogin ? `נכנס לאחרונה ${fmtDate(detail.lastLogin)}` : null
  return null
}

function Bar({ pct }) {
  return <div className="onb-bar" aria-hidden="true"><span style={{ width: `${Math.max(3, pct)}%` }} /></div>
}

function Step({ step, state, auto, detail, onSave }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(state?.note || '')
  useEffect(() => { setNote(state?.note || '') }, [state?.note])
  const done = stepDone(step, { [step.key]: state }, auto)
  const status = state?.status || (done ? 'done' : 'todo')
  const autoOk = step.auto && auto?.[step.auto]
  const Icon = STATUS_ICON[status] || Circle
  const owner = state?.owner ?? step.owner
  const at = autoText(step.auto, detail || {})
  return (
    <li className={`onb-step onb-${status}`}>
      <div className="onb-step-row">
        <button type="button" className="onb-check" title="סימון מהיר: בוצע / לא התחיל" aria-label={`${step.title}: ${STATUSES[status]}`}
          onClick={() => onSave(step.key, { status: status === 'done' ? 'todo' : 'done' })}><Icon size={20} /></button>
        <button type="button" className="onb-step-title" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span>{step.title}</span>
          {autoOk && !state?.status && <span className="onb-auto"><Sparkles size={12} aria-hidden="true" />זוהה אוטומטית</span>}
          <ChevronDown size={16} aria-hidden="true" className={open ? 'onb-chev on' : 'onb-chev'} />
        </button>
        <span className={`onb-owner onb-owner-${owner || 'none'}`}>{OWNERS[owner] || '—'}</span>
      </div>
      {open && (
        <div className="onb-step-body">
          <p><b>למה:</b> {step.why}</p>
          <p><b>מה עושים:</b> {step.how}</p>
          {step.auto && <p className="onb-muted"><Sparkles size={12} aria-hidden="true" /> בדיקה אוטומטית: {autoOk ? 'עברה' : 'עוד לא'}{at ? ` · ${at}` : ''}</p>}
          <div className="onb-controls">
            <label>סטטוס
              <select value={status} onChange={e => onSave(step.key, { status: e.target.value })}>
                {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>אחראי
              <select value={owner || ''} onChange={e => onSave(step.key, { owner: e.target.value || null })}>
                <option value="">—</option>
                {Object.entries(OWNERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <label className="onb-note">הערה
            <textarea rows={2} value={note} placeholder="מה נעשה, מה חסר, למי פנינו..." onChange={e => setNote(e.target.value)}
              onBlur={() => { if ((state?.note || '') !== note) onSave(step.key, { note }) }} />
          </label>
          {state?.updated_by && <div className="onb-muted">עודכן {fmtDate(state.updated_at)} · {state.updated_by}</div>}
        </div>
      )}
    </li>
  )
}

function Detail({ projectId, onBack }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(() => {
    apiFetch(`/api/onboarding?projectId=${projectId}`, { headers: {} }).then(r => r.json()).then(setD).catch(() => setErr('שגיאה בטעינה'))
  }, [projectId])
  useEffect(() => { load() }, [load])
  const save = async (step, patch) => {
    setD(cur => ({ ...cur, states: { ...cur.states, [step]: { ...(cur.states[step] || {}), ...patch } } }))
    const r = await apiFetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, step, ...patch }) }).catch(() => null)
    const b = r ? await r.json().catch(() => null) : null
    if (b?.row) setD(cur => ({ ...cur, states: { ...cur.states, [step]: b.row } }))
    else setErr('השמירה נכשלה' + (b?.error ? `: ${b.error}` : ''))
  }
  if (err && !d) return <div className="onb-muted" style={{ padding: 20 }}>{err}</div>
  if (!d) return <div className="onb-muted" style={{ padding: 20 }}>טוען...</div>
  const sum = onboardingSummary(d.states, d.auto)
  return (
    <div>
      <button type="button" className="onb-back" onClick={onBack}><ArrowRight size={16} aria-hidden="true" />כל הלקוחות</button>
      <div className="onb-card onb-head">
        <div><div className="onb-muted">{d.project.client}</div><h4>{d.project.name}</h4></div>
        <div className="onb-head-num"><b>{sum.pct}%</b><span className="onb-muted">{sum.done} מתוך {sum.total}</span></div>
        <Bar pct={sum.pct} />
        <div className="onb-muted">{sum.currentStage ? `השלב הנוכחי: ${sum.currentStage.title}` : 'הקליטה הושלמה'}</div>
      </div>
      {!d.ready && <div className="onb-card onb-warn">כדי לשמור סימונים צריך להריץ את מיגרציה 030. עד אז מוצגות רק הבדיקות האוטומטיות.</div>}
      {err && <div className="onb-card onb-warn">{err}</div>}
      {STAGES.map((stage, i) => {
        const left = stage.steps.filter(s => !stepDone(s, d.states, d.auto)).length
        return (
          <section key={stage.key} className="onb-card">
            <div className="onb-stage-head">
              <span className={left ? 'onb-num' : 'onb-num ok'}>{left ? i + 1 : <CheckCircle2 size={16} />}</span>
              <h5>{stage.title}</h5>
              <span className="onb-muted">{stage.steps.length - left}/{stage.steps.length}</span>
            </div>
            <ul className="onb-steps">
              {stage.steps.map(s => <Step key={s.key} step={s} state={d.states[s.key]} auto={d.auto} detail={d.detail} onSave={save} />)}
            </ul>
          </section>
        )
      })}
      <p className="onb-muted" style={{ lineHeight: 1.6 }}>לחיצה על שם השלב פותחת הסבר — למה הוא חשוב ומה עושים. "זוהה אוטומטית" מסומן לפי הנתונים בדשבורד; אפשר תמיד לשנות ידנית.</p>
    </div>
  )
}

export default function OnboardingModal({ onClose, initialProjectId = null }) {
  const [list, setList] = useState(null)
  const [sel, setSel] = useState(initialProjectId)
  const [filter, setFilter] = useState('open')
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (sel) return
    let off = false
    apiFetch('/api/onboarding', { headers: {} }).then(r => r.json()).then(b => { if (!off) setList(b.projects || []) }).catch(() => { if (!off) setList([]) })
    return () => { off = true }
  }, [sel, nonce])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const shown = useMemo(() => (list || []).filter(p => filter === 'all' || (filter === 'open' ? p.summary.pct < 100 : p.summary.pct >= 100)), [list, filter])
  const tab = (k, l) => <button type="button" className={filter === k ? 'onb-tab on' : 'onb-tab'} onClick={() => setFilter(k)}>{l}</button>
  return (
    <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal onb-modal" role="dialog" aria-label="קליטת לקוחות">
        <div className="onb-top">
          <h3>קליטת לקוחות</h3>
          <button type="button" className="onb-x" onClick={onClose} aria-label="סגירה"><X size={20} /></button>
        </div>
        {sel ? <Detail projectId={sel} onBack={() => { setSel(null); setNonce(n => n + 1) }} /> : (
          <>
            <div className="onb-tabs">{tab('open', 'בתהליך')}{tab('done', 'הושלמו')}{tab('all', 'הכל')}</div>
            {!list ? <div className="onb-muted" style={{ padding: 20 }}>טוען...</div> : !shown.length ? <div className="onb-muted" style={{ padding: 20 }}>אין פרויקטים כאן</div> : (
              <div className="onb-list">
                {shown.map(p => (
                  <button type="button" key={p.id} className="onb-card onb-item" onClick={() => setSel(p.id)}>
                    <div className="onb-item-top">
                      <div><div className="onb-muted">{p.client}</div><b>{p.name}</b></div>
                      <b className="onb-pct">{p.summary.pct}%</b>
                    </div>
                    <Bar pct={p.summary.pct} />
                    <div className="onb-muted">{p.summary.currentStage ? `שלב: ${p.summary.currentStage.title}` : 'הושלם'} · {p.summary.done}/{p.summary.total}{p.updated_at ? ` · עודכן ${fmtDate(p.updated_at)}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
