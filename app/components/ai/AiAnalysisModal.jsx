'use client'
import { useState } from 'react'
import { Sparkles, X, RefreshCw, TrendingUp, TrendingDown, Minus, Copy, Check, AlertTriangle, MessageCircle, Mail, ChevronDown, History, Lightbulb, ListChecks, Eye, CheckCircle2 } from 'lucide-react'
import { periodLabel } from '../../../lib/report-pdf.js'
import { analysisText, clientText, qualityOf, stripSampleSizes } from '../../../lib/ai-analysis-text.js'

// ניתוח AI לפרויקט (ויטלי, 27.10) — אדמין בלבד. המצב והקריאות ב-admin/page.js (openAiAnalysis /
// runAiAnalysis); כאן רק התצוגה: הניתוח של התקופה שעל המסך, ורשימת הניתוחים הקודמים (בלחיצה ושבועיים).
// מבנה הניתוח: lib/ai-analysis.js › ANALYSIS_SCHEMA.

const OWNER = { agency: 'סוכנות', sales: 'צוות מכירות', client: 'לקוח' }
const CONF = { high: 'סביר מאוד', medium: 'אפשרי', low: 'השערה רחוקה' }
const TRIGGER = { manual: 'בלחיצה', weekly: 'שבועי', monthly: 'דוח חודשי' }
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

// העתקה (28.10): הניתוח כטקסט פשוט, מוכן להדבקה בוואטסאפ או במייל. clipboard דורש https —
// ובדפדפן ישן / הרשאה חסומה נופלים ל-textarea + execCommand.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {}
  try {
    const t = document.createElement('textarea')
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'
    document.body.appendChild(t); t.select()
    const ok = document.execCommand('copy'); t.remove(); return ok
  } catch { return false }
}

// שני כפתורים (28.10): הניתוח הפנימי כטקסט נקי, וההודעה ללקוח — שתי הודעות שונות לשני קהלים.
function CopyButton({ getText, label, title, primary }) {
  const [state, setState] = useState('')   // '' | 'ok' | 'fail'
  const onCopy = async () => {
    const ok = await copyText(getText())
    setState(ok ? 'ok' : 'fail')
    setTimeout(() => setState(''), 2500)
  }
  return (
    <button type="button" className={`${primary ? 'cza-primary' : 'cza-ghost'} aid-copy${state === 'ok' ? ' ok' : ''}`} onClick={onCopy} title={title}>
      {state === 'ok' ? <><Check size={15} aria-hidden="true" /> הועתק</> : state === 'fail' ? 'ההעתקה נכשלה' : <><Copy size={15} aria-hidden="true" /> {label}</>}
    </button>
  )
}

