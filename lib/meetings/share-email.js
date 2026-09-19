/**
 * lib/meetings/share-email.js — שליחת סיכום ישיבה מאושר לנמענים שנבחרו.
 *
 * ═══ מה נשלח ומה לא ═══
 * נשלחים הסיכום והמשימות בלבד. הקלטה ותמלול אינם משותפים כברירת מחדל ואינם מצורפים כאן,
 * לפי ARCHITECTURE.md — הם דורשים בחירה מפורשת וגישה נפרדת.
 *
 * ═══ כשל בשליחה ═══
 * כל נמען מקבל שורה משלו ב-meeting_shares. כשל אצל נמען אחד אינו נוגע באחרים, ואינו נוגע
 * באישור הסיכום. שליחה חוזרת מעדכנת את אותה שורה ואינה מאשרת מחדש.
 *
 * אין כאן התחזות לתיבת המארגן: השולח הוא הדומיין של VITAS, כמו בשאר המיילים במערכת.
 */
import { escapeHtml } from '../auth'

const FROM = process.env.ALERT_EMAIL_FROM || 'VITAS Reports <noreply@vitas.co.il>'

const listHtml = (items) => {
  const rows = (items || []).map(i => `<li style="margin:0 0 8px">${escapeHtml(i?.text || '')}</li>`).join('')
  return rows ? `<ol style="margin:0;padding-inline-start:20px;line-height:1.7">${rows}</ol>` : ''
}

const tasksHtml = (tasks) => {
  if (!tasks || !tasks.length) return ''
  const rows = tasks.map(t => {
    const who = t.assignee_email || t.assignee_label || 'להשלמה'
    const due = t.due_at || 'להשלמה'
    const needs = t.status === 'needs_details'
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(t.title || '')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;color:${needs ? '#b45309' : '#334155'}">${escapeHtml(who)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;color:${needs ? '#b45309' : '#334155'};white-space:nowrap">${escapeHtml(due)}</td>
    </tr>`
  }).join('')
  return `<table style="border-collapse:collapse;width:100%;font-size:14px">
    <thead><tr>
      <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #dde2ec">משימה</th>
      <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #dde2ec">אחראי</th>
      <th style="text-align:right;padding:8px 10px;border-bottom:2px solid #dde2ec">עד תאריך</th>
    </tr></thead><tbody>${rows}</tbody></table>`
}

const section = (title, inner) => (inner
  ? `<div style="margin:0 0 24px"><h3 style="margin:0 0 10px;font-size:16px;color:#142044">${escapeHtml(title)}</h3>${inner}</div>`
  : '')

export function renderSummaryEmail({ meeting, summary, tasks }) {
  const when = meeting.start_at
    ? new Intl.DateTimeFormat('he-IL', { timeZone: meeting.timezone || 'Asia/Jerusalem', dateStyle: 'long', timeStyle: 'short' }).format(new Date(meeting.start_at))
    : null
  const needsDetails = (tasks || []).filter(t => t.status === 'needs_details').length
  return `<div dir="rtl" lang="he" style="font-family:Heebo,Arial,sans-serif;max-width:680px;margin:0 auto;color:#142044">
    <div style="background:#0B0F1E;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:12px;letter-spacing:.14em;opacity:.75">VITAS · ישיבות שיווק ומכירות</div>
      <h2 style="margin:6px 0 0;font-size:22px">${escapeHtml(meeting.title || 'סיכום ישיבה')}</h2>
      ${when ? `<div style="margin-top:6px;font-size:13px;opacity:.85">${escapeHtml(when)}</div>` : ''}
    </div>
    <div style="border:1px solid #dde2ec;border-top:0;border-radius:0 0 12px 12px;padding:24px;background:#fff">
      ${section('הנקודות החשובות', listHtml(summary.key_points))}
      ${section('החלטות שהתקבלו', listHtml(summary.decisions))}
      ${section('משימות לביצוע', tasksHtml(tasks))}
      ${section('שאלות פתוחות', listHtml(summary.open_questions))}
      ${needsDetails ? `<p style="margin:0 0 16px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:13px;color:#92400e">
        ${needsDetails} משימות עדיין דורשות השלמה של אחראי או תאריך. הן לא שויכו לאיש.</p>` : ''}
      <p style="color:#586581;font-size:12px;margin:20px 0 0;border-top:1px solid #eee;padding-top:12px">
        גרסה ${summary.version} · אושר על ידי ${escapeHtml(summary.approved_by || '')}.
        ההקלטה והתמלול אינם מצורפים למייל זה.
      </p>
    </div>
  </div>`
}

/**
 * @returns {Promise<{attempted:number, sent:number, failed:number, error?:string}>}
 * לעולם לא זורק: כשל בשליחה אינו מבטל אישור שכבר נרשם.
 */
export async function shareSummary({ sb, meeting, summary, recipients, actor }) {
  const { data: tasks } = await sb.from('meeting_tasks')
    .select('title, assignee_email, assignee_label, due_at, status')
    .eq('meeting_id', meeting.id).neq('status', 'proposed').order('created_at')

  const html = renderSummaryEmail({ meeting, summary, tasks: tasks || [] })
  const subject = `סיכום ישיבה — ${meeting.title || ''}`.trim()

  if (!process.env.RESEND_API_KEY) {
    // חסר מפתח: מסמנים failed עם סיבה מפורשת. לא "נשלח" מדומה.
    const rows = recipients.map(r => ({
      meeting_id: meeting.id, summary_version: summary.version, recipient_email: r,
      delivery_status: 'failed', error: 'RESEND_API_KEY לא מוגדר',
    }))
    await sb.from('meeting_shares').insert(rows)
    return { attempted: recipients.length, sent: 0, failed: recipients.length, error: 'שירות המייל אינו מוגדר' }
  }

  let sent = 0, failed = 0, lastError = null
  for (const to of recipients) {
    let status = 'failed', err = null
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [to], subject, html }),
      })
      if (res.ok) { status = 'sent'; sent++ }
      else { err = `HTTP ${res.status}`; failed++ }
    } catch (e) {
      err = String(e?.message || e).slice(0, 200); failed++
    }
    if (err) lastError = err
    // שורה לכל נמען בכל ניסיון — כך retry ניתן למעקב ואינו מוחק את ההיסטוריה.
    await sb.from('meeting_shares').insert({
      meeting_id: meeting.id, summary_version: summary.version, recipient_email: to,
      delivery_status: status, error: err, sent_at: status === 'sent' ? new Date().toISOString() : null,
    })
  }
  return { attempted: recipients.length, sent, failed, error: lastError || undefined, actor }
}
