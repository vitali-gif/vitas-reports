'use client'
// שאלון הקליטה ללקוח - /onboard/<token> (ויטלי, 7.11). השאלות: lib/onboarding-form.js; שמירה: /api/public/onboarding-form.
// בלי משתמש: הטוקן שבקישור הוא ההרשאה. שמירה אוטומטית שנייה וחצי אחרי כל שינוי; אפשר לחזור בכל זמן.
// בלי פיקסלים ובלי סקריפטים חיצוניים בדף הזה.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { FORM, visible, isFilled, progress, ECOM_TYPE, labelOf, accessMessage } from '../../../lib/onboarding-form.js'
import { supabase } from '../../../lib/supabase'

const css = `
.obf { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --brand:#2563eb; --brand-bg:#eff6ff; --ok:#047857; --ok-bg:#ecfdf5; --bg:#f8fafc;
  min-height:100vh; background:var(--bg); color:var(--ink); font-family:'Heebo',system-ui,sans-serif; direction:rtl; padding:0 16px 80px; }
.obf-wrap { max-width:720px; margin:0 auto; }
.obf-top { position:sticky; top:0; z-index:5; background:var(--bg); padding:14px 0 10px; border-bottom:1px solid var(--line); margin-bottom:18px; }
.obf-brand { font-weight:800; color:var(--brand); font-size:14px; letter-spacing:.2px; }
.obf-top h1 { margin:2px 0 8px; font-size:22px; font-weight:800; }
.obf-bar { height:8px; background:var(--line); border-radius:99px; overflow:hidden; }
.obf-bar > span { display:block; height:100%; background:var(--brand); border-radius:99px; transition:width .3s; }
.obf-meta { display:flex; justify-content:space-between; font-size:12.5px; color:var(--muted); margin-top:6px; }
.obf-intro { background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px 16px; font-size:14.5px; line-height:1.6; margin-bottom:16px; }
.obf-sec { background:#fff; border:1px solid var(--line); border-radius:16px; padding:18px 18px 8px; margin-bottom:16px; }
.obf-sec h2 { margin:0; font-size:18px; font-weight:800; display:flex; align-items:center; gap:8px; }
.obf-num { display:inline-grid; place-items:center; width:26px; height:26px; border-radius:8px; background:var(--brand-bg); color:var(--brand); font-size:13px; }
.obf-why { color:var(--muted); font-size:13.5px; margin:6px 0 14px; }
.obf-q { margin-bottom:18px; }
.obf-label { display:block; font-weight:700; font-size:14.5px; margin-bottom:6px; }
.obf-req { color:#dc2626; margin-inline-start:4px; }
.obf-help { font-size:12.5px; color:var(--muted); margin:-2px 0 8px; line-height:1.5; }
.obf input[type=text], .obf textarea, .obf select { width:100%; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:10px; padding:10px 12px; font:inherit; font-size:15px; background:#fff; color:var(--ink); }
.obf textarea { min-height:96px; resize:vertical; }
.obf input:focus, .obf textarea:focus, .obf select:focus { outline:2px solid var(--brand); outline-offset:1px; border-color:transparent; }
.obf-opts { display:flex; flex-wrap:wrap; gap:8px; }
.obf-opt { border:1px solid #cbd5e1; background:#fff; border-radius:99px; padding:8px 14px; font:inherit; font-size:14px; cursor:pointer; color:var(--ink); }
.obf-opt.on { background:var(--brand); border-color:var(--brand); color:#fff; }
.obf-done { display:flex; align-items:center; gap:10px; border:1px dashed #cbd5e1; border-radius:12px; padding:10px 12px; }
.obf-done button { flex:none; border:1px solid #cbd5e1; background:#fff; border-radius:10px; padding:8px 14px; font:inherit; font-weight:700; cursor:pointer; }
.obf-done.on { border-style:solid; border-color:var(--ok); background:var(--ok-bg); }
.obf-done.on button { background:var(--ok); border-color:var(--ok); color:#fff; }
.obf-row { display:grid; gap:8px; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); border:1px solid var(--line); border-radius:12px; padding:10px; margin-bottom:8px; position:relative; }
.obf-row .obf-x { position:absolute; top:6px; left:6px; border:0; background:none; color:var(--muted); font-size:18px; cursor:pointer; padding:2px 6px; }
.obf-row label { font-size:12px; color:var(--muted); display:block; margin-bottom:3px; }
.obf-add { border:1px dashed var(--brand); color:var(--brand); background:var(--brand-bg); border-radius:10px; padding:8px 14px; font:inherit; font-weight:700; cursor:pointer; }
.obf-foot { position:fixed; bottom:0; left:0; right:0; background:#fff; border-top:1px solid var(--line); padding:10px 16px; }
.obf-foot-in { max-width:720px; margin:0 auto; display:flex; align-items:center; gap:12px; }
.obf-save { font-size:13px; color:var(--muted); flex:1; }
.obf-submit { border:0; background:var(--brand); color:#fff; border-radius:12px; padding:11px 20px; font:inherit; font-weight:800; font-size:15px; cursor:pointer; }
.obf-msgbox pre { white-space:pre-wrap; background:#f1f5f9; border:1px solid var(--line); border-radius:12px; padding:12px 14px; font:inherit; font-size:13.5px; line-height:1.65; margin:0 0 10px; max-height:420px; overflow:auto; }
.obf-file { display:flex; align-items:center; gap:10px; border:1px solid var(--line); border-radius:10px; padding:8px 10px; margin-bottom:6px; font-size:14px; }
.obf-file span:first-child { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.obf-muted { color:var(--muted); font-size:12.5px; }
.obf-x2 { border:0; background:none; color:var(--muted); font-size:18px; cursor:pointer; }
.obf-msg { max-width:520px; margin:80px auto; background:#fff; border:1px solid var(--line); border-radius:16px; padding:24px; text-align:center; line-height:1.7; }
`

