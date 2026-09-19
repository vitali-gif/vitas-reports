import { computeInfraChecks } from './health-infra.js'
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
  // 2026-09-09 — ⚠️ created_at לא זז ב-upsert. מפתח החודש נכתב פעם אחת ב-1 בחודש
  // ואחר כך רק נדרס, ולכן מעולם לא נכנס לחלון 40 השעות: הסנסור ראה "אין נתונים"
  // וכל לקוח CRM היה אדום קבוע (10 אדומים שקריים, ולכן גם עיוור לתקלה אמיתית).
  // מושכים את שורת החודש במפורש לפי המפתח, בלי סינון זמן.
  const { data: monthRows } = await sb.from('reports')
    .select('project_id, source, month, created_at, summary')
    .eq('source', 'crm').eq('month', ym)
  const crmMonthByProject = new Map((monthRows || []).map(r => [r.project_id, r]))
  // 2026-09-19 — רעננות נמדדת על updated_at, לא על created_at. created_at קפוא אחרי upsert: מפתחות
  // החודש נכתבים פעם אחת, ומפתחות הטווח נוצרים מחדש רק כשהם מתחלפים בחצות (מאז 18.9 גם ב-CRM:
  // "כותבים רק מה שהשתנה"). התוצאה: "הקרון רץ לפני 7.9 ש׳" צהוב כל בוקר בזמן שהקרון רץ כל שעתיים.
  // הטריגר של מיגרציה 003 מזיז את updated_at בכל כתיבה — זו העדות היחידה לריצה. שאילתה קלה
  // (בלי summary; ~300 שורות קטנות) ומפה project|ads|crm → הכתיבה האחרונה.
  const { data: touched } = await sb.from('reports')
    .select('project_id, source, updated_at')
    .gte('updated_at', sinceIso)
  const lastWrite = new Map()
  for (const r of (touched || [])) {
    const kind = r.source === 'crm' ? 'crm' : (r.source === 'facebook' || (r.source && r.source.startsWith('google'))) ? 'ads' : null
    if (!kind || !r.updated_at) continue
    const k = r.project_id + '|' + kind
    if (!lastWrite.has(k) || new Date(r.updated_at) > new Date(lastWrite.get(k))) lastWrite.set(k, r.updated_at)
  }
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
    const usesAds = lastWrite.has(p.id + '|ads') || rs.some(r => r.source === 'facebook' || (r.source && r.source.startsWith('google')))
    const usesCrm = lastWrite.has(p.id + '|crm') || rs.some(r => r.source === 'crm') || crmMonthByProject.has(p.id)
    if (!usesAds && !usesCrm) continue
    const checks = []

    if (usesAds) {
      // הכתיבה האחרונה של דוח פרסום (updated_at) — ראו הערה למעלה; "אין נתונים" = לא נכתב כלום ב-40 שעות.
      const adsAt = lastWrite.get(p.id + '|ads')
      const age = hoursAgo(adsAt)
      checks.push({ label: 'פרסום (Meta/Google) — עדכני', status: !adsAt ? 'red' : (active && age > 6 ? 'yellow' : 'green'),
        detail: adsAt ? `עודכן לפני ${age.toFixed(1)} ש׳` : 'אין נתונים' })
    }
    if (usesCrm) {
      const crmMonth = crmMonthByProject.get(p.id)
      // הרעננות נמדדת על הכתיבה ה-CRM האחרונה (updated_at של שורת החודש או של טווח) — ראו הערה למעלה.
      const crmAt = lastWrite.get(p.id + '|crm')
      const ageM = hoursAgo(crmAt)
      checks.push({ label: 'CRM חודש נוכחי — עדכני',
        status: !crmMonth ? 'red' : (!crmAt ? 'red' : (active && ageM > 6 ? 'yellow' : 'green')),
        detail: !crmMonth ? 'אין שורת חודש' : (crmAt ? `הקרון רץ לפני ${ageM.toFixed(1)} ש׳` : 'הקרון לא רץ לאחרונה') })

      const crmRange = newest(rs, r => r.source === 'crm' && String(r.month).includes('_'))
      // crmRepRows הוא שדה של BMBY בלבד. ב-Zoho/Salesforce הוא לעולם לא קיים,
      // אז שתי הבדיקות האלה היו אדומות-לנצח לאריקה כרמל ול-KLOSS ללא שום תקלה.
      const _ct = (crmMonth || crmRange)?.summary?.crmType
      const isBmby = !_ct || _ct === 'bmby'
      if (isBmby) {
        const repM = repRowsLen(crmMonth)
        checks.push({ label: 'יישובים/התנגדויות — חודש', status: repM > 0 ? 'green' : 'red', detail: `${repM} רשומות` })

        const repR = repRowsLen(crmRange)
        checks.push({ label: 'יישובים/התנגדויות — טווחים', status: crmRange ? (repR > 0 ? 'green' : 'red') : 'yellow',
          detail: crmRange ? `${repR} רשומות` : 'טווח לא נמשך לאחרונה' })
      }
    }
    const label = (clientName.get(p.client_id) ? clientName.get(p.client_id) + ' · ' : '') + p.name
    out.push({ name: label, checks })
  }

  // שלב 5 של docs/daily-ranges-plan.md: בריאות מנגנון הטווחים (ad_daily / crm_compact / prefetch-daily)
  // כ"פרויקט" נוסף — מגיע למייל השעתי ול-/api/v1/health בלי קוד נוסף. לעולם לא זורק.
  try {
    const crmProjectIds = new Set([...crmMonthByProject.keys(), ...(rows || []).filter(r => r.source === 'crm').map(r => r.project_id)])
    const infra = await computeInfraChecks(sb, { active, projects: projects.filter(p => !p.is_demo), crmProjectIds })
    if (infra.length) out.push({ name: 'תשתית · טווחי תאריכים', checks: infra })
  } catch { /* חיישן משני — לא מפיל את הבריאות */ }

  const reds = []
  const issues = []
  const jobOf = (label) => /פרסום|Meta|Google/.test(label) ? 'ads' : 'crm'
  for (const pr of out) for (const c of pr.checks) {
    if (c.status === 'red') reds.push(`${pr.name} — ${c.label}`)
    if (c.status === 'red' || c.status === 'yellow') issues.push({ name: pr.name, label: c.label, status: c.status, detail: c.detail, job: jobOf(c.label) })
  }
  return { projects: out, reds, issues, anyRed: reds.length > 0 }
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
