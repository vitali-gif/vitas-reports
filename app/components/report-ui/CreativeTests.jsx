'use client'
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, X, ImageOff, Layers3, Sparkles } from 'lucide-react'
import CreativeCrossModal from '../admin/CreativeCrossModal.jsx'
import { apiFetch } from '../../../lib/api-fetch'
import { adsFromRows, creativeTests, MIN_LEADS, MIN_MEETINGS, RANK_BY_MEETINGS_AT } from '../../../lib/ad-tags.js'

// "מה עובד במודעות" בטאב Facebook (ויטלי, 5.11): אותה השוואה כמו בדוח ה-PDF — קבוצות של מודעות לפי
// מה שרואים בהן (lib/ad-tags.js), עם לידים, CTR, CPC ועלות לליד, ופגישות ועלות לפגישה כשה-CRM שומר את מזהה
// המודעה. rows: כל שורות התקופה (פייסבוק + CRM). הסיווגים מ-/api/ad-tags, רק למודעות של הפרויקט.
// התוצאה שמעבר לליד: פגישות (BMBY / Fireberry, לפי מזהה מודעה) או רכישות (Zoho, לפי שם מודעה — 6.11)
const OUT = {
  meeting: { key: 'meetings', cost: 'cpm', label: 'פגישות', costLabel: 'עלות לפגישה', one: 'פגישה', note: 'פגישות: פגישות שתואמו ב-CRM ללידים שהגיעו מהמודעה.' },
  purchase: { key: 'purchases', cost: 'cpp', label: 'רכישות', costLabel: 'עלות לרכישה', one: 'רכישה', note: 'רכישות: מה-CRM, לפי שם המודעה של הליד; שם שמופיע בכמה מודעות מתחלק ביניהן לפי הלידים.' },
}
const money = (v, d = 0) => (v == null ? '-' : '₪' + Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))

// פרטי המודעה להצגה (תמונה, שם, כותרת) מתוך activeAds של דוחות הפייסבוק בתקופה
function creativesById(rows) {
  const m = new Map()
  for (const r of (rows || []).filter(r => r.source === 'facebook')) {
    for (const a of r.summary?.activeAds || []) { const id = String(a.id || ''); if (id && !m.has(id)) m.set(id, a) }
    for (const d of Array.isArray(r.data) ? r.data : []) { const id = String(d.adId || ''); if (id && !m.has(id)) m.set(id, { id, name: d.adName }) }
  }
  return m
}

