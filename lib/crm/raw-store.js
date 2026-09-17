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
export async function upsertRawRecords(sb, projectId, crmType, entity, rows, { batch = 500 } = {}) {
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
  const all = [...byId.entries()].map(([ext_id, payload]) => ({ project_id: projectId, crm_type: crmType, entity, ext_id, payload, fetched_at: fetchedAt }))
  for (let i = 0; i < all.length; i += batch) {
    const { error } = await sb.from('crm_raw').upsert(all.slice(i, i + batch), { onConflict: 'project_id,crm_type,entity,ext_id' })
    if (error) throw new Error(`crm_raw upsert (${entity}, batch ${i / batch}): ${error.message}`)
  }
  return { count: all.length, idField, fallback }
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
