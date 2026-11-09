'use client'
// חיבור הדשבורד ל-TikTok (ויטלי, 9.11) — /api/admin/tiktok-token. כמו app/admin/zoho-token.
import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api-fetch'

export default function TikTokToken() {
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)
  const [copied, setCopied] = useState(false)
  const call = async (method, body) => {
    const r = await apiFetch('/api/admin/tiktok-token' + (method === 'GET' ? `?state=${body}` : ''), method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const b = r ? await r.json().catch(() => ({})) : { error: 'אין חיבור' }
    if (r && r.status === 401) b.error = 'צריך להיות מחובר לדשבורד כאדמין - להיכנס ל-/admin ואז לחזור לכאן'
    return b
  }
  // חזרה מ-TikTok: ?auth_code=…&state=…
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const code = p.get('auth_code') || p.get('code')
    if (!code) return
    let expected = null
    try { expected = sessionStorage.getItem('tt_state') } catch {}
    if (expected && p.get('state') !== expected) { setOut({ error: 'החזרה מ-TikTok לא תואמת לבקשה - ללחוץ שוב על "חיבור ל-TikTok"' }); return }
    window.history.replaceState(null, '', window.location.pathname)
    setBusy(true)
    call('POST', { authCode: code }).then(b => { setOut(b); setBusy(false) })
  }, [])
  const connect = async () => {
    setBusy(true); setOut(null)
    const state = Math.random().toString(36).slice(2, 12)
    try { sessionStorage.setItem('tt_state', state) } catch {}
    const b = await call('GET', state)
    if (b.url) window.location.href = b.url
    else { setOut(b); setBusy(false) }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(out.accessToken); setCopied(true) } catch { /* העתקה ידנית */ } }
  const box = { maxWidth: 600, margin: '40px auto', padding: 20, fontFamily: 'system-ui, sans-serif', direction: 'rtl', lineHeight: 1.6 }
  return (
    <div style={box}>
      <h1 style={{ fontSize: 22 }}>חיבור הדשבורד ל-TikTok</h1>
      <ol style={{ paddingInlineStart: 20 }}>
        <li>ללחוץ על הכפתור. TikTok ייפתח ויבקש לאשר את Vitas Dashboard.</li>
        <li>לבחור את חשבונות המודעות (אלפא יזמות, ובי-קיור לייזר אם רוצים) ולאשר.</li>
        <li>TikTok יחזיר לכאן, והמסך יבדוק שהחיבור עובד.</li>
      </ol>
      <button onClick={connect} disabled={busy} style={{ padding: '10px 18px', fontSize: 15, borderRadius: 8, border: 0, background: '#111', color: '#fff' }}>
        {busy ? 'רגע…' : 'חיבור ל-TikTok'}
      </button>
      {out?.error && <p style={{ color: '#b91c1c', marginTop: 14 }}>{out.error}</p>}
      {out?.accessToken && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: '#ecfdf5' }}>
          <p style={{ margin: 0, fontWeight: 700 }}>✓ החיבור עובד</p>
          <ul style={{ paddingInlineStart: 20 }}>
            {(out.advertisers || []).map(a => (
              <li key={a.id} dir="auto">{a.name || 'חשבון'} <span dir="ltr">({a.id})</span>: {a.ok ? `הוצאה ${out.since} עד ${out.until}: ₪${a.spend7d.toLocaleString('he-IL')}` : `שגיאה - ${a.error}`}</li>
            ))}
          </ul>
          <p dir="ltr" style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 13, background: '#fff', padding: 8, borderRadius: 6 }}>{out.accessToken}</p>
          <button onClick={copy} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff' }}>{copied ? 'הועתק ✓' : 'העתקת הטוקן'}</button>
          <ol style={{ paddingInlineStart: 20, marginTop: 12 }}>
            <li>לשמור ב-API.txt עם הכותרת "TikTok Access Token - Vitas Dashboard (אלפא אקספו)".</li>
            <li>ב-Vercel: להוסיף TIKTOK_ACCESS_TOKEN עם הערך הזה - Sensitive, Production ו-Preview.</li>
            <li>לכתוב לקלוד "הטוקן של טיקטוק ב-Vercel".</li>
          </ol>
        </div>
      )}
    </div>
  )
}
