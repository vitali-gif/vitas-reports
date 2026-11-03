/**
 * סטטוס שבועי של כל חשבונות הפרסום (ויטלי, 3.11: "פעם בשבוע בימי ראשון להבין את הסטטוס של כל אחד
 * בהשוואה לשבוע שעבר"). לא רק פרויקטים שבדשבורד: כל חשבון מטא שהטוקן של הדשבורד רואה, וכל חשבון
 * תחת ה-MCC בגוגל, שהוציא כסף באחד משני השבועות.
 *
 * כאן החלק הטהור: סיכום, השוואה, דגלים ומייל. המשיכה עצמה ב-app/api/cron/weekly-accounts/route.js.
 */

const r0 = (v) => Math.round(v || 0)
const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)

/** { spend, leads, clicks, impressions } לשבוע — סכום שורות. */
export function sumWeek(rows) {
  const t = { spend: 0, leads: 0, clicks: 0, impressions: 0 }
  for (const r of rows || []) for (const k of Object.keys(t)) t[k] += Number(r[k]) || 0
  return t
}

/**
 * השוואה ודגלים לחשבון אחד. cur/prev: sumWeek. status: 'active' | 'disabled' | 'closed'.
 * הדגלים הם מה שקופץ למעלה במייל — "דורש תשומת לב".
 */
export function compareAccount({ cur, prev, status = 'active' }) {
  const cpl = cur.leads > 0 ? cur.spend / cur.leads : null
  const prevCpl = prev.leads > 0 ? prev.spend / prev.leads : null
  const flags = []
  if (status !== 'active' && prev.spend > 0) flags.push('החשבון לא פעיל (מושבת או סגור)')
  if (prev.spend > 0 && cur.spend === 0) flags.push('הפרסום נעצר השבוע')
  else if (prev.spend === 0 && cur.spend > 0) flags.push('התחיל לפרסם השבוע')
  if (cur.spend >= 300 && cur.leads === 0) flags.push('אין לידים השבוע')
  const cplChg = pct(cpl || 0, prevCpl || 0)
  if (cpl != null && prevCpl != null && cur.leads >= 5 && cplChg >= 30) flags.push(`עלות לליד עלתה ${r0(cplChg)}%`)
  const leadsChg = pct(cur.leads, prev.leads)
  if (cur.spend > 0 && prev.leads >= 10 && leadsChg != null && leadsChg <= -30) flags.push(`לידים ירדו ${r0(-leadsChg)}%`)
  return {
    cur, prev, cpl, prevCpl, flags,
    change: { spend: pct(cur.spend, prev.spend), leads: leadsChg, cpl: cpl != null && prevCpl != null ? cplChg : null },
  }
}

// ── מייל ──
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const money = (v) => (v == null ? '-' : '₪' + Math.round(v).toLocaleString('en-US'))
const numTxt = (v) => (v == null ? '-' : Math.round(v).toLocaleString('en-US'))
const chg = (v, lowerIsBetter = false) => {
  if (v == null || !Number.isFinite(v)) return '<span style="color:#8a93a8">-</span>'
  const good = lowerIsBetter ? v < 0 : v > 0
  const color = Math.abs(v) < 5 ? '#8a93a8' : good ? '#0f7a5c' : '#b3261e'
  return `<span style="color:${color};font-size:12px">${v > 0 ? '+' : ''}${Math.round(v)}%</span>`
}

/**
 * accounts: [{ platform: 'meta'|'google', name, id, cmp }] (cmp = compareAccount).
 * errors: [{ platform, name, error }] — חשבונות שלא נמשכו.
 */
export function weeklyAccountsEmailHtml({ accounts, errors = [], weekLabel, prevLabel }) {
  const flagged = accounts.filter(a => a.cmp.flags.length)
  const th = 'style="text-align:right;padding:6px 8px;border-bottom:1px solid #dce3ef;font-size:12px;color:#52627a;font-weight:600"'
  const td = 'style="padding:6px 8px;border-bottom:1px solid #edf0f8;vertical-align:top"'
  const table = (list, title) => {
    if (!list.length) return ''
    const tot = { cur: sumWeek(list.map(a => a.cmp.cur)), prev: sumWeek(list.map(a => a.cmp.prev)) }
    const totCmp = compareAccount(tot)
    const row = (name, c, bold) => `<tr${bold ? ' style="font-weight:700;background:#f5f7fc"' : ''}>
      <td ${td}>${name}</td>
      <td ${td}>${money(c.cur.spend)} ${chg(c.change.spend)}</td>
      <td ${td}>${numTxt(c.cur.leads)} ${chg(c.change.leads)}</td>
      <td ${td}>${money(c.cpl)} ${chg(c.change.cpl, true)}</td></tr>`
    return `<h3 style="margin:18px 0 6px;font-size:15px">${esc(title)}</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr><th ${th}>חשבון</th><th ${th}>הוצאה</th><th ${th}>לידים</th><th ${th}>עלות לליד</th></tr></thead>
        <tbody>${list.map(a => row(esc(a.name), a.cmp)).join('')}${list.length > 1 ? row('סה"כ', totCmp, true) : ''}</tbody>
      </table>`
  }
  const bySpend = (a, b) => b.cmp.cur.spend - a.cmp.cur.spend || b.cmp.prev.spend - a.cmp.prev.spend
  const meta = accounts.filter(a => a.platform === 'meta').sort(bySpend)
  const google = accounts.filter(a => a.platform === 'google').sort(bySpend)
  return `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#14243c;max-width:720px">
    <h2 style="margin:0 0 2px">סטטוס שבועי - כל החשבונות</h2>
    <p style="margin:0 0 14px;color:#52627a">${esc(weekLabel)} מול ${esc(prevLabel)}. כל חשבון שהוציא כסף באחד משני השבועות.</p>
    ${flagged.length ? `<div style="background:#fff4dc;border-radius:10px;padding:10px 14px;margin-bottom:6px">
      <div style="font-weight:700;margin-bottom:4px">דורש תשומת לב (${flagged.length})</div>
      <ul style="margin:0;padding-inline-start:18px">${flagged.map(a => `<li><b>${esc(a.name)}</b> <span style="color:#8a93a8">(${a.platform === 'meta' ? 'פייסבוק' : 'גוגל'})</span>: ${a.cmp.flags.map(esc).join(' · ')}</li>`).join('')}</ul>
    </div>` : '<p style="color:#0f7a5c">אין חריגות השבוע.</p>'}
    ${table(meta, `פייסבוק / אינסטגרם (${meta.length})`)}
    ${table(google, `גוגל (${google.length})`)}
    ${errors.length ? `<p style="margin-top:16px;color:#b3261e;font-size:12px">לא נמשכו: ${errors.map(e => `${esc(e.name)} (${e.platform === 'meta' ? 'פייסבוק' : 'גוגל'}): ${esc(String(e.error).slice(0, 120))}`).join(' · ')}</p>` : ''}
    <p style="margin-top:16px;color:#8a93a8;font-size:12px">לידים בפייסבוק: תוצאת הליד של כל קמפיין (כמו "תוצאות" במנהל המודעות). בגוגל: המרות ראשיות. שבוע = 7 ימים שהסתיימו אתמול.</p>
  </div>`
}
