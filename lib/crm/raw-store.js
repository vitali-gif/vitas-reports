/**
 * lib/crm/raw-store.js — שמירה וטעינה של רשומות CRM גולמיות (טבלת crm_raw, מיגרציה 006).
 *
 * שלב 1 של docs/daily-ranges-plan.md. ה-route של BMBY שומר כאן את מה שהוא מושך;
 * נקודת הקצה לטווחים (app/api/reports/range) טוענת מכאן ומחשבת — בלי BMBY.
 */
import { createHash } from 'crypto'

export const ENTITIES = ['clients', 'tasks', 'price_offers', 'contracts']

// שדות מזהה אפשריים לכל ישות, לפי סדר עדיפות. שמות השדות ב-BMBY לא מתועדים,
// ולכן הרשימה רחבה, והשדה שנבחר בפועל מדווח חזרה (idField) כדי שנוכל לאמת.
const ID_CANDIDATES = {
  clients:      ['client_id', 'id', 'uniq_id', 'uniqid', 'uniqID'],
  tasks:        ['task_id', 'id', 'uniq_id', 'uniqid', 'uniqID'],
  price_offers: ['offer_id', 'price_offer_id', 'id', 'uniq_id', 'uniqid', 'uniqID'],
  contracts:    ['contract_id', 'id', 'uniq_id', 'uniqid', 'uniqID'],
}

/**
 * מזהה יציב לרשומה. אם אין שדה מזהה — גיבוב של השדות המזהים (לא של כל הרשומה,
 * שמשתנה עם הזמן), כדי שעדכון סטטוס יידרוס ולא ייצור כפילות.
 */
const GENERIC_ID_KEYS = ['Id', 'id', 'ID', 'uniq_id', 'uniqid']   // Zoho / Salesforce: מזהה הרשומה
export function extIdOf(entity, row) {
  for (const k of ID_CANDIDATES[entity] || GENERIC_ID_KEYS) {
    const v = row?.[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return { id: String(v).trim(), field: k }
  }
  const basis = entity === 'tasks'
    ? [row?.client_id, row?.type, row?.create_date, row?.start_date, row?.subject]
    : [row?.client_id, row?.create_date, row?.agreement_date, row?.contract_date, row?.offer_date]
  const h = createHash('sha1').update(JSON.stringify(basis.map(v => v ?? ''))).digest('hex').slice(0, 24)
  return { id: 'h:' + h, field: null }
}

/**
 * upsert של רשומות ישות אחת לפרויקט. מחזיר { count, idField, fallback } — כמה נשמרו,
 * איזה שדה שימש כמזהה, וכמה נפלו לגיבוב.
 */
// שגיאות חולפות של עומס: statement timeout, deadlock, serialization — שווה לנסות שוב אחרי הפסקה קצרה.
const TRANSIENT_PG = new Set(['57014', '40P01', '40001'])
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export async function upsertRawRecords(sb, projectId, crmType, entity, rows, { batch = 250, retries = 3 } = {}) {
  const byId = new Map()
  let idField = null, fallback = 0
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue
    const { id, field } = extIdOf(entity, row)
    if (field && !idField) idField = field
    if (!field) fallback++
    byId.set(id, row)   // אותו מזהה פעמיים בתוך משיכה אחת — האחרון קובע
  }
  const fetchedAt = new Date().toISOString()
  // סדר קבוע לפי ext_id: שני upserts מקבילים על אותן שורות נועלים אותן באותו סדר ולכן לא
  // נתקעים זה על זה (17.9: "deadlock detected" כשכמה חלונות של הקרון כתבו את אותם לידים).
  // payload_hash: md5 של ה-JSON — הפונקציה crm_raw_upsert (מיגרציה 013) כותבת שורה קיימת רק אם
  // ה-hash שונה. ככה ריצת קרון רגילה כותבת עשרות רשומות במקום 100k (17.9: statement timeouts).
  const all = [...byId.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ext_id, payload]) => ({ project_id: projectId, crm_type: crmType, entity, ext_id, payload, payload_hash: hashPayload(payload), fetched_at: fetchedAt }))
  let retried = 0, written = 0, viaRpc = true
  for (let i = 0; i < all.length; i += batch) {
    const slice = all.slice(i, i + batch)
    for (let attempt = 0; ; attempt++) {
      let error = null
      if (viaRpc) {
        const r = await sb.rpc('crm_raw_upsert', { p_rows: slice })
        error = r.error
        if (!error) { written += Number(r.data?.written) || 0; break }
        // המיגרציה עוד לא רצה (הפונקציה/העמודה לא קיימות) — נופלים ל-upsert הרגיל, פעם אחת לכל הקריאה
        if (['42883', '42703', 'PGRST202'].includes(String(error.code || '')) || /crm_raw_upsert|payload_hash/.test(error.message || '')) {
          viaRpc = false
          const r2 = await sb.from('crm_raw').upsert(slice.map(({ payload_hash, ...row }) => row), { onConflict: 'project_id,crm_type,entity,ext_id' })
          error = r2.error
          if (!error) { written += slice.length; break }
        }
      } else {
        const r2 = await sb.from('crm_raw').upsert(slice.map(({ payload_hash, ...row }) => row), { onConflict: 'project_id,crm_type,entity,ext_id' })
        error = r2.error
        if (!error) { written += slice.length; break }
      }
      // 17.9 15:37: כשארבעה חלונות כתבו במקביל, חלק מה-upserts (250–500 שורות, ~2 שניות כל אחד)
      // חיכו לנעילות ונפלו על statement timeout של 8 שניות. ניסיון חוזר אחרי 1.5/3/4.5 שניות
      // מצליח כשהעומס יורד; רק אחרי `retries` כישלונות זורקים.
      const transient = TRANSIENT_PG.has(String(error.code || '')) || /statement timeout|deadlock/i.test(error.message || '')
      if (!transient || attempt >= retries) throw new Error(`crm_raw upsert (${entity}, batch ${i / batch}, attempt ${attempt + 1}): ${error.message}`)
      retried++
      await sleep(1500 * (attempt + 1))
    }
  }
  // דופק המשיכה (crm_sync): ממנו נגזרת הטריות ב-health ובחיתוך של Salesforce, כי fetched_at של
  // הרשומות מתעדכן מעכשיו רק כשרשומה משתנה. כישלון כאן לא מפיל את המשיכה.
  if (viaRpc) {
    try {
      await sb.from('crm_sync').upsert({ project_id: projectId, crm_type: crmType, entity, synced_at: fetchedAt, seen: all.length, written }, { onConflict: 'project_id,crm_type,entity' })
    } catch {}
  }
  return { count: all.length, idField, fallback, retried, written, changed: written > 0 }
}