// "צילום אמיתי — אילו מודעות?" (ויטלי, 6.11): לחיצה על שורה פותחת את המודעות של הקבוצה
// תמונות טריות מהשרת (/api/ad-images) — הקישורים ששמורים בדוח פגים, ולמודעה לא פעילה אין קישור. נשמר בזיכרון לפי מזהה.
const _imgCache = new Map()
function GroupAds({ test, group, ads, creatives, out, onClose, projectId }) {
  const [imgs, setImgs] = useState(() => Object.fromEntries(group.adIds.filter(id => _imgCache.has(id)).map(id => [id, _imgCache.get(id)])))
  const [loadingImgs, setLoadingImgs] = useState(true)
  useEffect(() => {
    let off = false
    const need = group.adIds.filter(id => !_imgCache.has(id))
    if (!projectId || !need.length) { setLoadingImgs(false); return }
    ;(async () => {
      for (let i = 0; i < need.length && !off; i += 12) {
        const part = need.slice(i, i + 12)
        const b = await apiFetch(`/api/ad-images?projectId=${projectId}&ids=${part.join(',')}`, { headers: {} })
          .then(r => (r && r.ok ? r.json() : null)).catch(() => null)
        for (const id of part) _imgCache.set(id, b?.images?.[id] || null)
        if (!off && b?.images) setImgs(cur => ({ ...cur, ...b.images }))
      }
      if (!off) setLoadingImgs(false)
    })()
    return () => { off = true }
  }, [group, projectId])
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const byId = new Map(ads.map(a => [a.adId, a]))
  const list = group.adIds.map(id => ({ ...(byId.get(id) || { adId: id }), c: creatives.get(id) || {} }))
    .sort((a, b) => (b.meetings || 0) - (a.meetings || 0) || (b.leads || 0) - (a.leads || 0) || (b.spend || 0) - (a.spend || 0))
  return (
    <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{ zIndex: 9999 }}>
      <div className="modal ctz-modal" role="dialog" aria-label={`${test.label}: ${group.label}`}>
        <div className="ctz-modal-head">
          <div><div className="ctz-modal-kicker">{test.label}</div><h3>{group.label} · {list.length} מודעות</h3></div>
          <button type="button" className="ctz-x" onClick={onClose} aria-label="סגירה"><X size={20} /></button>
        </div>
        <div className="ctz-ads">
          {list.map(a => {
            const img = imgs[a.adId]
            return (
              <div key={a.adId} className="ctz-ad">
                <div className={loadingImgs && !img ? 'ctz-ad-img ctz-loading' : 'ctz-ad-img'}>{img ? <img src={img} alt="" /> : loadingImgs ? null : <ImageOff size={22} aria-hidden="true" />}</div>
                <div className="ctz-ad-body">
                  <div className="ctz-ad-name" dir="auto">{a.c.name || a.name || a.adId}</div>
                  {a.c.title && <div className="ctz-ad-title" dir="auto">{a.c.title}</div>}
                  <div className="ctz-ad-nums">
                    <span>{Number(a.leads || 0)} לידים</span>
                    {out && <span>{Math.round((a[out.key] ?? 0) * 10) / 10} {out.label}</span>}
                    <span>הוצאה {money(a.spend)}</span>
                    <span>לליד {money(a.leads > 0 ? a.spend / a.leads : null)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {!loadingImgs && list.some(a => !imgs[a.adId]) && <p className="ctz-note">מודעה שנמחקה במטא מוצגת בלי תמונה.</p>}
      </div>
    </div>
  )
}

export default function CreativeTests({ rows, projectId, isAdmin = false, periodKey = '' }) {
  const [cross, setCross] = useState(false)   // ניתוח רוחבי — אדמין בלבד (6.11)
  const ads = useMemo(() => adsFromRows(rows), [rows])
  const creatives = useMemo(() => creativesById(rows), [rows])
  const [open, setOpen] = useState(null)   // { test, group }
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
  const out = tests.some(t => t.hasMeetings) ? OUT.meeting : tests.some(t => t.hasPurchases) ? OUT.purchase : null
  const meet = !!out
  const byMeet = tests.some(t => t.rankBy === 'meeting' || t.rankBy === 'purchase')
  return (
    <div className="section section-creative-tests" id="creative-tests">
      <div className="section-head">
        <div className="ico violet" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg></div>
        <h2>מה עובד במודעות</h2>
        {isAdmin && <button type="button" className="ctx-open" onClick={() => setCross(true)}><Layers3 size={14} aria-hidden="true" />כל הלקוחות</button>}
        <span className="sub">השוואה בין קבוצות של מודעות לפי מה שרואים בהן · {byMeet ? `הזולה ביותר ל${out.one} מסומנת` : 'הזולה ביותר לליד מסומנת'}</span>
      </div>
      <div className={meet ? 'ctz-grid ctz-meet' : 'ctz-grid'}>
        {tests.map(t => (
          <div key={t.key} className="ctz-card">
            <div className="ctz-head"><h3>{t.label}</h3>{t.indicative && <span className="ctz-ind">מעט נתונים עדיין</span>}</div>
            <div className="ctz-rank">{t.rankBy !== 'lead' ? `דירוג לפי ${out.costLabel}` : meet ? `דירוג לפי עלות לליד — עוד מעט ${out.label} להשוואה` : 'דירוג לפי עלות לליד'}</div>
            <div className="ctz-scroll"><table className="ctz-table">
              <thead><tr><th></th><th className="ctz-opt">מודעות</th><th>לידים</th><th className="ctz-opt">CTR</th><th className="ctz-opt">CPC</th><th>עלות לליד</th>{meet && <><th>{out.label}</th><th>{out.costLabel}</th></>}</tr></thead>
              <tbody>{t.groups.map((g, i) => {
                const best = i === 0 && (t.rankBy !== 'lead' ? g[out.cost] != null : g.cpl != null)
                return (
                <tr key={g.value} className={best ? 'ctz-row best' : 'ctz-row'} tabIndex={0} role="button" aria-label={`${g.label} — הצגת המודעות`}
                  onClick={() => setOpen({ test: t, group: g })} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen({ test: t, group: g }) } }}>
                  <td className="ctz-name"><span className="ctz-name-in">{g.label}<ChevronLeft size={14} aria-hidden="true" className="ctz-go" /></span>{best && <span className="ctz-best">הכי טוב</span>}</td>
                  <td className="ctz-opt">{g.ads}</td>
                  <td>{Number(g.leads || 0).toLocaleString('en-US')}</td>
                  <td className="ctz-opt">{g.ctr != null ? g.ctr.toFixed(2) + '%' : '-'}</td>
                  <td className="ctz-opt">{money(g.cpc, 2)}</td>
                  <td className={t.rankBy === 'lead' ? 'ctz-cpl' : undefined}>{money(g.cpl)}</td>
                  {meet && <><td>{g[out.key] ?? '-'}</td><td className={t.rankBy !== 'lead' ? 'ctz-cpl' : undefined}>{money(g[out.cost])}</td></>}
                </tr>)
              })}
              </tbody>
            </table></div>
          </div>
        ))}
      </div>
      {cross && <CreativeCrossModal periodKey={periodKey} onClose={() => setCross(false)} />}
      {open && <GroupAds test={open.test} group={open.group} ads={ads} creatives={creatives} out={out} projectId={projectId} onClose={() => setOpen(null)} />}
      <p className="ctz-note">לחיצה על שורה מציגה את המודעות שבקבוצה. מבוסס על ביצועי המודעות בתקופה שנבחרה.{meet ? ` ${out.note} כשיש במאפיין לפחות ${RANK_BY_MEETINGS_AT} ${out.label} - הדירוג לפי ${out.costLabel}, אחרת לפי עלות לליד.` : ''} "מעט נתונים עדיין": באחת הקבוצות פחות מ-{MIN_LEADS} לידים{meet ? ` או פחות מ-${MIN_MEETINGS} ${out.label}` : ''}, ולכן עוד מוקדם להסיק. זו השוואה בין קבוצות, לא הוכחה שאלמנט מסוים גרם להבדל.</p>
    </div>
  )
}

// ── "מה עובד במודעות" בראש הדשבורד (ויטלי, 6.11: "אחד הנתונים הכי חשובים בדשבורד, אבל הוא בתחתית ולא
// ישימו לב אליו"). שלושת הממצאים החזקים — מ-12 החודשים האחרונים (/api/ad-tags/year), כי חודש אחד הוא
// לרוב "אינדיקציה בלבד". ממצא = הקבוצה הזולה מול הקבוצה הגדולה האחרת (לפי הוצאה) באותו מאפיין.
const COST = { meeting: ['cpm', 'עלות לפגישה'], purchase: ['cpp', 'עלות לרכישה'], lead: ['cpl', 'עלות לליד'] }
export function topFindings(tests, max = 3) {
  const out = []
  for (const t of tests || []) {
    const [k, costLabel] = COST[t.rankBy] || COST.lead
    const best = t.groups[0]
    if (!best || best[k] == null || best.value === 'other') continue
    const rest = t.groups.slice(1).filter(g => g[k] != null && g.value !== 'other').sort((a, b) => b.spend - a.spend)
    const other = rest[0]
    if (!other || !(other[k] > best[k])) continue
    out.push({ key: t.key, dim: t.label, best, other, costLabel, cost: k, gap: Math.round((1 - best[k] / other[k]) * 100), indicative: t.indicative })
  }
  // ממצאים מבוססים קודם, ובתוכם הפער הגדול
  return out.filter(f => f.gap >= 10).sort((a, b) => (a.indicative - b.indicative) || (b.gap - a.gap)).slice(0, max)
}

export function CreativeHighlights({ projectId, periodKey, onMore }) {
  const [year, setYear] = useState(undefined)
  useEffect(() => {
    let off = false
    setYear(undefined)
    if (!projectId) return
    apiFetch(`/api/ad-tags/year?projectId=${projectId}&key=${encodeURIComponent(periodKey || '')}`, { headers: {} })
      .then(r => (r && r.ok ? r.json() : null)).then(b => { if (!off) setYear(b?.year || null) }).catch(() => { if (!off) setYear(null) })
    return () => { off = true }
  }, [projectId, periodKey])
  const finds = useMemo(() => topFindings(year?.tests), [year])
  if (!finds.length) return null
  return (
    <div className="section cth" aria-label="מה עובד במודעות">
      <div className="cth-head">
        <span className="cth-ico" aria-hidden="true"><Sparkles size={16} /></span>
        <h2>מה עובד במודעות</h2>
        <span className="cth-sub">12 החודשים האחרונים · {year.ads} מודעות</span>
        {onMore && <button type="button" className="cth-more" onClick={onMore}>לכל הניתוח<ChevronLeft size={14} aria-hidden="true" /></button>}
      </div>
      <div className="cth-list">
        {finds.map(f => (
          <div key={f.key} className="cth-item">
            <div className="cth-gap"><b>{f.gap}%</b><span>זול יותר</span></div>
            <div className="cth-txt">
              <div className="cth-dim">{f.dim}{f.indicative && <span className="ctz-ind">מעט נתונים עדיין</span>}</div>
              <div className="cth-line"><b>{f.best.label}</b></div>
              <div className="cth-vs">{f.costLabel} <bdi>{money(f.best[f.cost])}</bdi>, לעומת <bdi>{money(f.other[f.cost])}</bdi> ב&quot;{f.other.label}&quot;</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
