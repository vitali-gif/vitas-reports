/**
 * lib/health-infra.js — חיישני בריאות למנגנון הטווחים המיידיים (שלב 5 של docs/daily-ranges-plan.md).
 *
 * מה נבדק (אגרגטים בלבד, לעולם לא זורק — כל כשל הופך לבדיקה צהובה "חיישן לא זמין"):
 *   1. עובדות יומיות (ad_daily) לכל מקור: היום האחרון שנכתב ומתי נמשך לאחרונה (prefetch-daily רץ כל שעה).
 *   2. תמונת CRM (crm_compact) לכל פרויקט שיש לו דוחות CRM: קיימת? כמה טרייה? (הקרון רץ כל שעתיים).
 *   3. הריצות האחרונות ב-job_log של prefetch-daily.
 * הבדיקות מצטרפות ל-computeHealth (lib/health.js) כ"פרויקט" בשם 'תשתית · טווחי תאריכים', ולכן
 * מגיעות למייל הבריאות השעתי ול-/api/v1/health בלי קוד נוסף.
 *
 * מחוץ לשעות הפעילות (08–22) שום דבר לא אדום — כמו שאר החיישנים.
 */

const israelToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const hoursAgo = (ts) => ts ? (Date.now() - new Date(ts).getTime()) / 3.6e6 : Infinity
const h1 = (h) => Number.isFinite(h) ? h.toFixed(1) : '—'

/**
 * @param sb לקוח service_role
 * @param {{active:boolean, projects:Array<{id:string,name:string}>, crmProjectIds:Set<string>}} ctx
 *   active — האם עכשיו שעות פעילות; crmProjectIds — פרויקטים שיש להם דוח CRM (רק להם נדרשת תמונה).
 * @returns {Promise<Array<{label:string,status:'green'|'yellow'|'red',detail:string}>>}
 */
export async function computeInfraChecks(sb, { active, projects, crmProjectIds }) {
  const checks = []
  const today = israelToday(), yesterday = addDays(today, -1)

  // 1. ad_daily
  try {
    const { data, error } = await sb.rpc('ad_daily_coverage')
    if (error) throw error
    for (const source of ['facebook', 'google']) {
      const rows = (data || []).filter(c => c.source === source)
      if (!rows.length) { checks.push({ label: `עובדות יומיות — ${source}`, status: active ? 'red' : 'yellow', detail: 'אין שורות בכלל' }); continue }
      const maxDay = rows.map(c => String(c.max_day).slice(0, 10)).sort().pop()
      const lastFetch = rows.map(c => c.last_fetched).sort().pop()
      const ageH = hoursAgo(lastFetch)
      const fresh = maxDay >= yesterday
      const status = !active ? 'green' : (fresh && ageH <= 3) ? 'green' : (fresh || ageH <= 6) ? 'yellow' : 'red'
      checks.push({ label: `עובדות יומיות — ${source}`, status, detail: `עד ${maxDay} · נמשך לפני ${h1(ageH)} ש׳ · ${rows.length} חשבונות` })
    }
  } catch (e) {
    checks.push({ label: 'עובדות יומיות', status: 'yellow', detail: 'חיישן לא זמין: ' + String(e?.message || e).slice(0, 80) })
  }

  // 2. crm_compact
  try {
    const { data, error } = await sb.from('crm_compact').select('project_id, crm_type, counts, source_fetched_at, built_at')
    if (error) throw error
    const byProject = new Map((data || []).map(r => [r.project_id, r]))
    for (const p of projects) {
      if (!crmProjectIds.has(p.id)) continue
      const c = byProject.get(p.id)
      if (!c) {
        // Salesforce אין לו תמונה דחוסה (פרוסה לטווח) — הטריות מדופק המשיכה (crm_sync, מיגרציה 013);
        // נפילה חזרה ל-fetched_at של הרשומות כשהטבלה עוד לא קיימת.
        let sfTs = null
        const { data: sync } = await sb.from('crm_sync').select('synced_at').eq('project_id', p.id).eq('crm_type', 'salesforce').order('synced_at', { ascending: false }).limit(1)
        if (sync && sync.length) sfTs = sync[0].synced_at
        if (!sfTs) {
          const { data: sf } = await sb.from('crm_raw').select('fetched_at').eq('project_id', p.id).eq('crm_type', 'salesforce').order('fetched_at', { ascending: false }).limit(1)
          if (sf && sf.length) sfTs = sf[0].fetched_at
        }
        if (sfTs) {
          const ageH = hoursAgo(sfTs)
          const status = !active ? 'green' : ageH <= 5 ? 'green' : ageH <= 12 ? 'yellow' : 'red'
          checks.push({ label: `תמונת CRM — ${p.name}`, status, detail: `salesforce · רשומות גולמיות · רועננו לפני ${h1(ageH)} ש׳` })
          continue
        }
        checks.push({ label: `תמונת CRM — ${p.name}`, status: active ? 'red' : 'yellow', detail: 'אין תמונה (הקרון עוד לא שמר / rebuild נכשל)' }); continue
      }
      const ageH = hoursAgo(c.source_fetched_at || c.built_at)
      const total = Object.values(c.counts || {}).reduce((x, y) => x + (Number(y) || 0), 0)
      const status = !active ? 'green' : ageH <= 5 ? 'green' : ageH <= 12 ? 'yellow' : 'red'
      checks.push({ label: `תמונת CRM — ${p.name}`, status, detail: `${c.crm_type} · ${total.toLocaleString('he-IL')} רשומות · רועננה לפני ${h1(ageH)} ש׳` })
    }
  } catch (e) {
    checks.push({ label: 'תמונת CRM', status: 'yellow', detail: 'חיישן לא זמין: ' + String(e?.message || e).slice(0, 80) })
  }

  // 3. job_log — prefetch-daily
  try {
    const { data, error } = await sb.from('job_log').select('job, ran_at, ok, detail').eq('job', 'prefetch-daily:recent').order('ran_at', { ascending: false }).limit(1)
    if (error) throw error
    const last = data?.[0]
    if (!last) checks.push({ label: 'קרון prefetch-daily', status: active ? 'yellow' : 'green', detail: 'עוד לא רץ (job_log ריק)' })
    else {
      const ageH = hoursAgo(last.ran_at)
      const status = !active ? 'green' : (last.ok && ageH <= 3) ? 'green' : (last.ok || ageH <= 3) ? 'yellow' : 'red'
      checks.push({ label: 'קרון prefetch-daily', status, detail: `${last.ok ? 'הצליח' : 'נכשל'} לפני ${h1(ageH)} ש׳ · ${last.detail?.jobs ?? '?'} משימות · ${last.detail?.failed ?? '?'} כשלים` })
    }
  } catch (e) {
    checks.push({ label: 'קרון prefetch-daily', status: 'yellow', detail: 'חיישן לא זמין: ' + String(e?.message || e).slice(0, 80) })
  }

  return checks
}
