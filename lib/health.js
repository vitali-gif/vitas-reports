// lib/health.js — per-branch data-health sensors for the status email.
// Reads the latest report summaries and reports green/yellow/red per project × branch.
// "Data health" reflects BOTH admin and client (they read the same rows). It does NOT
// catch client-side render crashes — those need the client Error Boundary (separate).
// Everything here is read-only and must never throw to the caller (caller wraps in try).

function currentMonthIsrael() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
}
export function israelHour() {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(new Date()), 10)
}
function hoursAgo(ts) { return ts ? (Date.now() - new Date(ts).getTime()) / 3.6e6 : Infinity }
function repRowsLen(row) { const a = row && row.summary && row.summary.crmRepRows; return Array.isArray(a) ? a.length : 0 }

// Returns { projects:[{name, checks:[{label,status,detail}]}], reds:[...], anyRed }
export async function computeHealth(sb) {
  const ym = currentMonthIsrael()
  const [projRes, cliRes] = await Promise.all([
    sb.from('projects').select('id, name, is_demo, client_id'),
    sb.from('clients').select('id, name'),
  ])
  const projects = projRes.data || []
  const clientName = new Map((cliRes.data || []).map(c => [c.id, c.name]))

  // Only rows written recently (bounded payload; covers the overnight gap + delays).
  const sinceIso = new Date(Date.now() - 40 * 3.6e6).toISOString()
  const { data: rows } = await sb.from('reports')
    .select('project_id, source, month, created_at, summary')
    .gte('created_at', sinceIso)
  const byProject = new Map()
  for (const r of (rows || [])) {
    if (!byProject.has(r.project_id)) byProject.set(r.project_id, [])
    byProject.get(r.project_id).push(r)
  }
  const active = israelHour() >= 8 && israelHour() <= 22   // judge freshness only during active hours
  const newest = (rs, pred) => rs.filter(pred).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]

  const out = []
  for (const p of projects) {
    if (p.is_demo) continue
    const rs = byProject.get(p.id) || []
    const usesAds = rs.some(r => r.source === 'facebook' || (r.source && r.source.startsWith('google')))
    const usesCrm = rs.some(r => r.source === 'crm')
    if (!usesAds && !usesCrm) continue
    const checks = []

    if (usesAds) {
      const adsRow = newest(rs, r => r.source === 'facebook' || (r.source && r.source.startsWith('google')))
      const age = hoursAgo(adsRow && adsRow.created_at)
      checks.push({ label: 'פרסום (Meta/Google) — עדכני', status: !adsRow ? 'red' : (active && age > 6 ? 'yellow' : 'green'),
        detail: adsRow ? `עודכן לפני ${age.toFixed(1)} ש׳` : 'אין נתונים' })
    }
    if (usesCrm) {
      const crmMonth = newest(rs, r => r.source === 'crm' && r.month === ym)
      const ageM = hoursAgo(crmMonth && crmMonth.created_at)
      checks.push({ label: 'CRM חודש נוכחי — עדכני', status: !crmMonth ? 'red' : (active && ageM > 6 ? 'yellow' : 'green'),
        detail: crmMonth ? `עודכן לפני ${ageM.toFixed(1)} ש׳` : 'אין נתונים' })

      const repM = repRowsLen(crmMonth)
      checks.push({ label: 'יישובים/התנגדויות — חודש', status: repM > 0 ? 'green' : 'red', detail: `${repM} רשומות` })

      const crmRange = newest(rs, r => r.source === 'crm' && String(r.month).includes('_'))
      const repR = repRowsLen(crmRange)
      checks.push({ label: 'יישובים/התנגדויות — טווחים', status: crmRange ? (repR > 0 ? 'green' : 'red') : 'yellow',
        detail: crmRange ? `${repR} רשומות` : 'טווח לא נמשך לאחרונה' })
    }
    const label = (clientName.get(p.client_id) ? clientName.get(p.client_id) + ' · ' : '') + p.name
    out.push({ name: label, checks })
  }

  const reds = []
  for (const pr of out) for (const c of pr.checks) if (c.status === 'red') reds.push(`${pr.name} — ${c.label}`)
  return { projects: out, reds, anyRed: reds.length > 0 }
}

const DOT = { green: '#16a34a', yellow: '#d97706', red: '#dc2626' }
const WORD = { green: 'תקין', yellow: 'חלקי', red: 'שבור' }

export function renderHealthEmail(h, { digest }) {
  const dot = s => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${DOT[s]};margin-left:6px;vertical-align:middle"></span>`
  const projBlocks = h.projects.map(p => {
    const rows = p.checks.map(c => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${dot(c.status)}${WORD[c.status]}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${c.label}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#888;font-size:12px">${c.detail}</td>
    </tr>`).join('')
    return `<div style="margin:14px 0"><div style="font-weight:bold;margin-bottom:4px">${p.name}</div>
      <table style="border-collapse:collapse;width:100%">${rows}</table></div>`
  }).join('')
  const head = digest
    ? `<h2>📊 דוח בריאות מערכת — ${h.anyRed ? '⚠️ יש בעיות' : '✔️ הכל תקין'}</h2>`
    : `<h2>🔴 VITAS: ענף חדש נשבר</h2><p>${h.reds.map(r => `• ${r}`).join('<br>')}</p>`
  return `<div style="font-family:Arial,sans-serif;direction:rtl;text-align:right;max-width:640px">
    ${head}${projBlocks}
    <p style="color:#888;font-size:12px;margin-top:16px">VITAS Reports · חיישני בריאות נתונים · בדיקת נתונים משותפת ללקוח ולאדמין</p></div>`
}
