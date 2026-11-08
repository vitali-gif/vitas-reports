'use client'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api-fetch'

// "שימוש לקוחות" (ויטלי, 6.11): מי נכנס, כמה זמן באמת עבד, מאיזה מכשיר, אילו טאבים וסעיפים ראה,
// ומה כדאי לשפר עבורו. הנתונים מ-/api/client-log?view=usage|user (מיגרציה 029, lib/usage-track.js).
// הטאב "כל הכניסות" הוא הלוג הקודם.
const TABS = { all: 'הכל', crm: 'CRM', facebook: 'Facebook', google: 'Google', google_pmax: 'Google PMax', google_search: 'Google Search', meetings: 'ישיבות שיווק', recommendations: 'המלצות חכמות', value: 'ערך הדשבורד' }
const CRM_VIEWS = { sources: 'מקורות הגעה', response: 'זמני תגובה', objections: 'התנגדויות', reports: 'יישובים', meetings: 'פגישות שבוצעו' }
const DEVICES = { mobile: 'טלפון', tablet: 'טאבלט', desktop: 'מחשב' }
const EVENT_LABEL = { tab: 'טאב', crm_view: 'CRM', period: 'תקופה', compare: 'השוואה', section: 'צפה', help: 'איך זה עוזר לך', ai_open: 'ניתוח דוח', modal: 'פתח רשימת לידים' }

const fmtMin = (sec) => { if (sec == null) return '-'; const m = Math.round(sec / 60); return m < 60 ? `${m} דק׳` : `${Math.floor(m / 60)} שע׳ ${m % 60} דק׳` }
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-')
function ago(iso) {
  if (!iso) return '-'
  const d = (Date.now() - new Date(iso).getTime()) / 864e5
  if (d < 1 / 24) return 'עכשיו'
  if (d < 1) return `לפני ${Math.round(d * 24)} שע׳`
  if (d < 2) return 'אתמול'
  return `לפני ${Math.round(d)} ימים`
}
const periodLabel = (k) => {
  const s = String(k || '')
  if (s.includes('_')) { const [a, b] = s.split('_'); return `${a.slice(8, 10)}.${a.slice(5, 7)} עד ${b.slice(8, 10)}.${b.slice(5, 7)}` }
  return /^\d{4}-\d{2}$/.test(s) ? `${s.slice(5, 7)}/${s.slice(0, 4)}` : s
}
function eventText(e) {
  const d = e.detail || {}
  if (e.name === 'tab') return TABS[d.tab] || d.tab
  if (e.name === 'crm_view') return CRM_VIEWS[d.view] || d.view
  if (e.name === 'period') return periodLabel(d.period)
  if (e.name === 'section' || e.name === 'help') return d.title
  return ''
}

// מה אפשר ללמוד מהמשתמש — משפטים קצרים, בלי שיפוט
function insights(u) {
  const out = []
  const devTotal = Object.values(u.devices || {}).reduce((a, b) => a + b, 0)
  const mobile = (u.devices?.mobile || 0) / (devTotal || 1)
  if (devTotal >= 2 && mobile >= 0.6) out.push('נכנס בעיקר מהטלפון - כדאי לבדוק שהסעיפים שהוא רואה נוחים בטלפון')
  if (u.sessions >= 3 && u.activeSec != null && u.activeSessions && u.activeSec / u.activeSessions < 90) out.push('כניסות קצרות (פחות מדקה וחצי בממוצע) - כנראה מחפש מספר אחד. אולי כדאי לשים אותו בראש המסך או לשלוח בדוח שבועי')
  const tabs = Object.fromEntries(u.tabs || [])
  const seenTabs = Object.keys(tabs)
  if (seenTabs.length && seenTabs.every(t => t === 'all')) out.push('לא עובר בין טאבים - רואה רק את "הכל"')
  if (seenTabs.length && !tabs.crm && u.sections?.length) out.push('לא פתח את טאב ה-CRM')
  if ((u.periods?.range || 0) > (u.periods?.month || 0) && u.periods.range >= 2) out.push('בוחר טווחי תאריכים יותר מחודשים - אולי כדאי טווח ברירת מחדל אחר')
  if (u.sections?.length >= 5 && !(u.help || []).length) out.push('לא לחץ על "איך זה עוזר לך?"')
  if ((u.help || []).length) out.push(`ביקש הסבר על: ${(u.help || []).slice(0, 3).map(h => h[0]).join(', ')}`)
  const times = (n) => (n === 1 ? 'פעם אחת' : `${n} פעמים`)
  if (u.compare) out.push(`השתמש בהשוואה ${times(u.compare)}`)
  if (u.modals) out.push(`פתח רשימות לידים ${times(u.modals)}`)
  if (u.lastAt && (Date.now() - new Date(u.lastAt).getTime()) / 864e5 > 14) out.push('לא נכנס יותר משבועיים - אולי שווה לשלוח לו תזכורת או דוח')
  return out
}

