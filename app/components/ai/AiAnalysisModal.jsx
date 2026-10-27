'use client'
import { Sparkles, X, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { periodLabel } from '../../../lib/report-pdf.js'

// ניתוח AI לפרויקט (ויטלי, 27.10) — אדמין בלבד. המצב והקריאות ב-admin/page.js (openAiAnalysis /
// runAiAnalysis); כאן רק התצוגה: הניתוח של התקופה שעל המסך, ורשימת הניתוחים הקודמים (בלחיצה ושבועיים).
// מבנה הניתוח: lib/ai-analysis.js › ANALYSIS_SCHEMA.

const OWNER = { agency: 'סוכנות', sales: 'צוות מכירות', client: 'לקוח' }
const CONF = { high: 'סביר מאוד', medium: 'אפשרי', low: 'השערה רחוקה' }
const TRIGGER = { manual: 'בלחיצה', weekly: 'שבועי' }
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

function Analysis({ a }) {
  const r = a.result || {}
  return (
    <div className="ai-body">
      <div className="ai-meta">{periodLabel(a.period_key)}{a.compare_key ? ` מול ${periodLabel(a.compare_key)}` : ''} · {TRIGGER[a.trigger] || a.trigger} · {fmtDate(a.created_at)}{a.usage?.costUsd != null ? ` · עלות ‎$${a.usage.costUsd}` : ''}</div>
      <h3 className="ai-headline">{r.headline}</h3>
      {r.summary && <p className="ai-summary">{r.summary}</p>}

      {!!r.changes?.length && (<section>
        <h4>מה השתנה <span>נמדד</span></h4>
        <ul className="ai-changes">{r.changes.map((c, i) => (
          <li key={i} className={`ai-dir-${c.direction}`}>
            <span className="ai-ico" aria-hidden="true">{c.direction === 'good' ? <TrendingUp size={15} /> : c.direction === 'bad' ? <TrendingDown size={15} /> : <Minus size={15} />}</span>
            <div><b>{c.title}</b><p>{c.detail}</p></div>
          </li>))}
        </ul>
      </section>)}

      {!!r.reasons?.length && (<section>
        <h4>הסברים אפשריים <span>השערות, לא הוכחה</span></h4>
        <ul className="ai-reasons">{r.reasons.map((x, i) => (
          <li key={i}><div><b>{x.title}</b> <em className={`ai-conf ai-conf-${x.confidence}`}>{CONF[x.confidence] || x.confidence}</em><p>{x.detail}</p></div></li>))}
        </ul>
      </section>)}

      {!!r.actions?.length && (<section>
        <h4>מה לעשות</h4>
        <ol className="ai-actions">{r.actions.map((x, i) => (
          <li key={i}><div><b>{x.title}</b> <em className="ai-owner">{OWNER[x.owner] || x.owner}</em><p>{x.detail}</p></div></li>))}
        </ol>
      </section>)}

      {!!r.watch?.length && (<section>
        <h4>מה לבדוק</h4>
        <ul className="ai-watch">{r.watch.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </section>)}
    </div>
  )
}

export default function AiAnalysisModal({ project, client, periodKey, state, onRun, onSelect, onClose }) {
  const { loading, listLoading, error, list, current } = state
  const isThisPeriod = current && current.period_key === periodKey
  return (
    <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal ai-modal" role="dialog" aria-modal="true" aria-label="ניתוח AI">
        <div className="ai-top">
          <div>
            <div className="ai-kicker"><Sparkles size={15} aria-hidden="true" /> ניתוח AI</div>
            <h2>{client ? `${client} / ` : ''}{project}</h2>
          </div>
          <button type="button" className="ai-close" onClick={onClose} aria-label="סגירה"><X size={20} /></button>
        </div>

        <div className="ai-run">
          <span>התקופה שעל המסך: <b>{periodLabel(periodKey)}</b></span>
          <button type="button" className="ai-btn" disabled={loading} onClick={() => onRun(isThisPeriod)}>
            {loading ? <><RefreshCw size={15} className="ai-spin" aria-hidden="true" /> Claude מנתח… (עד דקה)</> : isThisPeriod ? <><RefreshCw size={15} aria-hidden="true" /> נתח מחדש</> : <><Sparkles size={15} aria-hidden="true" /> נתח את התקופה</>}
          </button>
        </div>

        {error && <div className="ai-error">{error}</div>}
        {listLoading ? <div className="ai-empty">טוען ניתוחים…</div>
          : current ? <Analysis a={current} />
          : !loading && <div className="ai-empty">עוד אין ניתוח לתקופה הזו. לחיצה על "נתח את התקופה" שולחת ל-Claude את אותם מספרים שבדוח ה-PDF (בלי פרטי לידים), ומחזירה מה השתנה, למה כנראה, ומה לעשות.</div>}

        {list.length > 0 && (
          <div className="ai-history">
            <h4>ניתוחים קודמים</h4>
            <ul>{list.map(a => (
              <li key={a.id}>
                <button type="button" className={current && a.id === current.id ? 'on' : ''} onClick={() => onSelect(a)}>
                  <span className="ai-h-when">{fmtDate(a.created_at)} · {TRIGGER[a.trigger] || a.trigger} · {periodLabel(a.period_key)}</span>
                  <span className="ai-h-text">{a.result?.headline}</span>
                </button>
              </li>))}
            </ul>
          </div>
        )}
        <p className="ai-note">ההסברים הם השערות על בסיס הנתונים, לא הוכחה לסיבה. רק אדמין רואה את המסך הזה.</p>
      </div>
    </div>
  )
}
