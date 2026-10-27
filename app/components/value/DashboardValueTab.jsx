'use client'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api-fetch'
import { monthlySeries, valueSummary, monthlyTable, actionsTimeline } from '../../../lib/dashboard-value.js'

// טאב "ערך הדשבורד" (D8) — אדמין בלבד. מה השתפר בפרויקט מאז שהתחלנו: לפני מול עכשיו, מגמה
// חודשית, והפעולות שנעשו בדרך. החישובים ב-lib/dashboard-value.js (מהדוחות שכבר טעונים בדשבורד);
// תאריך ההקמה, הכניסות של הלקוח והפעולות מ-/api/value.

const money = (v) => (v == null ? '-' : '₪' + Math.round(v).toLocaleString('he-IL'))
const count = (v) => (v == null ? '-' : (Math.round(v * 10) / 10).toLocaleString('he-IL'))
const pct = (v) => (v == null ? '-' : Math.round(v) + '%')
const fmtDay = (iso) => { try { return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) } catch { return '-' } }
const fmt = (c, v) => (c.money ? money(v) : c.rate ? pct(v) : count(v))
const KIND = { task: 'משימה שנסגרה', meeting: 'החלטה מישיבה', ai: 'ניתוח AI' }

function Change({ c }) {
  if (c.change == null) return null
  const txt = c.rate ? `${c.change > 0 ? '+' : ''}${Math.round(c.change)} נק׳` : `${c.change > 0 ? '+' : ''}${Math.round(c.change)}%`
  return <span className={`dv-chg ${c.good == null ? 'flat' : c.good ? 'good' : 'bad'}`} dir="ltr">{c.change > 0 ? '▲' : c.change < 0 ? '▼' : ''} {txt}</span>
}

/** קו מגמה חודשי עם סימון של חודש ההתחלה בדשבורד. */
function Trend({ title, rows, field, color, startMonth, format }) {
  const pts = rows.map((r, i) => ({ i, v: r[field], label: r.label, partial: r.partial })).filter(p => p.v != null)
  if (pts.length < 2) return null
  const W = 340, H = 150, L = 24, R = 24, T = 18, B = 26
  const max = Math.max(...pts.map(p => p.v)) * 1.12 || 1
  // מימין לשמאל, כמו שאר הדף: החודש הישן בצד ימין
  const x = (i) => W - R - (rows.length === 1 ? 0 : (i / (rows.length - 1)) * (W - L - R))
  const y = (v) => T + (1 - v / max) * (H - T - B)
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const si = rows.findIndex(r => r.month >= startMonth)
  const short = (label) => String(label || '').split(' ')[0].slice(0, 3)
  return (
    <figure className="dv-trend">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {si > 0 && <g><line x1={x(si)} x2={x(si)} y1={T - 8} y2={H - B} className="dv-start" /><text x={x(si)} y={T - 10} textAnchor="middle" className="dv-start-t">התחלנו</text></g>}
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
        {pts.map(p => <g key={p.i}>
          <circle cx={x(p.i)} cy={y(p.v)} r="3.5" fill={p.partial ? '#fff' : color} stroke={color} strokeWidth="2" />
          <text x={x(p.i)} y={y(p.v) - 8} textAnchor="middle" className="dv-pt">{format(p.v)}</text>
        </g>)}
        {rows.map((r, i) => <text key={r.month} x={x(i)} y={H - 8} textAnchor="middle" className="dv-ax">{short(r.label)}</text>)}
      </svg>
    </figure>
  )
}

