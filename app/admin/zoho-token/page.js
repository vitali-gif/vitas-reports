'use client'
// מסך קטן לאדמין: קוד חד-פעמי מ-Zoho → Refresh Token חדש (/api/admin/zoho-token). 7.11.
import { useState } from 'react'
import { apiFetch } from '../../../lib/api-fetch'

export default function ZohoToken() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)
  const [copied, setCopied] = useState(false)
  const go = async () => {
    setBusy(true); setOut(null); setCopied(false)
    const r = await apiFetch('/api/admin/zoho-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }).catch(() => null)
    const b = r ? await r.json().catch(() => ({})) : { error: 'אין חיבור' }
    if (r && r.status === 401) b.error = 'צריך להיות מחובר לדשבורד כאדמין — להיכנס ל-/admin ואז לחזור לכאן'
    setOut(b); setBusy(false)
  }
  const copy = async () => { try { await navigator.clipboard.writeText(out.refreshToken); setCopied(true) } catch { /* העתקה ידנית */ } }
  const box = { maxWidth: 560, margin: '40px auto', padding: 20, fontFamily: 'system-ui, sans-serif', direction: 'rtl', lineHeight: 1.6 }
  return (
    <div style={box}>
      <h1 style={{ fontSize: 22 }}>Zoho — Refresh Token חדש</h1>
      <ol style={{ paddingInlineStart: 20 }}>
        <li>ב-Zoho API Console: Self Client ← Generate Code.</li>
        <li>להעתיק את הקוד (מתחיל ב-1000.) ולהדביק כאן תוך 10 דקות.</li>
      </ol>
      <textarea value={code} onChange={e => setCode(e.target.value)} rows={3} dir="ltr" placeholder="1000.xxxx.yyyy"
        style={{ width: '100%', fontSize: 15, padding: 10, borderRadius: 8, border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
      <button onClick={go} disabled={busy || !code.trim()} style={{ marginTop: 10, padding: '10px 18px', fontSize: 15, borderRadius: 8, border: 0, background: '#2563eb', color: '#fff' }}>
        {busy ? 'ממיר…' : 'המרה ל-Refresh Token'}
      </button>
      {out?.error && <p style={{ color: '#b91c1c', marginTop: 14 }}>{out.error}</p>}
      {out?.refreshToken && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: out.works ? '#ecfdf5' : '#fef2f2' }}>
          <p style={{ margin: 0, fontWeight: 700 }}>{out.works ? '✓ ה-Refresh Token עובד' : '⚠️ נוצר, אבל בדיקה מול Zoho נכשלה'}</p>
          <p dir="ltr" style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 13, background: '#fff', padding: 8, borderRadius: 6 }}>{out.refreshToken}</p>
          <button onClick={copy} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff' }}>{copied ? 'הועתק ✓' : 'העתקה'}</button>
          <ol style={{ paddingInlineStart: 20, marginTop: 12 }}>
            <li>לשמור ב-API.txt עם הכותרת "Zoho Refresh Token – ביקיור / ISMOOTH".</li>
            <li>ב-Vercel: למחוק את ZOHO_REFRESH_TOKEN ולהוסיף מחדש עם הערך הזה — Sensitive, Production ו-Preview.</li>
            <li>Redeploy.</li>
          </ol>
          {out.scope && <p style={{ fontSize: 12, color: '#64748b' }} dir="ltr">scope: {out.scope}</p>}
        </div>
      )}
    </div>
  )
}