function MessageBox({ answers }) {
  const text = accessMessage(answers)
  const [copied, setCopied] = useState(false)
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { /* העתקה ידנית */ } }
  return (
    <div className="obf-msgbox">
      <pre dir="rtl">{text}</pre>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="obf-add" onClick={copy}>{copied ? '✓ הועתק' : 'העתקת ההודעה'}</button>
        <a className="obf-add" style={{ textDecoration: 'none' }} href={'https://wa.me/?text=' + encodeURIComponent(text)} target="_blank" rel="noreferrer">שליחה בוואטסאפ</a>
      </div>
    </div>
  )
}

const MAX_MB = 25
function Files({ token, value, onChange }) {
  const list = Array.isArray(value) ? value : []
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const pick = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = ''
    setErr('')
    let cur = list
    for (const f of files) {
      if (f.size > MAX_MB * 1024 * 1024) { setErr(`${f.name}: גדול מ-${MAX_MB}MB`); continue }
      setBusy(f.name)
      const r = await fetch('/api/public/onboarding-form/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name: f.name, type: f.type, size: f.size }) }).catch(() => null)
      const b = r ? await r.json().catch(() => ({})) : {}
      if (!b.path) { setErr(b.error || `${f.name}: ההעלאה נכשלה`); continue }
      const { error } = await supabase.storage.from(b.bucket).uploadToSignedUrl(b.path, b.uploadToken, f, { contentType: f.type || 'application/octet-stream' })
      if (error) { setErr(`${f.name}: ההעלאה נכשלה`); continue }
      cur = [...cur, { name: f.name, path: b.path, size: f.size, type: f.type }]
      onChange(cur)
    }
    setBusy('')
  }
  const kb = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB')
  return (
    <div>
      {list.map((f, i) => (
        <div key={f.path} className="obf-file"><span dir="auto">{f.name}</span><span className="obf-muted">{kb(f.size)}</span>
          <button type="button" className="obf-x2" aria-label="הסרה" onClick={() => onChange(list.filter((_, j) => j !== i))}>×</button></div>
      ))}
      <label className="obf-add" style={{ display: 'inline-block', cursor: 'pointer' }}>
        {busy ? `מעלה: ${busy}…` : '+ העלאת קבצים'}
        <input type="file" multiple hidden disabled={!!busy} accept="image/*,application/pdf,video/mp4,video/quicktime,.zip,.ai,.psd,.svg" onChange={pick} />
      </label>
      {err && <p className="obf-help" style={{ color: '#b91c1c', marginTop: 6 }}>{err}</p>}
    </div>
  )
}