const card = { background: 'var(--tv-surface,#fff)', border: '1px solid var(--tv-border,#e2e8f0)', borderRadius: 14, padding: '14px 16px' }
const chip = { display: 'inline-block', background: 'var(--tv-surface-2,#f1f5f9)', borderRadius: 999, padding: '2px 10px', fontSize: 12, margin: '0 0 4px 4px', color: 'var(--tv-text-secondary,#475569)' }
const muted = { color: 'var(--tv-text-muted,#64748b)', fontSize: 12 }

function Bars({ list, map, max = 6 }) {
  if (!list || !list.length) return <div style={muted}>-</div>
  const top = list.slice(0, max), m = Math.max(...top.map(x => x[1]))
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {top.map(([k, n]) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px,150px) 1fr 28px', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={map?.[k] || k}>{map?.[k] || k}</span>
          <span style={{ height: 8, borderRadius: 4, background: 'var(--tv-brand,#315cf5)', opacity: 0.75, width: `${Math.max(6, (n / m) * 100)}%` }} />
          <span style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
        </div>
      ))}
    </div>
  )
}

function Timeline({ email, days }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    let off = false
    apiFetch(`/api/client-log?view=user&days=${days}&email=${encodeURIComponent(email)}`, { headers: {} })
      .then(r => r.json()).then(d => { if (!off) setData(d.sessions || []) }).catch(() => { if (!off) setData([]) })
    return () => { off = true }
  }, [email, days])
  if (!data) return <div style={{ ...muted, padding: 10 }}>טוען...</div>
  if (!data.length) return <div style={{ ...muted, padding: 10 }}>אין כניסות בתקופה</div>
  // כניסות מלפני הפעלת המעקב (6.11): אין להן זמן עבודה ולא פעולות — שורה אחת במקום רשימה של "אין פעולות"
  const tracked = data.filter(s => s.active_sec != null)
  const before = data.length - tracked.length
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
      {tracked.slice(0, 25).map(s => (
        <div key={s.id} style={{ borderInlineStart: '3px solid var(--tv-brand,#315cf5)', paddingInlineStart: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            {fmtDate(s.logged_in_at)} · זמן עבודה {fmtMin(s.active_sec)}
            {s.device ? ` · ${DEVICES[s.device] || s.device}` : ''}{s.selected_project ? ` · ${s.selected_project}` : ''}
            {s.isActive && <span style={{ color: '#059669', marginInlineStart: 6 }}>● עובד עכשיו</span>}
          </div>
          <div style={{ marginTop: 4 }}>
            {s.events.length ? s.events.map((e, i) => (
              <span key={i} style={{ ...chip, ...(e.name === 'tab' ? { background: 'var(--tv-brand-soft,#eef2ff)', color: 'var(--tv-brand,#315cf5)', fontWeight: 600 } : {}), ...(e.name === 'help' ? { background: '#fff7e6', color: '#92400e' } : {}) }} title={fmtDate(e.at)}>
                {EVENT_LABEL[e.name] || e.name}{eventText(e) ? `: ${eventText(e)}` : ''}
              </span>
            )) : <span style={muted}>לא נרשמו פעולות - נכנס ויצא</span>}
          </div>
        </div>
      ))}
      {before > 0 && (
        <div style={{ ...muted, borderInlineStart: '3px solid var(--tv-border,#e2e8f0)', paddingInlineStart: 10 }}>
          {tracked.length ? 'ועוד' : ''} {before} כניסות מלפני הפעלת המעקב (6.11). בהן ידוע רק מתי נכנס - לא כמה זמן עבד ומה עשה.
        </div>
      )}
    </div>
  )
}

