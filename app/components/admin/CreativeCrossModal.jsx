'use client'
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { apiFetch } from '../../../lib/api-fetch'

// "מה עובד במודעות — כל הלקוחות" (ויטלי, 6.11; אדמין בלבד): 12 החודשים שמסתיימים בתקופה שעל המסך,
// כל המודעות של הפרויקטים שנבחרו ביחד, ולכל ערך — בכמה פרויקטים הוא היה "הכי טוב". /api/admin/creative-cross
const money = (v, d = 0) => (v == null ? '-' : '₪' + Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))
const ym = (k) => (k ? `${k.slice(5, 7)}/${k.slice(0, 4)}` : '')

export default function CreativeCrossModal({ periodKey, onClose }) {
  const [sel, setSel] = useState(null)      // null = כל הפרויקטים
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let off = false
    setData(null); setErr(null)
    const q = `/api/admin/creative-cross?key=${encodeURIComponent(periodKey || '')}${sel ? `&projects=${[...sel].join(',')}` : ''}`
    apiFetch(q, { headers: {} }).then(r => r.json()).then(b => { if (!off) { if (b.error) setErr(b.error); else setData(b) } }).catch(() => { if (!off) setErr('שגיאה בטעינה') })
    return () => { off = true }
  }, [periodKey, sel])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const all = data?.allProjects || []
  const toggle = (id) => setSel(cur => {
    const base = new Set(cur || all.map(p => p.id))
    if (base.has(id)) base.delete(id); else base.add(id)
    return base.size === all.length ? null : base
  })
  const totalAds = useMemo(() => (data?.projects || []).reduce((s, p) => s + p.ads, 0), [data])
  return (
    <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{ zIndex: 9999 }}>
      <div className="modal ctz-modal" style={{ maxWidth: 900 }} role="dialog" aria-label="מה עובד במודעות - כל הלקוחות">
        <div className="ctz-modal-head">
          <div>
            <div className="ctz-modal-kicker">אדמין בלבד · 12 חודשים{data?.from ? ` · ${ym(data.from)} עד ${ym(data.to)}` : ''}</div>
            <h3>מה עובד במודעות - כל הלקוחות{data ? ` · ${totalAds} מודעות ב-${data.projects.length} פרויקטים` : ''}</h3>
          </div>
          <button type="button" className="ctz-x" onClick={onClose} aria-label="סגירה"><X size={20} /></button>
        </div>
        {all.length > 0 && (
          <div className="ctx-chips">
            {all.map(p => {
              const on = !sel || sel.has(p.id)
              return <button key={p.id} type="button" className={on ? 'ctx-chip on' : 'ctx-chip'} onClick={() => toggle(p.id)} aria-pressed={on}>{p.name}</button>
            })}
          </div>
        )}
        {err ? <p className="ctz-note">{err}</p> : !data ? <p className="ctz-note">טוען… (מחשב 12 חודשים לכל פרויקט)</p> : !data.combined?.length ? <p className="ctz-note">אין מספיק מודעות מסווגות בפרויקטים שנבחרו.</p> : (
          <div className="ctz-grid ctz-meet">
            {data.combined.map(t => {
              const cons = data.consistency?.[t.key] || {}
              return (
                <div key={t.key} className="ctz-card">
                  <div className="ctz-head"><h3>{t.label}</h3>{t.indicative && <span className="ctz-ind">מעט נתונים עדיין</span>}</div>
                  <div className="ctz-rank">כל הפרויקטים יחד, לפי עלות לליד · "ניצח ב" = בכמה פרויקטים הערך הזה היה הכי טוב (לפי הדירוג של כל פרויקט)</div>
                  <div className="ctz-scroll"><table className="ctz-table">
                    <thead><tr><th></th><th className="ctz-opt">מודעות</th><th>לידים</th><th className="ctz-opt">CTR</th><th>עלות לליד</th><th>ניצח ב</th></tr></thead>
                    <tbody>{t.groups.map((g, i) => {
                      const c = cons[g.value]
                      return (
                        <tr key={g.value} className={i === 0 && g.cpl != null ? 'best' : undefined}>
                          <td className="ctz-name">{g.label}{i === 0 && g.cpl != null && <span className="ctz-best">הכי טוב</span>}</td>
                          <td className="ctz-opt">{g.ads}</td>
                          <td>{Number(g.leads || 0).toLocaleString('en-US')}</td>
                          <td className="ctz-opt">{g.ctr != null ? g.ctr.toFixed(2) + '%' : '-'}</td>
                          <td className="ctz-cpl">{money(g.cpl)}</td>
                          <td title={c?.projects?.join(', ') || ''}>{c ? `${c.best} מתוך ${c.of}` : '-'}</td>
                        </tr>
                      )
                    })}</tbody>
                  </table></div>
                </div>
              )
            })}
          </div>
        )}
        <p className="ctz-note">ממצא שחוזר בכמה פרויקטים (למשל "הכי טוב ב-4 מתוך 5") חזק יותר מממצא של פרויקט אחד. הדירוג המשותף לפי עלות לליד - פגישות ורכישות נמדדות אחרת בכל CRM. ריחוף על "ניצח ב" מראה באילו פרויקטים.</p>
      </div>
    </div>
  )
}
