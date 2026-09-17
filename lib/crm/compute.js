/**
 * lib/crm/compute.js — שער אחד לחישוב שורת דוח CRM לטווח, לפי סוג ה-CRM של הפרויקט.
 * שלב 4 של docs/daily-ranges-plan.md.
 *
 * כל סוג מביא את הפונקציה הטהורה שלו (אותה פונקציה שה-route של אותו CRM מריץ על משיכה חיה),
 * ומחזיר כאן צורה אחידה: { data, summary, row_count }. הישויות הגולמיות מגיעות מתמונת המצב
 * (crm_compact / crm_raw) כ-entities: { <entity>: rows[] }.
 */
import { computeBmbySummary, toReportRow } from './bmby-summary.js'
import { computeZohoSummary, filterDigitalLeads } from './zoho-summary.js'

export const CRM_TYPES = ['bmby', 'zoho', 'salesforce']

/** שדות הסכום שמשווים ב-compare=1 — מספריים בלבד, בלי PII. נתיבים מנוקדים מותרים. */
export function totalKeysFor(crmType) {
  if (crmType === 'zoho') return ['totalLeads', 'relevantLeads', 'irrelevantLeads', 'deals.opportunities', 'deals.closed', 'deals.revenue', 'funnel.cancellations', 'funnel.netPurchases']
  if (crmType === 'salesforce') return ['totalLeads', 'convertedLeads', 'unconvertedLeads', 'meetingsScheduled', 'relevantLeads']
  return ['totalLeads', 'relevantLeads', 'nonRelevantLeads', 'meetingsScheduled', 'meetingsCompleted', 'meetingsCancelled', 'meetingsUpcoming', 'leadsToHandle', 'registrations', 'registrationValue', 'contracts', 'contractValue']
}

export const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)

/**
 * @param {string} crmType 'bmby' | 'zoho' | 'salesforce'
 * @param {{entities: object}} snapshot  תמונת מצב (loadCompactSnapshot / loadRawRecords)
 * @param {{since:string, until:string, key:string, now?:Date}} period
 * @returns {{data:any[], summary:object, row_count:number, file_name:string}|null}  null = סוג לא נתמך
 */
export function computeCrmRow(crmType, snapshot, { since, until, key, now } = {}) {
  const e = snapshot?.entities || {}
  if (crmType === 'bmby') {
    const R = computeBmbySummary({ clients: e.clients || [], tasks: e.tasks || [], prices: e.price_offers || [], contracts: e.contracts || [] }, { since, until, monthKey: key, now })
    return { ...toReportRow(R), file_name: 'BMBY snapshot (computed)' }
  }
  if (crmType === 'zoho') {
    const R = computeZohoSummary({ leads: filterDigitalLeads(e.leads || []), deals: e.deals || [] }, { since, until })
    return { data: R.xlsxRows, summary: R.summary, row_count: R.leads.length, file_name: 'Zoho snapshot (computed)' }
  }
  return null   // salesforce: שלב 4ב
}
