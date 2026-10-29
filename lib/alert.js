// lib/alert.js — operational alert emails via Resend.
// Reuses RESEND_API_KEY (already configured for client auth emails).
// Recipients: ALERT_EMAIL_TO (comma-separated) or defaults to the owner.
// Sender: ALERT_EMAIL_FROM or the existing verified vitas.co.il sender.

// attachments: [{ filename, content (base64) }] — כמו ב-Resend. to: מחליף את הנמען (ברירת מחדל: ויטלי).
export async function sendAlert({ subject, html, text, attachments, to: toOverride }) {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' }
  const to = (toOverride || process.env.ALERT_EMAIL_TO || 'vitalidisel@gmail.com')
    .split(',').map(s => s.trim()).filter(Boolean)
  const from = process.env.ALERT_EMAIL_FROM || 'Cluzo by Vitas <noreply@vitas.co.il>'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html: html || undefined, text: text || undefined, attachments: attachments?.length ? attachments : undefined }),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