function Field({ q, value, onChange, token, answers }) {
  if (q.type === 'message') return <MessageBox answers={answers} />
  if (q.type === 'files') return <Files token={token} value={value} onChange={onChange} />
  if (q.type === 'text') return <input type="text" dir="auto" value={value || ''} placeholder={q.placeholder || ''} onChange={e => onChange(e.target.value)} />
  if (q.type === 'long') return <textarea dir="auto" value={value || ''} onChange={e => onChange(e.target.value)} />
  if (q.type === 'one' || q.type === 'yesno') {
    const opts = q.type === 'yesno' ? ['כן', 'לא'] : q.options
    return <div className="obf-opts" role="radiogroup">{opts.map(o => <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'obf-opt on' : 'obf-opt'} onClick={() => onChange(value === o ? '' : o)}>{o}</button>)}</div>
  }
  if (q.type === 'many') {
    const cur = Array.isArray(value) ? value : []
    const toggle = (o) => { const none = o === 'אין' || o === 'עוד לא מפרסמים'; onChange(cur.includes(o) ? cur.filter(x => x !== o) : none ? [o] : [...cur.filter(x => x !== 'אין' && x !== 'עוד לא מפרסמים'), o]) }
    return <div className="obf-opts">{q.options.map(o => <button key={o} type="button" aria-pressed={cur.includes(o)} className={cur.includes(o) ? 'obf-opt on' : 'obf-opt'} onClick={() => toggle(o)}>{o}</button>)}</div>
  }
  if (q.type === 'done') {
    return (
      <div className={value === true ? 'obf-done on' : 'obf-done'}>
        <button type="button" onClick={() => onChange(value !== true)}>{value === true ? '✓ בוצע' : 'סמנו כשבוצע'}</button>
        <span style={{ fontSize: 13.5 }}>{value === true ? 'תודה! נוודא מהצד שלנו.' : 'אפשר לחזור לזה אחר כך.'}</span>
      </div>
    )
  }
  if (q.type === 'table') {
    const rows = Array.isArray(value) && value.length ? value : [{}]
    const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
    return (
      <div>
        {rows.map((r, i) => (
          <div key={i} className="obf-row">
            {rows.length > 1 && <button type="button" className="obf-x" aria-label="מחיקת שורה" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>}
            {q.cols.map(c => (
              <div key={c.key}>
                <label>{c.label}</label>
                {c.type === 'one'
                  ? <select value={r[c.key] || ''} onChange={e => set(i, c.key, e.target.value)}><option value="">בחירה…</option>{c.options.map(o => <option key={o}>{o}</option>)}</select>
                  : <input type="text" dir="auto" value={r[c.key] || ''} onChange={e => set(i, c.key, e.target.value)} />}
              </div>
            ))}
          </div>
        ))}
        <button type="button" className="obf-add" onClick={() => onChange([...rows, {}])}>+ עוד שורה</button>
      </div>
    )
  }
  return null
}