/** איכות הנתונים — קודם לכל (ויטלי, 28.10). 3.11: רצועה אחת מקופלת — התווית ומספר ההערות; בלחיצה נפתחת. */
function Quality({ r }) {
  const [open, setOpen] = useState(false)
  const q = qualityOf(r)
  if (!q || (q.level === 'good' && !q.notes.length)) return null
  return (
    <div className={`aid-quality aid-q-${q.level}`}>
      <button type="button" className="aid-q-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="aid-q-label"><AlertTriangle size={14} aria-hidden="true" /> {q.label}</span>
        {!!q.notes.length && <span className="aid-q-n">{q.notes.length} הערות</span>}
        {!!q.notes.length && <ChevronDown size={16} className={open ? 'aid-rot' : ''} aria-hidden="true" />}
      </button>
      {open && !!q.notes.length && <ul>{q.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    </div>
  )
}

// ויטלי, 3.11: "הפופ אפ לא נראה מקצועי" — פאנל צד לפי ה-Design System: השורה התחתונה למעלה,
// ומתחת לשוניות במקום גלילה ארוכה. ההעתקות בתחתית קבועה.
function Analysis({ a, project }) {
  const r = stripSampleSizes(a.result || {})
  const tabs = [
    r.changes?.length && { key: 'changes', label: 'מה השתנה', n: r.changes.length, icon: TrendingUp },
    r.reasons?.length && { key: 'reasons', label: 'למה', n: r.reasons.length, icon: Lightbulb },
    r.actions?.length && { key: 'actions', label: 'מה עושים', n: r.actions.length, icon: ListChecks },
    r.watch?.length && { key: 'watch', label: 'מה לבדוק', n: r.watch.length, icon: Eye },
    r.clientMessage && { key: 'client', label: 'הודעה ללקוח', icon: MessageCircle },
  ].filter(Boolean)
  const [tab, setTab] = useState(tabs[0]?.key || 'changes')
  return (
    <div className="aid-analysis">
      <div className="aid-bottomline">
        <div className="aid-bl-k">בשורה התחתונה</div>
        <h3>{r.headline}</h3>
        {r.summary && <p>{r.summary}</p>}
        <div className="aid-bl-meta">{periodLabel(a.period_key)}{a.compare_key ? ` מול ${periodLabel(a.compare_key)}` : ''} · {TRIGGER[a.trigger] || a.trigger} · {fmtDate(a.created_at)}{a.usage?.costUsd != null ? ` · ‎$${a.usage.costUsd}` : ''}</div>
      </div>
      <Quality r={r} />

      {!!tabs.length && (
        <div className="aid-tabs" role="tablist">
          {tabs.map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              <t.icon size={15} aria-hidden="true" /> {t.label}{t.n ? <span className="aid-tab-n">{t.n}</span> : null}
            </button>))}
        </div>
      )}

      <div className="aid-panel" role="tabpanel">
        {tab === 'changes' && <>
          <p className="aid-hint">מה נמדד בנתונים, עם גודל המדגם.</p>
          <ul className="aid-items">{(r.changes || []).map((c, i) => (
            <li key={i} className={`aid-dir-${c.direction}`}>
              <span className="aid-ico" aria-hidden="true">{c.direction === 'good' ? <TrendingUp size={16} /> : c.direction === 'bad' ? <TrendingDown size={16} /> : <Minus size={16} />}</span>
              <div><b>{c.title}</b><p>{c.detail}</p></div>
            </li>))}
          </ul></>}
        {tab === 'reasons' && <>
          <p className="aid-hint">השערות על בסיס הנתונים, לא הוכחה לסיבה.</p>
          <ul className="aid-items">{(r.reasons || []).map((x, i) => (
            <li key={i}><span className="aid-ico" aria-hidden="true"><Lightbulb size={16} /></span>
              <div><b>{x.title}</b> <em className={`aid-pill aid-conf-${x.confidence}`}>{CONF[x.confidence] || x.confidence}</em><p>{x.detail}</p></div></li>))}
          </ul></>}
        {tab === 'actions' && <>
          <p className="aid-hint">שלוש פעולות לשבוע הקרוב, עם מי שאחראי.</p>
          <ol className="aid-items aid-actions">{(r.actions || []).map((x, i) => (
            <li key={i}><span className="aid-num" aria-hidden="true">{i + 1}</span>
              <div><b>{x.title}</b> <em className="aid-pill aid-owner">{OWNER[x.owner] || x.owner}</em><p>{x.detail}</p></div></li>))}
          </ol></>}
        {tab === 'watch' && <>
          <p className="aid-hint">דברים לאמת לפני שמסיקים מסקנות.</p>
          <ul className="aid-items">{(r.watch || []).map((w, i) => <li key={i}><span className="aid-ico" aria-hidden="true"><CheckCircle2 size={16} /></span><div><p className="aid-plain">{w}</p></div></li>)}</ul></>}
        {tab === 'client' && <>
          <p className="aid-hint">לקבוצת הוואטסאפ של הלקוח. לקרוא לפני ששולחים.</p>
          <pre className="aid-client-msg">{clientText(a, { project })}</pre></>}
      </div>
    </div>
  )
}