function SessionsTable() {
  const [rows, setRows] = useState(null)
  useEffect(() => { apiFetch('/api/client-log', { headers: {} }).then(r => r.json()).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([])) }, [])
  if (!rows) return <div style={{ ...muted, padding: 20, textAlign: 'center' }}>טוען...</div>
  if (!rows.length) return <div style={{ ...muted, padding: 20, textAlign: 'center' }}>אין כניסות מתועדות עדיין</div>
  const th = { padding: '8px 10px', textAlign: 'start', fontWeight: 600, ...muted }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr style={{ borderBottom: '2px solid var(--tv-border,#e2e8f0)' }}><th style={th}>מייל</th><th style={th}>לקוח</th><th style={th}>כניסה</th><th style={th}>זמן עבודה</th><th style={th}>מכשיר</th><th style={th}>פרויקט</th><th style={th}>סטטוס</th></tr></thead>
        <tbody>{rows.map(s => (
          <tr key={s.id} style={{ borderBottom: '1px solid var(--tv-divider,#f1f5f9)' }}>
            <td style={{ padding: 10, direction: 'ltr', textAlign: 'left', fontFamily: 'monospace', fontSize: 12 }}>{s.email}</td>
            <td style={{ padding: 10, fontWeight: 600 }}>{s.client_name || '-'}</td>
            <td style={{ padding: 10, ...muted }}>{fmtDate(s.logged_in_at)}</td>
            <td style={{ padding: 10, fontWeight: 600 }}>{s.active_sec != null ? fmtMin(s.active_sec) : <span style={muted} title="כניסה מלפני הפעלת המעקב (6.11)">לא נמדד</span>}</td>
            <td style={{ padding: 10, ...muted }}>{DEVICES[s.device] || '-'}</td>
            <td style={{ padding: 10, ...muted }}>{s.selected_project || '-'}</td>
            <td style={{ padding: 10 }}>{s.isActive ? <span style={{ background: 'rgba(16,185,129,0.12)', color: '#059669', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>● פעיל כעת</span> : <span style={muted}>יצא</span>}</td>
          </tr>))}
        </tbody>
      </table>
    </div>
  )
}