export default function DashboardValueTab({ projectId, reports }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    setInfo(null); setErr('')
    apiFetch(`/api/value?projectId=${projectId}`, { headers: {} })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (live) { if (ok) setInfo(b); else setErr(b?.error || 'טעינה נכשלה') } })
      .catch(() => live && setErr('טעינה נכשלה'))
    return () => { live = false }
  }, [projectId])

  const series = useMemo(() => monthlySeries((reports || []).filter(r => r.project_id == null || r.project_id === projectId)), [reports, projectId])
  const summary = useMemo(() => valueSummary(series), [series])
  const table = useMemo(() => monthlyTable(series), [series])
  const timeline = useMemo(() => actionsTimeline(info || {}), [info])
  const startMonth = info?.project?.createdAt ? String(info.project.createdAt).slice(0, 7) : ''
  const usesSales = table.some(r => r.cps != null) && !table.some(r => r.cpm != null)

  return (
    <div className="dv">
      <div className="dv-head">
        <div>
          <h2>ערך הדשבורד</h2>
          <p>מה השתפר בפרויקט מאז שהתחלנו. רק אדמין רואה את הטאב הזה.</p>
        </div>
      </div>

      <div className="dv-facts">
        <div><span>בדשבורד מאז</span><b>{info ? fmtDay(info.project.createdAt) : '…'}</b></div>
        <div><span>הלקוח נכנס לראשונה</span><b>{info ? (info.usage.firstLogin ? fmtDay(info.usage.firstLogin) : 'עוד לא נכנס') : '…'}</b></div>
        <div><span>כניסות של הלקוח ב-30 יום</span><b>{info ? `${info.usage.logins30d}${info.usage.users ? ` (${info.usage.users} משתמשים)` : ''}` : '…'}</b></div>
      </div>
      {err && <div className="dv-err">{err}</div>}

      <section className="dv-sec">
        <h3>לפני מול עכשיו</h3>
        {summary.enough ? <>
          <p className="dv-cap">ממוצע חודשי: <b>{summary.before.label}</b> (החודשים הראשונים עם פרסום ו-CRM) מול <b>{summary.after.label}</b> (החודשים המלאים האחרונים).</p>
          <div className="dv-cards">{summary.cards.map(c => (
            <div key={c.key} className="dv-card">
              <div className="dv-l">{c.label}</div>
              <div className="dv-v"><span className="dv-b">{fmt(c, c.before)}</span><span className="dv-arrow">←</span><b>{fmt(c, c.after)}</b></div>
              <Change c={c} />
            </div>))}
          </div>
        </> : <p className="dv-cap">צריך לפחות {summary.needed} חודשים מלאים עם פרסום ו-CRM כדי להשוות. יש כרגע {summary.fullMonths}.</p>}
      </section>

      {table.length > 1 && <section className="dv-sec">
        <h3>חודש אחרי חודש</h3>
        <div className="dv-trends">
          <Trend title="עלות לליד" rows={table} field="cpl" color="#4559df" startMonth={startMonth} format={money} />
          {usesSales
            ? <Trend title="עלות למכירה" rows={table} field="cps" color="#119e8c" startMonth={startMonth} format={money} />
            : <Trend title="עלות לפגישה שבוצעה" rows={table} field="cpm" color="#119e8c" startMonth={startMonth} format={money} />}
          <Trend title={usesSales ? 'ליד ← מכירה' : 'ליד ← פגישה שבוצעה'} rows={table} field={usesSales ? 'leadToSale' : 'leadToMeeting'} color="#9257d1" startMonth={startMonth} format={pct} />
        </div>
        <div className="dv-table-wrap"><table className="dv-table">
          <thead><tr><th>חודש</th><th>הוצאה</th><th>לידים</th><th>עלות לליד</th>{usesSales ? <><th>מכירות</th><th>עלות למכירה</th><th>ליד ← מכירה</th></> : <><th>פגישות שבוצעו</th><th>עלות לפגישה</th><th>ליד ← פגישה</th></>}</tr></thead>
          <tbody>{table.map(r => (
            <tr key={r.month} className={r.month === startMonth ? 'dv-start-row' : ''}>
              <td>{r.label}{r.partial ? <small> (עד היום)</small> : ''}{r.month === startMonth ? <small className="dv-tag">התחלנו</small> : ''}</td>
              <td>{money(r.spend)}</td><td>{count(r.leads)}</td><td>{money(r.cpl)}</td>
              {usesSales ? <><td>{count(r.closed)}</td><td>{money(r.cps)}</td><td>{pct(r.leadToSale)}</td></> : <><td>{count(r.meetDone)}</td><td>{money(r.cpm)}</td><td>{pct(r.leadToMeeting)}</td></>}
            </tr>))}
          </tbody>
        </table></div>
      </section>}

      <section className="dv-sec">
        <h3>מה עשינו בדרך</h3>
        {timeline.length ? <ul className="dv-actions">{timeline.slice(0, 20).map((a, i) => (
          <li key={i}><span className={`dv-kind dv-kind-${a.kind}`}>{KIND[a.kind]}</span><div><b>{a.title}</b>{a.detail ? <p>{a.detail}</p> : null}</div><time>{fmtDay(a.date)}</time></li>))}
        </ul> : <p className="dv-cap">עוד אין פעולות מתועדות. משימות שנסגרות, החלטות מישיבות שיווק וניתוחי AI יופיעו כאן לפי תאריך.</p>}
      </section>

      <p className="dv-note">השינויים כאן נמדדו בנתונים. הם לא מוכיחים שהשיפור נבע מהדשבורד בלבד: גם תקציב, עונה, מלאי הדירות והמחירים משפיעים.</p>
    </div>
  )
}
