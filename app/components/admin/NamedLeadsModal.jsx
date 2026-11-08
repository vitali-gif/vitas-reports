'use client'
import { useMemo, useState } from 'react'
import { Users, X, Search, Phone, CalendarPlus, CalendarCheck, Megaphone } from 'lucide-react'
import { REVIEW_LABEL } from '../../../lib/objection-normalize.js'

// רשימת הלידים שמאחורי כרטיס (ויטלי, 3.11: "לעצב בצורה מקצועית יותר לפי ה-DESIGN SYSTEM").
// אותו מבנה כמו ניהול הגישה (.cza-sheet, cluzo-polish.css §20): כותרת דביקה, חיפוש, שורה לכל ליד.
// בטלפון: גיליון שעולה מלמטה.
const dmy = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}
const initial = (name) => (String(name || '').trim().match(/[\p{L}\p{N}]/u) || ['?'])[0]

export default function NamedLeadsModal({ title, names, isClientView, onClose }) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => (names || []).map(e => (typeof e === 'string' ? { name: e } : (e || {}))), [names])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows
    return rows.filter(e => [e.name, e.phone, e.source, e.ad, e.objection].some(v => String(v || '').toLowerCase().includes(t)))
  }, [rows, q])
  return (
    <div className="modal-overlay active" style={{ zIndex: 9999 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal cza-sheet nlm-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="cza-head">
          <span className="cza-ico" aria-hidden="true"><Users size={19} /></span>
          <div className="cza-head-text">
            <h3>{title}</h3>
            <p>{rows.length} רשומות{q && shown.length !== rows.length ? ` · מוצגות ${shown.length}` : ''}</p>
          </div>
          <button type="button" className="cza-x" onClick={onClose} aria-label="סגירה"><X size={20} /></button>
        </div>
        {rows.length > 8 && (
          <label className="cza-search nlm-search">
            <Search size={16} aria-hidden="true" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי שם, טלפון, מקור או מודעה" aria-label="חיפוש" />
          </label>
        )}
        {shown.length === 0 ? (
          <div className="cza-empty nlm-empty">{rows.length ? 'אין תוצאות לחיפוש' : 'אין נתונים להצגה'}</div>
        ) : (
          <ul className="nlm-list">
            {shown.map((e, i) => (
              <li key={i} className="nlm-row">
                <span className="nlm-av" aria-hidden="true">{initial(e.name)}</span>
                <div className="nlm-main">
                  <div className="nlm-top">
                    <span className="nlm-name">{e.name || '-'}{e.value ? <span className="nlm-val"> ₪{Number(e.value).toLocaleString('he-IL')}</span> : null}</span>
                    {e.phone ? <a className="nlm-phone" href={`tel:${e.phone}`} dir="ltr"><Phone size={13} aria-hidden="true" />{e.phone}</a> : null}
                  </div>
                  {e.source ? <div className="nlm-src">{e.source}</div> : null}
                  {e.ad ? <div className="nlm-ad"><Megaphone size={13} aria-hidden="true" /> <span>מודעה:</span> <b dir="auto">{e.ad}</b></div> : null}
                  {(e.leadDate || e.apptDate || e.objection) && (
                    <div className="nlm-meta">
                      {e.leadDate ? <span><CalendarPlus size={13} aria-hidden="true" /> כניסת ליד <b dir="ltr">{dmy(e.leadDate)}</b></span> : null}
                      {e.apptDate ? <span><CalendarCheck size={13} aria-hidden="true" /> תיאום פגישה <b dir="ltr">{dmy(e.apptDate)}</b></span> : null}
                      {e.objection ? <span className="nlm-obj">התנגדות: {e.objection}{e.review && !isClientView ? <em className="nlm-review">{REVIEW_LABEL}</em> : null}</span> : null}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