export default function UsageModal({ onClose }) {
  const [tab, setTab] = useState('users')
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let off = false
    setData(null)
    apiFetch(`/api/client-log?view=usage&days=${days}`, { headers: {} }).then(r => r.json()).then(d => { if (!off) setData(d) }).catch(() => { if (!off) setData({ users: [] }) })
    return () => { off = true }
  }, [days, nonce])
  const users = data?.users || []
  // סעיפים — על פני כל המשתמשים: כמה משתמשים שונים ראו כל סעיף
  const sectionReach = useMemo(() => {
    const m = {}
    for (const u of users) for (const [t] of u.sections || []) m[t] = (m[t] || 0) + 1
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [users])
  const totals = useMemo(() => ({
    users: users.length,
    sessions: users.reduce((a, u) => a + u.sessions, 0),
    active: users.reduce((a, u) => a + (u.activeSec || 0), 0),
    mobile: users.reduce((a, u) => a + (u.devices?.mobile || 0), 0),
    devices: users.reduce((a, u) => a + Object.values(u.devices || {}).reduce((x, y) => x + y, 0), 0),
  }), [users])
  const btn = (on) => ({ border: '1px solid var(--tv-border,#e2e8f0)', background: on ? 'var(--tv-brand,#315cf5)' : 'var(--tv-surface,#fff)', color: on ? '#fff' : 'var(--tv-text-secondary,#475569)', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' })

  return (
    <div className="modal-overlay active" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 980, width: '100%', direction: 'rtl', maxHeight: '88vh', overflow: 'auto', background: 'var(--tv-bg,#f6f8fc)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>שימוש לקוחות</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={btn(tab === 'users')} onClick={() => setTab('users')}>לפי משתמש</button>
            <button style={btn(tab === 'sessions')} onClick={() => setTab('sessions')}>כל הכניסות</button>
            {tab === 'users' && [7, 30, 90].map(d => <button key={d} style={btn(days === d)} onClick={() => setDays(d)}>{d} ימים</button>)}
            <button style={btn(false)} onClick={() => setNonce(n => n + 1)} title="רענון">רענון</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#64748b', lineHeight: 1 }} aria-label="סגירה">&times;</button>
          </div>
        </div>

        {tab === 'sessions' ? <div style={card}><SessionsTable key={nonce} /></div> : !data ? (
          <div style={{ ...muted, padding: 32, textAlign: 'center' }}>טוען...</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
              {[['משתמשים שנכנסו', totals.users], ['כניסות', totals.sessions], ['זמן עבודה (כולם)', fmtMin(totals.active)], ['מהטלפון', totals.devices ? Math.round(totals.mobile / totals.devices * 100) + '%' : '-']].map(([l, v]) => (
                <div key={l} style={card}><div style={muted}>{l}</div><div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{v}</div></div>
              ))}
            </div>
            {!data.eventsReady && <div style={{ ...card, background: '#fff7e6', marginBottom: 12, fontSize: 13 }}>מעקב הפעולות עוד לא פעיל: צריך להריץ את מיגרציה 029. עד אז מוצגות רק הכניסות.</div>}
            {sectionReach.length > 0 && (
              <div style={{ ...card, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>אילו סעיפים לקוחות באמת רואים <span style={muted}>(כמה משתמשים ראו כל סעיף 3 שניות ומעלה)</span></div>
                <Bars list={sectionReach} max={12} />
              </div>
            )}
            <div style={{ display: 'grid', gap: 10 }}>
              {users.length === 0 && <div style={{ ...card, ...muted, textAlign: 'center' }}>אין כניסות בתקופה</div>}
              {users.map(u => {
                const ins = insights(u)
                const isOpen = open === u.email
                return (
                  <div key={u.email} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <div>
                        <span style={{ fontWeight: 800 }}>{u.client || '-'}</span>
                        <span style={{ ...muted, direction: 'ltr', unicodeBidi: 'isolate', marginInlineStart: 8, fontFamily: 'monospace' }}>{u.email}</span>
                      </div>
                      <div style={muted}>כניסה אחרונה: {ago(u.lastAt)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '8px 0', fontSize: 13 }}>
                      <span><b>{u.sessions}</b> כניסות</span>
                      <span><b>{u.days}</b> ימים שונים</span>
                      <span>{u.activeSec != null ? <>זמן עבודה <b>{fmtMin(u.activeSec)}</b>{u.activeSessions < u.sessions ? <span style={muted}> (ב-{u.activeSessions} כניסות שנמדדו)</span> : null}</> : <span style={muted}>זמן עבודה יימדד מהכניסה הבאה</span>}</span>
                      {Object.entries(u.devices || {}).map(([d, n]) => <span key={d} style={chip}>{DEVICES[d] || d} · {n}</span>)}
                      {u.projects.map(p => <span key={p} style={chip}>{p}</span>)}
                    </div>
                    {(u.tabs.length > 0 || u.sections.length > 0) && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, margin: '6px 0' }}>
                        <div><div style={{ ...muted, marginBottom: 4 }}>טאבים</div><Bars list={u.tabs} map={TABS} /></div>
                        <div><div style={{ ...muted, marginBottom: 4 }}>סעיפים שראה</div><Bars list={u.sections} /></div>
                      </div>
                    )}
                    {ins.length > 0 && (
                      <ul style={{ margin: '8px 0 0', paddingInlineStart: 18, fontSize: 13, lineHeight: 1.7 }}>
                        {ins.map(t => <li key={t}>{t}</li>)}
                      </ul>
                    )}
                    <button style={{ ...btn(false), marginTop: 8 }} onClick={() => setOpen(isOpen ? null : u.email)}>{isOpen ? 'סגירת הכניסות' : 'מה עשה בכל כניסה'}</button>
                    {isOpen && <Timeline email={u.email} days={days} />}
                  </div>
                )
              })}
            </div>
            <p style={{ ...muted, marginTop: 12, lineHeight: 1.6 }}>
              זמן עבודה: רק כשהמסך פתוח והייתה פעולה (גלילה, לחיצה) בשתי הדקות האחרונות - לשונית שנשכחה פתוחה לא נספרת. נמדד מ-6.11; בכניסות ישנות יותר ידוע רק מתי נכנס.
              לא נשמרים פרטי לידים - רק טאבים, תקופות, שמות סעיפים ולחיצות. משתמשי בדיקה לא נספרים.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
