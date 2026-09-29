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
import { isHumanNote } from './crm/fireberry-summary.js'

const israelToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const hoursAgo = (ts) => ts ? (Date.now() - new Date(ts).getTime()) / 3.6e6 : Infinity
const h1 = (h) => Number.isFinite(h) ? h.toFixed(1) : '—'

const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5)

/**
 * B14 — חשבון פרסום שנעצר. שני מצבים שונים, כי יש להם שני הסברים שונים:
 *
 *   1. **לא נמשך** — אין ב-ad_daily_fetch יום מאתמול והלאה. הצנרת לא מגיעה לחשבון
 *      (הוצא מהגדרות, טוקן, הרשאה). אדום. חשבון שלא נמשך שבוע וגם לא היו לו נתונים
 *      30 יום נחשב חשבון שהוצא בכוונה, ולא מדווח.
 *   2. **נמשך אבל שקט** — המשיכה רצה, אבל היום האחרון עם נתונים ב-ad_daily ישן.
 *      זה יכול להיות קמפיינים מושהים (כך היה ב-3529349237) — ולכן צהוב ולא אדום,
 *      עם הניסוח "לבדוק אם זה מכוון". אחרי 30 יום של שקט החשבון נחשב רדום ומפסיק
 *      להתריע, אחרת חשבון מושהה יצבע את המייל לנצח.
 *
 * פונקציה טהורה (בלי sb) כדי שאפשר יהיה לבדוק אותה בבדיקות העשן.
 *
 * @param {{coverage:Array<{source,account,max_day}>, recentFetches:Array<{source,account,day}>, today:string, active:boolean}} p
 */
export function accountStalenessChecks({ coverage, recentFetches, today, active }) {
  const QUIET_DAYS = 3, DORMANT_DAYS = 30
  const yesterday = addDays(today, -1)
  const key = (s, a) => `${s}|${a}`
  const fetchedThrough = new Map()
  for (const r of recentFetches) {
    const k = key(r.source, r.account), d = String(r.day).slice(0, 10)
    if (!fetchedThrough.has(k) || fetchedThrough.get(k) < d) fetchedThrough.set(k, d)
  }
  const lastData = new Map(coverage.map(c => [key(c.source, c.account), c.max_day ? String(c.max_day).slice(0, 10) : null]))
  const accounts = new Set([...lastData.keys(), ...fetchedThrough.keys()])

  const checks = []
  for (const k of [...accounts].sort()) {
    const [source, account] = k.split('|')
    const label = `חשבון פרסום — ${source} ${account}`
    const ft = fetchedThrough.get(k) || null
    const ld = lastData.get(k) || null
    const quietDays = ld ? daysBetween(ld, today) : Infinity

    if (!ft || ft < yesterday) {
      if (!ft && quietDays > DORMANT_DAYS) continue   // הוצא מהמשיכה בכוונה, מזמן
      const lag = ft ? daysBetween(ft, today) : null
      checks.push({ label, status: active ? 'red' : 'yellow',
        detail: ft ? `לא נמשך מאז ${ft} (${lag} ימים) — הצנרת לא מגיעה לחשבון` : 'לא נמשך בשבוע האחרון — הצנרת לא מגיעה לחשבון' })
      continue
    }
    if (quietDays >= QUIET_DAYS && quietDays <= DORMANT_DAYS) {
      checks.push({ label, status: active ? 'yellow' : 'green',
        detail: `נמשך כרגיל, אבל אין הוצאה מאז ${ld} (${quietDays} ימים). קמפיינים מושהים? אם לא — לבדוק` })
    }
  }
  return checks
}

/**
 * T8 — שבירה שקטה בפיירברי (אלפא). שני דברים יכולים להשתנות אצלם בלי שנדע, ובשניהם
 * הדשבורד ממשיך לעבוד ומציג מספרים שגויים:
 *
 *   1. **סינון ההערות האוטומטיות** (isHumanNote) מבוסס על מה שהאוטומציה כותבת היום —
 *      שם הליד או טלפון בלבד. אם הנוסח ישתנה, ההערה האוטומטית תיחשב "תגובה", וכל ליד
 *      ייענה תוך 0 דקות. בסיס (29.9): מתוך 187 לידים שנענו, **אף אחד** לא נענה תוך
 *      דקה. לכן "יותר מ-30% מהתגובות תוך דקה" הוא סימן חד, לא רעש.
 *   2. **השדות מזוהים לפי pcfsystemfieldNNN**. שדה שנוצר מחדש מקבל מספר אחר, והישן
 *      מפסיק להתמלא בשקט. בסיס (29.9): סטטוס ובעלים 100%, מקור וקמפיין 93–94%.
 *      מתחת ל-50% בלידים של השבוע = השדה כנראה הוחלף.
 *
 * משתמש באותו isHumanNote של החישוב עצמו — זו כל הנקודה: אם הסינון שם נשבר, גם כאן.
 * פונקציה טהורה, נבדקת ב-scripts/tests/fireberry-health.smoke.mjs.
 *
 * @param {{name:string, leads:any[], notes:any[], active:boolean}} p
 *   leads — לידים שנוצרו בשבוע האחרון (שדות גולמיים של Fireberry); notes — ההערות עליהם.
 */
