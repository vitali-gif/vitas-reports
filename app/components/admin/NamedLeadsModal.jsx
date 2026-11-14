'use client'
import { useEffect, useMemo, useState } from 'react'
import { Users, X, Search, Phone, CalendarPlus, CalendarCheck, Megaphone, Copy, Check, MessageSquareText } from 'lucide-react'
import { REVIEW_LABEL } from '../../../lib/objection-normalize.js'

// רשימת הלידים שמאחורי כרטיס (ויטלי, 3.11: "לעצב בצורה מקצועית יותר לפי ה-DESIGN SYSTEM").
// אותו מבנה כמו ניהול הגישה (.cza-sheet, cluzo-polish.css §20): כותרת דביקה, חיפוש, שורה לכל ליד.
// בטלפון: גיליון שעולה מלמטה.
const dmy = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}
// "העתק" (ויטלי, 9.11: לשלוח את רשימת הפגישות בקבוצת וואטסאפ) — טקסט פשוט, שורה לכל ליד, מה שמוצג (גם אחרי חיפוש).
export function leadsAsText(title, rows) {
  const lines = rows.map((e, i) => [
    `${i + 1}. ${e.name || '-'}`,
    e.phone || '',
    e.source || '',
    e.ad ? `מודעה: ${e.ad}` : '',
    e.leadDate ? `כניסת ליד ${dmy(e.leadDate)}` : '',
    e.apptDate ? `תיאום פגישה ${dmy(e.apptDate)}` : '',
    e.objection ? `התנגדות: ${e.objection}` : '',
    e.note ? `הערה אחרונה${e.noteDate ? ' ' + dmy(e.noteDate) : ''}${e.noteBy ? ' (' + e.noteBy + ')' : ''}: ${String(e.note).replace(/\s*\n\s*/g, ' / ')}` : '',
  ].filter(Boolean).join(' · '))
  return `*${title}* (${rows.length})\n\n${lines.join('\n')}`
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {}
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok
  } catch { return false }
}
const initial = (name) => (String(name || '').trim().match(/[\p{L}\p{N}]/u) || ['?'])[0]

export default function NamedLeadsModal({ title, names, isClientView, onClose }) {
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState(false)
  // Esc סוגר (בדיקת QA, 14.11: במחשב החלון נשאר פתוח וחסם את הטאבים)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const rows = useMemo(() => (names || []).map(e => (typeof e === 'string' ? { name: e } : (e || {}))), [names])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return rows
    return rows.filter(e => [e.name, e.phone, e.source, e.ad, e.objection, e.note].some(v => String(v || '').toLowerCase().includes(t)))
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
          {shown.length > 0 && (
            <button type="button" className="nlm-copy" onClick={async () => { if (await copyText(leadsAsText(title, shown))) { setCopied(true); setTimeout(() => setCopied(false), 1800) } }}
              aria-label="העתקת הרשימה" title="העתקת הרשימה (לוואטסאפ)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: '1px solid var(--border, #E2E8F0)', background: copied ? '#E5F4E4' : 'var(--surface, #fff)', color: 'var(--text, #0B0F1E)', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
              {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? 'הועתק' : 'העתק'}
            </button>
          )}
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
                  {e.note ? (
                    <div className="nlm-note" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4, fontSize: 13, color: 'var(--text-2, #334155)', background: 'var(--surface-2, #F8FAFC)', borderRadius: 8, padding: '6px 8px' }}>
                      <MessageSquareText size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span><b>הערה אחרונה{e.noteDate ? ' ' + dmy(e.noteDate) : ''}{e.noteBy ? ' · ' + e.noteBy : ''}:</b> <span dir="auto" style={{ whiteSpace: 'pre-line' }}>{e.note}</span></span>
                    </div>
                  ) : null}
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
