'use client'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api-fetch'
import { adsFromRows, creativeTests, MIN_LEADS } from '../../../lib/ad-tags.js'

// "מה עובד במודעות" בטאב Facebook (ויטלי, 5.11): אותה השוואה כמו בדוח ה-PDF — קבוצות של מודעות לפי
// מה שרואים בהן (lib/ad-tags.js), עם CTR, CPC ועלות לליד. הסיווגים מ-/api/ad-tags, רק למודעות של הפרויקט.
const money = (v, d = 0) => (v == null ? '-' : '₪' + Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))

export default function CreativeTests({ rows, projectId }) {
  const ads = useMemo(() => adsFromRows(rows), [rows])
  const idsKey = useMemo(() => ads.map(a => a.adId).sort().slice(0, 500).join(','), [ads])
  const [tags, setTags] = useState(null)
  useEffect(() => {
    let off = false
    setTags(null)
    if (!projectId || !idsKey) return
    apiFetch(`/api/ad-tags?projectId=${projectId}&ids=${idsKey}`, { headers: {} })
      .then(r => (r && r.ok ? r.json() : null))
      .then(b => { if (!off) setTags(b?.tags || {}) })
      .catch(() => { if (!off) setTags({}) })
    return () => { off = true }
  }, [projectId, idsKey])
  const tests = useMemo(() => (tags ? creativeTests(ads, tags) : []), [ads, tags])
  if (!tests.length) return null
  return (
    <div className="section section-creative-tests">
      <div className="section-head">
        <div className="ico violet" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg></div>
        <h2>מה עובד במודעות</h2>
        <span className="sub">השוואה בין קבוצות של מודעות לפי מה שרואים בהן · הזולה ביותר לליד מסומנת</span>
      </div>
      <div className="ctz-grid">
        {tests.map(t => (
          <div key={t.key} className="ctz-card">
            <div className="ctz-head"><h3>{t.label}</h3>{t.indicative && <span className="ctz-ind">אינדיקציה בלבד</span>}</div>
            <div className="ctz-scroll"><table className="ctz-table">
              <thead><tr><th></th><th>מודעות</th><th>CTR</th><th>CPC</th><th>עלות לליד</th></tr></thead>
              <tbody>{t.groups.map((g, i) => (
                <tr key={g.value} className={i === 0 && g.cpl != null ? 'best' : undefined}>
                  <td className="ctz-name">{g.label}{i === 0 && g.cpl != null && <span className="ctz-best">הכי טוב</span>}</td>
                  <td>{g.ads}</td>
                  <td>{g.ctr != null ? g.ctr.toFixed(2) + '%' : '-'}</td>
                  <td>{money(g.cpc, 2)}</td>
                  <td className="ctz-cpl">{money(g.cpl)}</td>
                </tr>))}
              </tbody>
            </table></div>
          </div>
        ))}
      </div>
      <p className="ctz-note">מבוסס על ביצועי המודעות בתקופה שנבחרה. "אינדיקציה בלבד": באחת הקבוצות פחות מ-{MIN_LEADS} לידים, ולכן עוד מוקדם להסיק. זו השוואה בין קבוצות, לא הוכחה שאלמנט מסוים גרם להבדל.</p>
    </div>
  )
}