export const FIREBERRY_KEY_FIELDS = [
  ['statuscode', 'סטטוס'],
  ['ownername', 'מנהל לקוח'],
  ['originatingleadcode', 'מקור הגעה'],
  ['pcfsystemfield185', 'שם קמפיין'],
]
export function fireberryHealthChecks({ name, leads, notes, active }) {
  const MIN_LEADS = 10, MIN_RESPONDED = 5, FAST_SHARE = 0.3, FILL_MIN = 0.5
  const bad = active ? 'red' : 'yellow'
  const checks = []
  const ts = (s) => new Date(String(s || '').replace(' ', 'T')).getTime()

  // 1. תגובות "מהירות מדי"
  const byLead = new Map()
  for (const n of notes || []) {
    const id = String(n?.objectid || '')
    if (id) (byLead.get(id) || byLead.set(id, []).get(id)).push(n)
  }
  let responded = 0, fast = 0
  for (const l of leads || []) {
    const c = ts(l.createdon)
    if (isNaN(c)) continue
    const first = (byLead.get(String(l.accountid || '')) || [])
      .filter(n => isHumanNote(n, l) && ts(n.createdon) >= c)
      .map(n => ts(n.createdon)).sort((a, b) => a - b)[0]
    if (first === undefined) continue
    responded++
    if (first - c < 60_000) fast++
  }
  if (responded >= MIN_RESPONDED) {
    const share = fast / responded
    checks.push(share > FAST_SHARE
      ? { label: `פיירברי — ${name} · זמני תגובה`, status: bad, detail: `${fast} מתוך ${responded} תגובות בשבוע נרשמו תוך פחות מדקה (בדרך כלל 0). כנראה הערה אוטומטית שנוסחה השתנה נספרת כתגובה — לבדוק את isHumanNote` }
      : { label: `פיירברי — ${name} · זמני תגובה`, status: 'green', detail: `${fast} מתוך ${responded} תגובות תוך פחות מדקה` })
  }

  // 2. שדות מרכזיים שהתרוקנו
  const n = (leads || []).length
  if (n >= MIN_LEADS) {
    const empty = []
    for (const [field, label] of FIREBERRY_KEY_FIELDS) {
      const filled = leads.filter(l => String(l?.[field] ?? '').trim() !== '').length
      if (filled / n < FILL_MIN) empty.push(`${label} (${field}): ${filled}/${n}`)
    }
    checks.push(empty.length
      ? { label: `פיירברי — ${name} · שדות`, status: bad, detail: `שדות שהתרוקנו בלידים של השבוע: ${empty.join(', ')}. כנראה השדה נוצר מחדש במספר אחר — לעדכן את LEAD_FIELDS` }
      : { label: `פיירברי — ${name} · שדות`, status: 'green', detail: `${n} לידים בשבוע, כל השדות המרכזיים מלאים` })
  }
  return checks
}

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

  // 1ב. לכל חשבון בנפרד (B14). הבדיקה למעלה לוקחת את היום המאוחר ביותר מכל החשבונות, ולכן
  //     חשבון אחד שנעצר מוסתר מאחורי כל השאר — כך google 3529349237 עמד 13 יום בלי יום חדש
  //     ואף בדיקה לא התריעה (25.9).
  try {
    const since = addDays(today, -7)
    const [cov, recent] = await Promise.all([
      sb.rpc('ad_daily_coverage'),
      sb.from('ad_daily_fetch').select('source, account, day').gte('day', since),
    ])
    if (cov.error) throw cov.error
    if (recent.error) throw recent.error
    checks.push(...accountStalenessChecks({ coverage: cov.data || [], recentFetches: recent.data || [], today, active }))
  } catch (e) {
    checks.push({ label: 'חשבונות פרסום — לפי חשבון', status: 'yellow', detail: 'חיישן לא זמין: ' + String(e?.message || e).slice(0, 80) })
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
      let status = !active ? 'green' : ageH <= 5 ? 'green' : ageH <= 12 ? 'yellow' : 'red'
      let detail = `${c.crm_type} · ${total.toLocaleString('he-IL')} רשומות · רועננה לפני ${h1(ageH)} ש׳`
      // תמונה "טרייה" שלא נבנתה מחדש: source_fetched_at מתעדכן בכל משיכה (touch) גם כשה-rebuild
      // נכשל — 17–18.9 ה-rebuild של BMBY נפל על statement timeout במשך יום שלם והחיישן נשאר ירוק,
      // בעוד הטווחים המיידיים הוגשו מתמונה של אתמול. משווים את counts של התמונה למספר הרשומות
      // בפועל ב-crm_raw: פער = רשומות נוספו/נמחקו מאז built_at והתמונה לא נבנתה.
      // 2026-09-19 — הספירות רצות במקביל. קודם הן היו בלולאה עם await, כלומר 16 נסיעות הלוך-ושוב
      // סדרתיות ל-PostgREST (5 פרויקטים × 2–4 ישויות) בתוך route שעתי עם maxDuration=60,
      // ש-cron-job.org חותך ב-30 שניות. כל ספירה עצמה מהירה (index-only scan, ~66ms), הבעיה
      // הייתה הסידרתיות. Promise.all לא משנה את עומס ה-DB — אותן שאילתות, בלי ההמתנה ביניהן.
      try {
        const entries = Object.entries(c.counts || {})
        const counted = await Promise.all(entries.map(async ([entity, n]) => {
          const { count, error: cntErr } = await sb.from('crm_raw').select('ext_id', { count: 'exact', head: true })
            .eq('project_id', p.id).eq('crm_type', c.crm_type).eq('entity', entity)
          if (cntErr) throw cntErr
          return { entity, n, count }
        }))
        const drift = []
        for (const { entity, n, count } of counted) {
          if (count !== null && count !== Number(n)) drift.push(`${entity}: ${Number(count).toLocaleString('he-IL')} מול ${Number(n).toLocaleString('he-IL')}`)
        }
        if (drift.length) {
          const builtH = hoursAgo(c.built_at)
          // שעה ראשונה = חלון סביר בין הכתיבה ל-rebuild של הריצה הבאה; מעבר לכך התמונה מתיישנת.
          if (active && builtH > 1) status = builtH > 6 ? 'red' : 'yellow'
          detail += ` · נבנתה לפני ${h1(builtH)} ש׳ אך המקור השתנה (${drift.join(', ')})`
        }
      } catch { /* השוואה משנית — לא מפילה את החיישן */ }
      checks.push({ label: `תמונת CRM — ${p.name}`, status, detail })
    }
  } catch (e) {
    checks.push({ label: 'תמונת CRM', status: 'yellow', detail: 'חיישן לא זמין: ' + String(e?.message || e).slice(0, 80) })
  }

  // 2ב. פיירברי — שבירה שקטה (T8). לידים של השבוע האחרון בלבד, ושדות נבחרים בלבד (לא payload מלא).
  try {
    const { data: fb, error: fbErr } = await sb.from('crm_compact').select('project_id').eq('crm_type', 'fireberry')
    if (fbErr) throw fbErr
    const since = addDays(today, -7)
    for (const { project_id } of fb || []) {
      const name = projects.find(p => p.id === project_id)?.name
      if (!name) continue
      const { data: lr, error: lErr } = await sb.from('crm_raw')
        .select('accountid:payload->>accountid, accountname:payload->>accountname, createdon:payload->>createdon, statuscode:payload->>statuscode, ownername:payload->>ownername, originatingleadcode:payload->>originatingleadcode, pcfsystemfield185:payload->>pcfsystemfield185')
        .eq('project_id', project_id).eq('crm_type', 'fireberry').eq('entity', 'leads').gte('payload->>createdon', since)
      if (lErr) throw lErr
      const notes = []
      for (let from = 0; ; from += 1000) {
        const { data: nr, error: nErr } = await sb.from('crm_raw')
          .select('objectid:payload->>objectid, text:payload->>text, createdon:payload->>createdon')
          .eq('project_id', project_id).eq('crm_type', 'fireberry').eq('entity', 'notes').gte('payload->>createdon', since)
          .range(from, from + 999)
        if (nErr) throw nErr
        notes.push(...(nr || []))
        if (!nr || nr.length < 1000) break
      }
      checks.push(...fireberryHealthChecks({ name, leads: lr || [], notes, active }))
    }
  } catch (e) {
    checks.push({ label: 'פיירברי', status: 'yellow', detail: 'חיישן לא זמין: ' + String(e?.message || e).slice(0, 80) })
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
