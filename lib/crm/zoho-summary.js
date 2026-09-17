/**
 * lib/crm/zoho-summary.js — חישוב סיכום ה-CRM של Zoho (BCureLaser / ISMOOTH) מרשומות גולמיות.
 *
 * הופרד מ-app/api/zoho/fetch/route.js ב-17.9.2026 (שלב 4 של docs/daily-ranges-plan.md), כמו
 * ש-bmby-summary.js הופרד ב-שלב 0. ה-route מושך לידים ועסקאות מ-Zoho; הפונקציה כאן טהורה:
 * אותם לידים + אותן עסקאות + אותו טווח → אותו סיכום, גם מתמונת מצב שמורה (crm_raw / crm_compact).
 *
 * הקוד הועבר כמו שהוא. שינוי יחיד: סינון הלידים לטווח נעשה כאן (לפי Created_Time בהיסט +03:00,
 * בדיוק כמו קריטריון החיפוש של ה-route), אלא אם prefiltered:true (ה-route כבר ביקש מ-Zoho רק את הטווח).
 */
import { ZOHO_SCHEMA_VERSION } from './schema-version.js'

// BCureLaser: only count these digital sub-sources
export const DIGITAL_SUBSOURCES = new Set([
  'facebook', 'google', 'אתר חברה', 'וואטסאפ', 'whatsapp',
  'גוגל', 'פייסבוק', // Hebrew variants
])

export function num(v) {
  if (typeof v === 'number') return v
  if (!v) return 0
  const n = parseFloat(String(v))
  return isNaN(n) ? 0 : n
}

// Normalize a UTM_Campaign value to a clean campaign name: strip bidi/directional
// control chars and the constant 'Geek-' prefix the agency template injects, then trim.
export function normUtm(v) {
  if (v === null || v === undefined) return ''
  let x = String(v).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00ad\u200b\ufeff]/g, '').trim()
  x = x.replace(/^geek[-_\s]+/i, '')
  return x.trim()
}

/** הלידים הדיגיטליים המאושרים — אותו סינון כמו ב-route. */
export function filterDigitalLeads(rawLeads) {
  // Keep only the approved digital sub-sources
  // Keep approved digital sub-sources. Besides the explicit whitelist, accept any facebook*/
  // google* variant (e.g. facebook_minisite, google_minisite) so a NEW ad sub-source isn't
  // silently dropped — the Zoho query already restricts to Lead_Source='דיגיטל'.
  const leads = rawLeads.filter(r => {
    const _s = (r.Sub_Lead_Source || '').toLowerCase().trim()
    return DIGITAL_SUBSOURCES.has(_s) || _s.startsWith('facebook') || _s.startsWith('google') || _s.startsWith('פייסבוק') || _s.startsWith('גוגל')
  })
  return leads
}

/** תאריך ישראלי (היסט קבוע +03:00, כמו קריטריון החיפוש) של חותמת זמן של Zoho. */
export function israelDateOf(ts) {
  const ms = Date.parse(String(ts || '').replace(' ', 'T'))
  if (Number.isNaN(ms)) return ''
  return new Date(ms + 3 * 3600000).toISOString().slice(0, 10)
}

/**
 * @param {{leads:any[], deals:any[]}} raw   לידים (דיגיטליים, אחרי filterDigitalLeads) ועסקאות מקושרות (LidID)
 * @param {{since:string, until:string, prefiltered?:boolean}} period
 * @returns {{leads:any[], linkedDeals:any[], xlsxRows:any[], summary:object, opportunities:number, purchased:number}}
 */
