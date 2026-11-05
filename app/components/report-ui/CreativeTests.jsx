'use client'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api-fetch'
import { adsFromRows, creativeTests, MIN_LEADS, MIN_MEETINGS, RANK_BY_MEETINGS_AT } from '../../../lib/ad-tags.js'

// "מה עובד במודעות" בטאב Facebook (ויטלי, 5.11): אותה השוואה כמו בדוח ה-PDF — קבוצות של מודעות לפי
// מה שרואים בהן (lib/ad-tags.js), עם לידים, CTR, CPC ועלות לליד, ופגישות ועלות לפגישה כשה-CRM שומר את מזהה
// המודעה. rows: כל שורות התקופה (פייסבוק + CRM). הסיווגים מ-/api/ad-tags, רק למודעות של הפרויקט.
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
  const meet = tests.some(t => t.hasMeetings)
  const byMeet = tests.some(t => t.rankBy === 'meeting')
  return (
    <div className="section section-creative-tests">
      <div className="section-head">
        <div className="ico violet" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg></div>
        <h2>מה עובד במודעות</h2>
        <span className="sub">השוואה בין קבוצות של מודעות לפי מה שרואים בהן · {byMeet ? 'הזולה ביותר לפגישה מסומנת' : 'הזולה ביותר לליד מסומנת'}</span>
      </div>
      <div className={meet ? 'ctz-grid ctz-meet' : 'ctz-grid'}>
        {tests.map(t => (
          <div key={t.key} className="ctz-card">
            <div className="ctz-head"><h3>{t.label}</h3>{t.indicative && <span className="ctz-ind">אינדיקציה בלבד</span>}</div>
            <div className="ctz-scroll"><table className="ctz-table">
              <thead><tr><th></th><th className="ctz-opt">מודעות</th><th>לידים</th><th className="ctz-opt">CTR</th><th className="ctz-opt">CPC</th><th>עלות לליד</th>{meet && <><th>פגישות</th><th>עלות לפגישה</th></>}</tr></thead>
              <tbody>{t.groups.map((g, i) => {
                const best = i === 0 && (t.rankBy === 'meeting' ? g.cpm != null : g.cpl != null)
                return (
                <tr key={g.value} className={best ? 'best' : undefined}>
                  <td className="ctz-name">{g.label}{best && <span className="ctz-best">הכי טוב</span>}</td>
                  <td className="ctz-opt">{g.ads}</td>
                  <td>{Number(g.leads || 0).toLocaleString('en-US')}</td>
                  <td className="ctz-opt">{g.ctr != null ? g.ctr.toFixed(2) + '%' : '-'}</td>
                  <td className="ctz-opt">{money(g.cpc, 2)}</td>
                  <td className={t.rankBy === 'lead' ? 'ctz-cpl' : undefined}>{money(g.cpl)}</td>
                  {meet && <><td>{g.meetings ?? '-'}</td><td className={t.rankBy === 'meeting' ? 'ctz-cpl' : undefined}>{money(g.cpm)}</td></>}
                </tr>)
              })}
              </tbody>
            </table></div>
          </div>
        ))}
      </div>
      <p className="ctz-note">מבוסס על ביצועי המודעות בתקופה שנבחרה.{meet ? ` פגישות: פגישות שתואמו ב-CRM ללידים שהגיעו מהמודעה. כשיש במאפיין לפחות ${RANK_BY_MEETINGS_AT} פגישות - הדירוג לפי עלות לפגישה, אחרת לפי עלות לליד.` : ''} "אינדיקציה בלבד": באחת הקבוצות פחות מ-{MIN_LEADS} לידים{meet ? ` או פחות מ-${MIN_MEETINGS} פגישות` : ''}, ולכן עוד מוקדם להסיק. זו השוואה בין קבוצות, לא הוכחה שאלמנט מסוים גרם להבדל.</p>
    </div>
  )
}