/** md5 של ה-payload — יציב לאותו אובייקט מאותו API (סדר המפתחות נשמר). */
export function hashPayload(payload) {
  return createHash('md5').update(JSON.stringify(payload)).digest('hex')
}

/**
 * אחרי משיכה שלא שינתה אף רשומה: לא בונים את התמונה הדחוסה מחדש (שניות של עבודה ב-DB לכל
 * פרויקט), רק מסמנים שהמקור נמשך עכשיו. מחזיר false אם אין תמונה — ואז צריך לבנות.
 */
export async function touchCompact(sb, projectId, crmType) {
  const { data, error } = await sb.from('crm_compact')
    .update({ source_fetched_at: new Date().toISOString() })
    .eq('project_id', projectId).eq('crm_type', crmType).select('project_id')
  if (error) throw new Error('crm_compact touch: ' + error.message)
  return Array.isArray(data) && data.length > 0
}

/** בונה מחדש רק אם משהו השתנה (או שאין תמונה); אחרת רק מסמן טריות. */
export async function rebuildCompactIfChanged(sb, projectId, crmType, parts) {
  const changed = (Array.isArray(parts) ? parts : Object.values(parts || {})).some(p => p && p.changed)
  if (!changed) {
    const touched = await touchCompact(sb, projectId, crmType)
    if (touched) return { skipped: true, reason: 'no changes' }
  }
  return await rebuildCompact(sb, projectId, crmType)
}

/**
 * טוען את כל הרשומות של פרויקט. supabase-js מחזיר לכל היותר 1000 שורות לקריאה,
 * לכן קוראים בעמודים בסדר יציב (entity, ext_id).
 * @returns {{clients:any[], tasks:any[], prices:any[], contracts:any[], counts:object, fetchedAt:string|null, total:number}}
 */