export function computeZohoSummary({ leads: allLeads, deals }, { since, until, prefiltered = false } = {}) {
  const leads = prefiltered ? allLeads : allLeads.filter(l => { const d = israelDateOf(l.Created_Time); return d && d >= since && d <= until })
  const leadIds = leads.map(l => l.id)
  const leadIdSet = new Set(leadIds)
  let linkedDeals = deals || []
linkedDeals = linkedDeals.filter(d => leadIdSet.has(d.LidID))

// ===== Compute lead stats =====
const IRRELEVANT_STATUSES = new Set(['כפול', 'לא תקין', 'לא מעוניין', 'מטופל על ידי נציג אחר/ליד כפול'])
const byStatus = {}
const bySource = {}
const objections = {}
const devices = {}

for (const lead of leads) {
  const status = (lead.Lead_Status || 'לא ידוע').trim()
  byStatus[status] = (byStatus[status] || 0) + 1

  const sub = (lead.Sub_Lead_Source || 'לא ידוע').trim()
  bySource[sub] = (bySource[sub] || 0) + 1

  const obj = (lead.field9 || '').trim()
  if (obj) objections[obj] = (objections[obj] || 0) + 1

  const dev = (lead.field20 || 'לא הוצע').trim() || 'לא הוצע'
  devices[dev] = (devices[dev] || 0) + 1
}

// ===== Response time =====
const responseTimes = []
const byAgent = {}

for (const lead of leads) {
  const agentName = (typeof lead.Owner === 'object' ? lead.Owner?.name : lead.Owner) || 'לא ידוע'
  const answered = num(lead.sumAnswerCalls || 0)
  const createdStr = (lead.Created_Time || '').replace(' ', 'T')
  const lastCallStr = (lead.timeOfLastCall || '').replace(' ', 'T')

  if (!answered || !lastCallStr || !createdStr) {
    if (!byAgent[agentName]) byAgent[agentName] = { count: 0, totalHours: 0, noResponse: 0 }
    byAgent[agentName].count++; byAgent[agentName].noResponse++
    responseTimes.push({ agentName, responseHours: null, noResponse: true, source: (lead.Sub_Lead_Source || 'אחר').trim() || 'אחר' })
    continue
  }

  const responseHours = Math.max(0, (new Date(lastCallStr) - new Date(createdStr)) / 3600000)
  if (!byAgent[agentName]) byAgent[agentName] = { count: 0, totalHours: 0, noResponse: 0 }
  byAgent[agentName].count++; byAgent[agentName].totalHours += responseHours
  responseTimes.push({ agentName, responseHours, noResponse: false, source: (lead.Sub_Lead_Source || 'אחר').trim() || 'אחר' })
}

const responded = responseTimes.filter(r => !r.noResponse)
const avgHours = responded.length ? responded.reduce((s, r) => s + r.responseHours, 0) / responded.length : 0
const respondedWithin1h = responded.length ? Math.round(responded.filter(r => r.responseHours <= 1).length / responded.length * 100) : 0
const agentStats = Object.entries(byAgent).map(([name, s]) => ({
  name, count: s.count, noResponse: s.noResponse,
  avgHours: s.count > s.noResponse ? Math.round((s.totalHours / (s.count - s.noResponse)) * 10) / 10 : null,
})).sort((a, b) => b.count - a.count)

// Response-time distribution buckets + per-source averages (for the response report)
const RT_BUCKETS = ['0-15m', '15m-1h', '1h-4h', '4h-8h', '8h-24h', '1d-3d', '3d+']
const rtBucketOf = (h) => h <= 0.25 ? '0-15m' : h <= 1 ? '15m-1h' : h <= 4 ? '1h-4h' : h <= 8 ? '4h-8h' : h <= 24 ? '8h-24h' : h <= 72 ? '1d-3d' : '3d+'
const rtBuckets = Object.fromEntries(RT_BUCKETS.map(b => [b, 0]))
const rtBySourceMap = {}
for (const r of responded) {
  rtBuckets[rtBucketOf(r.responseHours)]++
  if (!rtBySourceMap[r.source]) rtBySourceMap[r.source] = { count: 0, sumHours: 0 }
  rtBySourceMap[r.source].count++; rtBySourceMap[r.source].sumHours += r.responseHours
}
const rtBySource = Object.entries(rtBySourceMap)
  .map(([source, x]) => ({ source, count: x.count, avgHours: Math.round((x.sumHours / x.count) * 10) / 10 }))
  .sort((a, b) => b.count - a.count)

// ===== Compute deal stats (lead-centric via LidID) =====
// Opportunities (Id Count): distinct leads that have a linked deal.
const opportunities = new Set(linkedDeals.map(d => d.LidID)).size
// Purchased (Closing Date Count): linked deals that have a Closing_Date.
const closedDeals = linkedDeals.filter(d => d.Closing_Date)
const closedWithCancellation = closedDeals.filter(d => d.cancellation_date)
const closedNoCancellation = closedDeals.filter(d => !d.cancellation_date)

const grandTotal = closedDeals.reduce((s, d) => s + num(d.Amount || 0), 0)
const netRevenue = closedNoCancellation.reduce((s, d) => s + num(d.Amount || 0), 0)
const devicesSold = closedNoCancellation.reduce((s, d) => s + num(d.device_quantity || 1), 0)
const avgDealValue = closedNoCancellation.length > 0 ? Math.round(netRevenue / closedNoCancellation.length) : 0

const purchased = closedDeals.length
const totalLeads = leads.length
const closingRate = totalLeads > 0 ? Math.round((purchased / totalLeads) * 1000) / 10 : 0

// ===== Funnel + drop-off (where leads/deals fall off) =====
const oppLeadIds = new Set(linkedDeals.map(d => d.LidID))
// Leads that never became an opportunity — broken down by Lead_Status (why they died)
const notConvertedLeads = leads.filter(l => !oppLeadIds.has(l.id))
const leadStatusDrop = {}
for (const l of notConvertedLeads) {
  const st = (l.Lead_Status || 'לא ידוע').trim() || 'לא ידוע'
  leadStatusDrop[st] = (leadStatusDrop[st] || 0) + 1
}
// Opportunities that did not purchase (no Closing_Date) — broken down by deal Stage
const openDeals = linkedDeals.filter(d => !d.Closing_Date)
const openStageDrop = {}
for (const d of openDeals) {
  const st = (d.Stage || 'לא ידוע').trim() || 'לא ידוע'
  openStageDrop[st] = (openStageDrop[st] || 0) + 1
}
const cancellations = closedWithCancellation.length
const cancelledValue = closedWithCancellation.reduce((acc, d) => acc + num(d.Amount || 0), 0)
const netPurchases = purchased - cancellations

// ===== Per-channel funnel (which channel converts/earns best) =====
const leadById = {}
for (const l of leads) leadById[l.id] = l
const normChan = (l) => ((l && l.Sub_Lead_Source) || 'אחר').trim() || 'אחר'
const byChannel = {}
const ensureChan = (c) => (byChannel[c] || (byChannel[c] = { leads: 0, opportunities: 0, purchased: 0, netRevenue: 0, cancellations: 0, _oppLeads: new Set() }))
for (const l of leads) ensureChan(normChan(l)).leads++
for (const d of linkedDeals) {
  const l = leadById[d.LidID]; if (!l) continue
  const c = ensureChan(normChan(l))
  c._oppLeads.add(d.LidID)
  if (d.Closing_Date) {
    c.purchased++
    if (d.cancellation_date) c.cancellations++
    else c.netRevenue += num(d.Amount || 0)
  }
}
// ===== 4-level drill: channel -> campaign(UTM_Campaign) -> adset(UTM_Term) -> ad(UTM_Content) =====
// normUtm strips the 'Geek-' prefix + bidi chars from every UTM field. For Google, UTM_Term is
// the search keyword and UTM_Content is the numeric ad-id (resolved to a name in the UI).
const NO_CAMP = '(ללא קמפיין)', NO_AST = '(ללא adset)', NO_AD = '(ללא מודעה)'
const _mkNode = () => ({ leads: 0, purchased: 0, cancellations: 0, netRevenue: 0, _opp: new Set(), children: {} })
const _root = {}
const _descend = (parts) => {
  const out = []
  let level = _root
  for (const p of parts) {
    level[p] = level[p] || _mkNode()
    out.push(level[p])
    level = level[p].children
  }
  return out
}
const _partsOf = (l) => [normChan(l), normUtm(l.UTM_Campaign) || NO_CAMP, normUtm(l.UTM_Term) || NO_AST, normUtm(l.UTM_Content) || NO_AD]
for (const l of leads) { for (const n of _descend(_partsOf(l))) n.leads++ }
for (const d of linkedDeals) {
  const l = leadById[d.LidID]; if (!l) continue
  const nodes = _descend(_partsOf(l))
  const buy = !!d.Closing_Date, cancelled = !!d.cancellation_date, amt = num(d.Amount || 0)
  for (const n of nodes) {
    n._opp.add(d.LidID)
    if (buy) { n.purchased++; if (cancelled) n.cancellations++; else n.netRevenue += amt }
  }
}
const _fmt = (node, labelKey, label, childKey, childArr) => ({
  [labelKey]: label, leads: node.leads, opportunities: node._opp.size, purchased: node.purchased,
  cancellations: node.cancellations, netRevenue: Math.round(node.netRevenue),
  conversionRate: node.leads > 0 ? Math.round((node.purchased / node.leads) * 1000) / 10 : 0,
  ...(childKey ? { [childKey]: childArr } : {}),
})
const campsByChannel = {}
for (const ch in _root) {
  const camps = []
  for (const cmpName in _root[ch].children) {
    const cmpNode = _root[ch].children[cmpName]
    const adSets = []
    for (const astName in cmpNode.children) {
      const astNode = cmpNode.children[astName]
      const ads = []
      for (const adName in astNode.children) ads.push(_fmt(astNode.children[adName], 'ad', adName))
      ads.sort((a, b) => b.leads - a.leads)
      adSets.push(_fmt(astNode, 'adset', astName, 'ads', ads))
    }
    adSets.sort((a, b) => b.leads - a.leads)
    camps.push(_fmt(cmpNode, 'campaign', cmpName, 'adSets', adSets))
  }
  camps.sort((a, b) => b.leads - a.leads)
  campsByChannel[ch] = camps
}

// ===== Per-agent performance (Owner), with per-source breakdown =====
const _agentName = (l) => (l && (typeof l.Owner === 'object' ? (l.Owner && l.Owner.name) : l.Owner)) || 'לא ידוע'
const agentAgg = {}
const ensureAgent = (ag) => agentAgg[ag] || (agentAgg[ag] = { agent: ag, leads: 0, purchased: 0, netRevenue: 0, _opp: new Set(), bySrc: {} })
const ensureAgentSrc = (a, src) => a.bySrc[src] || (a.bySrc[src] = { source: src, leads: 0, purchased: 0, netRevenue: 0, _opp: new Set() })
for (const l of leads) {
  const a = ensureAgent(_agentName(l)); a.leads++
  ensureAgentSrc(a, normChan(l)).leads++
}
for (const d of linkedDeals) {
  const l = leadById[d.LidID]; if (!l) continue
  const a = ensureAgent(_agentName(l)); const sa = ensureAgentSrc(a, normChan(l))
  a._opp.add(d.LidID); sa._opp.add(d.LidID)
  if (d.Closing_Date) {
    a.purchased++; sa.purchased++
    if (!d.cancellation_date) { const amt = num(d.Amount || 0); a.netRevenue += amt; sa.netRevenue += amt }
  }
}
const agentPerformance = Object.values(agentAgg).map(a => ({
  agent: a.agent, leads: a.leads, opportunities: a._opp.size, purchased: a.purchased,
  netRevenue: Math.round(a.netRevenue),
  conversionRate: a.leads > 0 ? Math.round((a.purchased / a.leads) * 1000) / 10 : 0,
  bySource: Object.values(a.bySrc).map(s => ({
    source: s.source, leads: s.leads, opportunities: s._opp.size, purchased: s.purchased,
    netRevenue: Math.round(s.netRevenue),
    conversionRate: s.leads > 0 ? Math.round((s.purchased / s.leads) * 1000) / 10 : 0,
  })).sort((x, y) => y.leads - x.leads),
})).sort((a, b) => b.leads - a.leads)

const channelFunnel = Object.entries(byChannel).map(([channel, c]) => ({
  channel,
  leads: c.leads,
  opportunities: c._oppLeads.size,
  purchased: c.purchased,
  cancellations: c.cancellations,
  netRevenue: Math.round(c.netRevenue),
  conversionRate: c.leads > 0 ? Math.round((c.purchased / c.leads) * 1000) / 10 : 0,
  campaigns: campsByChannel[channel] || [],
})).sort((a, b) => b.leads - a.leads)
const conversionRate = closingRate

// ===== Build xlsxRows for aggregateCrmRows compatibility =====
const sourcesMap = {}
for (const lead of leads) {
  const src = (lead.Sub_Lead_Source || 'לא ידוע').trim() || 'לא ידוע'
  const status = (lead.Lead_Status || '').trim()
  const isIrrelevant = IRRELEVANT_STATUSES.has(status)
  if (!sourcesMap[src]) sourcesMap[src] = {
    totalLeads: 0, relevantLeads: 0, irrelevantLeads: 0,
    meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
    registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
  }
  sourcesMap[src].totalLeads++
  if (isIrrelevant) sourcesMap[src].irrelevantLeads++
  else sourcesMap[src].relevantLeads++
}
const xlsxRows = Object.entries(sourcesMap).map(([source, s]) => ({ source, ...s }))

const summary = {
  crmType: 'zoho',
  totalLeads,
  relevantLeads: leads.filter(l => !IRRELEVANT_STATUSES.has((l.Lead_Status || '').trim())).length,
  irrelevantLeads: leads.filter(l => IRRELEVANT_STATUSES.has((l.Lead_Status || '').trim())).length,
  byStatus,
  bySource,
  objections,
  devices,
  responseTime: {
    avgHours: Math.round(avgHours * 10) / 10,
    respondedWithin1h,
    noResponseCount: responseTimes.length - responded.length,
    respondedCount: responded.length,
    byAgent: agentStats,
    buckets: rtBuckets,
    bucketOrder: RT_BUCKETS,
    bySource: rtBySource,
  },
  deals: {
    // ID COUNT — leads that became an opportunity (have a linked deal)
    opportunities,
    // CLOSING DATE COUNT — linked deals that have a Closing_Date (purchased)
    closed: purchased,
    // אחוז המרה — purchased / leads
    closingRate,
    // Revenue
    grandTotal: Math.round(grandTotal),
    revenue: Math.round(netRevenue),
    avgDealValue,
    devicesSold,
    cancellations: closedWithCancellation.length,
    // Pipeline breakdown
    pipeline: {
      pending: Math.max(0, opportunities - purchased),
      closed: purchased,
    },
  },
  // ===== BCureLaser medical funnel (phone-sales): leads -> opportunities -> purchased -> net =====
  funnel: {
    leads: totalLeads,
    opportunities,                       // leads that became a deal
    purchased,                           // linked deals with a Closing_Date
    cancellations,                       // of the purchased, how many cancelled
    netPurchases,                        // purchased minus cancellations
    conversionRate,                      // purchased / leads  (אחוז המרה לעסקה)
    netRevenue: Math.round(netRevenue),  // revenue after cancellations
    grossRevenue: Math.round(grandTotal),
    cancelledValue: Math.round(cancelledValue),
    avgDealValue,
    // drop-off detail
    leadsNotConverted: notConvertedLeads.length,
    leadStatusDrop,                      // why leads never became opportunities
    openStageDrop,                       // why opportunities have not purchased yet
    byChannel: channelFunnel,            // per-channel funnel (leads/opps/purchased/conv/revenue)
  },
  agentPerformance,
  schemaVersion: ZOHO_SCHEMA_VERSION,
}
  return { leads, linkedDeals, xlsxRows, summary, opportunities, purchased }
}