export default function OnboardingFormPage() {
  const { token } = useParams()
  const [state, setState] = useState({ loading: true })
  const [answers, setAnswers] = useState({})
  const [save, setSave] = useState({ status: 'idle', at: null })
  const dirty = useRef(null), timer = useRef(null)

  useEffect(() => {
    fetch(`/api/public/onboarding-form?token=${encodeURIComponent(token || '')}`).then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setState({ error: b.error || 'הקישור לא תקין' }); else { setAnswers(b.answers || {}); setState({ project: b.project, submitted: !!b.submitted_at }) } })
      .catch(() => setState({ error: 'אין חיבור. נסו לרענן את הדף.' }))
  }, [token])

  const flush = useCallback(async (submit = false) => {
    clearTimeout(timer.current)
    const payload = dirty.current
    if (!payload && !submit) return true
    dirty.current = null
    setSave({ status: 'saving' })
    const r = await fetch('/api/public/onboarding-form', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, answers: payload || {}, submit }) }).catch(() => null)
    if (!r || !r.ok) { dirty.current = { ...(payload || {}), ...(dirty.current || {}) }; setSave({ status: 'error' }); return false }
    setSave({ status: 'saved', at: new Date() })
    return true
  }, [token])

  const change = (k, v) => {
    setAnswers(a => ({ ...a, [k]: v }))
    dirty.current = { ...(dirty.current || {}), [k]: v }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flush(), 1500)
  }
  useEffect(() => {
    const before = (e) => { if (dirty.current) { flush(); e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', before)
    return () => window.removeEventListener('beforeunload', before)
  }, [flush])

  const prog = useMemo(() => progress(answers), [answers])
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0

  if (state.loading) return <div className="obf"><style>{css}</style><div className="obf-msg">טוען…</div></div>
  if (state.error) return <div className="obf"><style>{css}</style><div className="obf-msg"><b>{state.error}</b><br />אם קיבלתם את הקישור מ-VITAS, בקשו קישור חדש.</div></div>
  if (state.finished) return <div className="obf"><style>{css}</style><div className="obf-msg"><h2 style={{ marginTop: 0 }}>תודה! 🙏</h2>התשובות נשמרו ועברו אלינו. נחזור אליכם אם יהיו שאלות.<br />אפשר לחזור לקישור הזה בכל זמן ולעדכן.</div></div>

  let n = 0
  return (
    <div className="obf">
      <style>{css}</style>
      <div className="obf-wrap">
        <div className="obf-top">
          <div className="obf-brand">Cluzo by VITAS</div>
          <h1>שאלון פתיחה{state.project ? ` · ${state.project}` : ''}</h1>
          <div className="obf-bar" aria-hidden="true"><span style={{ width: pct + '%' }} /></div>
          <div className="obf-meta"><span>{prog.done} מתוך {prog.total} שאלות</span><span>{pct}%</span></div>
        </div>
        <div className="obf-intro">
          כדי שנוכל להתחיל לעבוד ולהראות לכם את התמונה המלאה, נשמח שתמלאו את השאלון. <b>התשובות נשמרות אוטומטית</b> -
          אפשר לעצור ולחזור, ולהעביר את הקישור למי שמכיר כל נושא. מה שלא רלוונטי - מדלגים. <b>אין צורך לכתוב כאן סיסמאות או מפתחות.</b>
        </div>
        {FORM.map(sec => {
          const qs = sec.questions.filter(q => visible(q, answers))
          if (!qs.length) return null
          n++
          return (
            <section key={sec.key} className="obf-sec" aria-labelledby={'sec-' + sec.key}>
              <h2 id={'sec-' + sec.key}><span className="obf-num">{n}</span>{answers.biz_type === ECOM_TYPE && sec.titleEcom ? sec.titleEcom : sec.title}</h2>
              <p className="obf-why">{sec.why}</p>
              {qs.map(q => (
                <div key={q.key} className="obf-q">
                  <span className="obf-label">{labelOf(q, answers)}{q.required && !isFilled(q, answers) && <span className="obf-req" aria-label="חשוב">*</span>}</span>
                  {(q.help || q.type === 'many') && <p className="obf-help">{[q.type === 'many' && 'אפשר לבחור כמה', q.help].filter(Boolean).join(' · ')}</p>}
                  <Field q={q} value={answers[q.key]} onChange={v => change(q.key, v)} token={token} answers={answers} />
                </div>
              ))}
            </section>
          )
        })}
      </div>
      <div className="obf-foot">
        <div className="obf-foot-in">
          <span className="obf-save" aria-live="polite">{save.status === 'saving' ? 'שומר…' : save.status === 'error' ? '⚠️ השמירה נכשלה - ננסה שוב בשינוי הבא' : save.status === 'saved' ? '✓ נשמר' : state.submitted ? 'כבר שלחתם - אפשר לעדכן' : 'נשמר אוטומטית'}</span>
          <button type="button" className="obf-submit" onClick={async () => { if (await flush(true)) setState(s => ({ ...s, finished: true })) }}>סיימתי</button>
        </div>
      </div>
    </div>
  )
}