export async function loadRawRecords(sb, projectId, crmType, { pageSize = 1000 } = {}) {
  const out = { clients: [], tasks: [], prices: [], contracts: [] }
  const counts = {}
  const entities = {}   // כל ישות → שורות, לכל סוג CRM (BMBY מקבל גם את השדות הישנים למעלה)
  const target = { clients: 'clients', tasks: 'tasks', price_offers: 'prices', contracts: 'contracts' }
  let fetchedAt = null
  let from = 0
  for (;;) {
    const { data, error } = await sb
      .from('crm_raw')
      .select('entity, payload, fetched_at')
      .eq('project_id', projectId).eq('crm_type', crmType)
      .order('entity').order('ext_id')
      .range(from, from + pageSize - 1)
    if (error) throw new Error('crm_raw load: ' + error.message)
    for (const r of data || []) {
      const k = target[r.entity]
      if (k) out[k].push(r.payload)
      ;(entities[r.entity] = entities[r.entity] || []).push(r.payload)
      counts[r.entity] = (counts[r.entity] || 0) + 1
      if (!fetchedAt || r.fetched_at > fetchedAt) fetchedAt = r.fetched_at
    }
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return { ...out, entities, counts, fetchedAt, total, crmType }
}

/**
 * בנייה מחדש של התמונה הדחוסה של פרויקט (מיגרציה 009) — רצה כולה בתוך Postgres.
 * נקראת מ-bmby/fetch אחרי upsertRawRecords. מחזירה את הספירות, או זורקת.
 */
export async function rebuildCompact(sb, projectId, crmType) {
  const { data, error } = await sb.rpc('rebuild_crm_compact', { p_project: projectId, p_crm: crmType })
  if (error) throw new Error('rebuild_crm_compact: ' + error.message)
  return data
}

/**
 * טוען את התמונה הדחוסה — שורה אחת, ~5MB לפרויקט הגדול, במקום 19 עמודים של רשומות
 * גולמיות (20 שניות). אותה צורה כמו loadRawRecords. מחזיר null אם אין (אז נופלים ל-raw).
 */
export async function loadCompactSnapshot(sb, projectId, crmType) {
  const { data, error } = await sb.from('crm_compact')
    .select('payload, counts, source_fetched_at, built_at')
    .eq('project_id', projectId).eq('crm_type', crmType).maybeSingle()
  if (error) throw new Error('crm_compact load: ' + error.message)
  if (!data || !data.payload) return null
  const p = data.payload
  const out = { clients: p.clients || [], tasks: p.tasks || [], prices: p.price_offers || [], contracts: p.contracts || [] }
  const counts = data.counts || { clients: out.clients.length, tasks: out.tasks.length, price_offers: out.prices.length, contracts: out.contracts.length }
  const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0)
  const entities = {}
  for (const [k, v] of Object.entries(p)) if (Array.isArray(v)) entities[k] = v
  return { ...out, entities, counts, fetchedAt: data.source_fetched_at || data.built_at, builtAt: data.built_at, total, compact: true, crmType }
}

/** רק המטא של התמונה הדחוסה (built_at, counts) — קריאה זעירה, לבדיקת מטמון לפני טעינת ה-payload. */
export async function loadCompactMeta(sb, projectId, crmType = null) {
  let q = sb.from('crm_compact').select('crm_type, counts, source_fetched_at, built_at').eq('project_id', projectId)
  if (crmType) q = q.eq('crm_type', crmType)
  const { data, error } = await q.order('built_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('crm_compact meta: ' + error.message)
  return data || null
}

/** סוג ה-CRM של פרויקט לפי מה שיש לו בתמונה הגולמית (כשעוד אין תמונה דחוסה). */
export async function detectCrmType(sb, projectId) {
  const { data } = await sb.from('crm_raw').select('crm_type').eq('project_id', projectId).limit(1)
  return data?.[0]?.crm_type || null
}

/**
 * Salesforce: פרוסה לטווח מתוך crm_raw, חתוכה בתוך Postgres (מיגרציה 011) — רק הרשומות שהחישוב
 * צריך לחלון (לידים בחלון / פגישה בחלון, ההיסטוריה שלהם, הזדמנויות בחלון + cohort, הפריטים).
 * מאות רשומות במקום עשרות אלפים; אין תמונה דחוסה ל-Salesforce.
 * p_from/p_to בהיסט ישראל קבוע לפי תאריך ההתחלה — כמו FROM/TO ב-route.
 */
export async function loadSalesforceSlice(sb, projectId, since, until) {
  const off = israelOffsetHours(since)
  const sign = off >= 0 ? '+' : '-', pad = String(Math.abs(off)).padStart(2, '0')
  const p_from = `${since}T00:00:00${sign}${pad}:00`, p_to = `${until}T23:59:59.999${sign}${pad}:00`
  const { data, error } = await sb.rpc('crm_slice_salesforce', { p_project: projectId, p_from, p_to })
  if (error) throw new Error('crm_slice_salesforce: ' + error.message)
  if (!data) return null
  const entities = { leads: data.leads || [], opportunities: data.opportunities || [], line_items: data.line_items || [], lead_history: data.lead_history || [] }
  const counts = data.counts || {}
  return { entities, counts, fetchedAt: data.fetched_at || null, builtAt: data.fetched_at || null, total: Number(counts.raw_total) || 0, sliced: true, crmType: 'salesforce' }
}
function israelOffsetHours(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00Z')
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'shortOffset' }).formatToParts(d)
    const m = /GMT([+-]\d+)/.exec((parts.find(p => p.type === 'timeZoneName') || {}).value || 'GMT+3')
    return m ? parseInt(m[1], 10) : 3
  } catch { return 3 }
}