export default function AiAnalysisModal({ project, client, periodKey, state, onRun, onSelect, onClose, onSendMonthly, monthly }) {
  const { loading, listLoading, error, list, current } = state
  const isThisPeriod = current && current.period_key === periodKey
  const [showHistory, setShowHistory] = useState(false)
  return (
    <div className="modal-overlay active aid-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal aid-drawer" role="dialog" aria-modal="true" aria-label="ניתוח AI">
        <div className="aid-head">
          <span className="cza-ico" aria-hidden="true"><Sparkles size={19} /></span>
          <div className="aid-head-text">
            <div className="aid-kicker">ניתוח AI</div>
            <h2>{client ? `${client} / ` : ''}{project}</h2>
          </div>
          <button type="button" className="cza-x" onClick={onClose} aria-label="סגירה"><X size={20} /></button>
        </div>

        <div className="aid-scroll">
          <div className="aid-run">
            <div><span className="aid-run-k">התקופה שעל המסך</span><b>{periodLabel(periodKey)}</b></div>
            <button type="button" className="cza-primary" disabled={loading} onClick={() => onRun(isThisPeriod)}>
              {loading ? <><RefreshCw size={16} className="ai-spin" aria-hidden="true" /> מנתח… (עד דקה)</> : isThisPeriod ? <><RefreshCw size={16} aria-hidden="true" /> נתח מחדש</> : <><Sparkles size={16} aria-hidden="true" /> נתח את התקופה</>}
            </button>
          </div>

          {error && <div className="cza-status warn aid-error">{error}</div>}
          {listLoading ? <div className="aid-empty">טוען ניתוחים…</div>
            : current ? <Analysis key={current.id} a={current} project={project} />
            : !loading && <div className="aid-empty">עוד אין ניתוח לתקופה הזו. "נתח את התקופה" שולח את אותם מספרים שבדוח ה-PDF (בלי פרטי לידים), ומחזיר מה השתנה, למה כנראה, ומה לעשות.</div>}

          {list.length > 0 && (
            <div className="aid-history">
              <button type="button" className="aid-history-toggle" onClick={() => setShowHistory(v => !v)} aria-expanded={showHistory}>
                <History size={15} aria-hidden="true" /> ניתוחים קודמים <span className="aid-tab-n">{list.length}</span>
                <ChevronDown size={16} className={showHistory ? 'aid-rot' : ''} aria-hidden="true" />
              </button>
              {showHistory && <ul>{list.map(a => (
                <li key={a.id}>
                  <button type="button" className={current && a.id === current.id ? 'on' : ''} onClick={() => onSelect(a)}>
                    <span className="aid-h-when">{fmtDate(a.created_at)} · {TRIGGER[a.trigger] || a.trigger} · {periodLabel(a.period_key)}</span>
                    <span className="aid-h-text">{stripSampleSizes(a.result?.headline)}</span>
                  </button>
                </li>))}
              </ul>}
            </div>
          )}

          {/* הדוח החודשי (29.10): אותו PDF שהקרון שולח ב-5 לחודש, עם "סיכום החודש" מהניתוח — רק לחודש שהסתיים */}
          {onSendMonthly && (
            <div className="aid-monthly">
              <span>{monthly?.msg || 'דוח PDF חודשי עם סיכום מהניתוח - נשלח אוטומטית ב-5 לחודש, רק אליך.'}</span>
              <button type="button" className="cza-ghost brand" disabled={loading || monthly?.sending} onClick={onSendMonthly}>
                {monthly?.sending ? <><RefreshCw size={15} className="ai-spin" aria-hidden="true" /> מכין ושולח…</> : <><Mail size={15} aria-hidden="true" /> שלח לי עכשיו</>}
              </button>
            </div>
          )}
          <p className="aid-note">ההסברים הם השערות על בסיס הנתונים, לא הוכחה לסיבה. רק אדמין רואה את המסך הזה.</p>
        </div>

        {current && (
          <div className="aid-foot">
            {current.result?.clientMessage && <CopyButton primary getText={() => clientText(current, { project })} label="העתקת הודעה ללקוח" title="הודעה קצרה בשפה של לקוח, לקבוצת הוואטסאפ" />}
            <CopyButton getText={() => analysisText(current, { project, client })} label="העתקת הניתוח" title="הניתוח הפנימי המלא, כטקסט נקי" />
          </div>
        )}
      </div>
    </div>
  )
}
