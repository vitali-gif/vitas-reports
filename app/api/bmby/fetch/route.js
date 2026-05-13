// API route: /api/bmby/fetch
//   POST — from the admin UI (auth via x-client-key header = anon key)
//   GET  — from Vercel Cron (auth via Authorization: Bearer <CRON_SECRET>)
//
// Pulls data from BMBY CRM SOAP services (Clients / Tasks / Price Offers / Contracts)
// for each project listed in BMBY_PROJECT_IDS env var, aggregates per-source metrics,
// and writes one `reports` row per project per month with source='crm'.
//
// Env vars required:
//   BMBY_LOGIN                  — API username (from BMBY support, not the web-UI login)
//   BMBY_PASSWORD               — API password
//   BMBY_PROJECT_IDS            — JSON mapping of our project name -> BMBY project_id, e.g.
//                                 {"HI PARK":"1234","ONCE":"1235","REHAVIA":"1236"}
//   BMBY_RELEVANT_STATUSES      — (optional) JSON array of `status` values meaning "relevant", e.g. ["1","2","3"]
//                                 Anything not in this list is counted as "non-relevant".
//                                 If not set, falls back to: lead with status in {"relevant","hot","warm","חם","פושר","רלוונטי"}

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BMBY_BASE = 'https://www.bmby.com/WebServices/srv/v3'
const ENDPOINTS = {
  clients: { file: '', ns: 'clients.php' },   // primary WSDL is at /?wsdl (no file name)
  tasks:        { file: 'tasks.php',        ns: 'tasks.php' },
  price_offers: { file: 'price_offers.php', ns: 'price_offers.php' },
  contracts:    { file: 'contracts.php',    ns: 'contracts.php' },
}

// ===== helpers =====

function currentMonth() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}

function num(v) {
  if (typeof v === 'number') return v
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(String(v))
  return isNaN(n) ? 0 : n
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Build a SOAP envelope for GetAllJson on the given service
function buildSoapGetAllJson(service, params) {
  const { ns } = ENDPOINTS[service]
  const nsUrl = `https://www.bmby.com/WebServices/srv/v3/${ns}`
  const paramKeys = [
    { key: 'Login',      type: 'xsd:string' },
    { key: 'Password',   type: 'xsd:string' },
    { key: 'ProjectID',  type: 'xsd:int' },
    { key: 'UniqID',     type: 'xsd:int' },
    { key: 'Dynamic',    type: 'xsd:int' },
    { key: 'FromDate',   type: 'xsd:string' },
    { key: 'ToDate',     type: 'xsd:string' },
    { key: 'Limit',      type: 'xsd:int' },
    { key: 'Offset',     type: 'xsd:int' },
  ]
  const paramXml = paramKeys
    .map(({ key, type }) => {
      const v = params[key]
      return `<${key} xsi:type="${type}">${v !== undefined && v !== null ? xmlEscape(v) : ''}</${key}>`
    })
    .join('\n      ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:svc="${nsUrl}">
  <soapenv:Header/>
  <soapenv:Body>
    <svc:GetAllJson>
      <Parameters>
      ${paramXml}
      </Parameters>
    </svc:GetAllJson>
  </soapenv:Body>
</soapenv:Envelope>`
}

// Call BMBY SOAP service, return parsed Data (array or object) + metadata
async function callBmbyGetAllJson(service, params) {
  const { file } = ENDPOINTS[service]
  const url = file ? `${BMBY_BASE}/${file}` : `${BMBY_BASE}/`
  const body = buildSoapGetAllJson(service, params)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '"GetAllJson"',
    },
    body,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`BMBY ${service} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  // BMBY format: SOAP envelope wraps <GetAllJsonReturn> which contains a JSON STRING
  // (HTML-entity-encoded). That JSON parses to { FoundRows, LastUniqID, Data, Error }.
  // `Data` is XML-as-string with <clients>/<tasks>/... root and <row>...</row> children.
  // Each <row> field is wrapped in CDATA.
  const retMatch = text.match(/<GetAllJsonReturn[^>]*>([\s\S]*?)<\/GetAllJsonReturn>/)
  if (!retMatch) {
    const faultMatch = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/)
    if (faultMatch) throw new Error(`BMBY ${service} fault: ${faultMatch[1].slice(0, 200)}`)
    return { rows: [], foundRows: 0, lastUniqID: 0, rawSnippet: text.slice(0, 500) }
  }
  const jsonStr = retMatch[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  let parsed
  try {
    parsed = JSON.parse(jsonStr)
  } catch (e) {
    return { rows: [], foundRows: 0, lastUniqID: 0, parseError: e.message, rawSnippet: jsonStr.slice(0, 400) }
  }
  if (parsed.Error && String(parsed.Error).trim()) {
    throw new Error(`BMBY ${service} error: ${String(parsed.Error).slice(0, 200)}`)
  }

  // Parse the XML-as-string in `Data` into row objects
  const rows = []
  const dataXml = parsed.Data || ''
  if (dataXml) {
    const rowRegex = /<row>([\s\S]*?)<\/row>/g
    let m
    while ((m = rowRegex.exec(dataXml)) !== null) {
      const rowXml = m[1]
      const obj = {}
      const fieldRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
      let fm
      while ((fm = fieldRegex.exec(rowXml)) !== null) {
        let val = fm[2]
        const cdataMatch = val.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
        if (cdataMatch) val = cdataMatch[1]
        obj[fm[1]] = val
      }
      rows.push(obj)
    }
  }

  return {
    rows,
    foundRows: parsed.FoundRows || 0,
    lastUniqID: parsed.LastUniqID || 0,
  }
}

// Paginate BMBY GetAllJson — BMBY caps each response at 3000 rows.
// We page by using Dynamic=0 + UniqID = previous LastUniqID until FoundRows < 3000
// or we exceed maxPages. ToDate is used as an early-stop signal if the last row's
// create_date is already past the requested window.
async function callBmbyGetAllJsonPaginated(service, params, maxPages = 10) {
  const allRows = []
  let uniqID = params.UniqID ?? 1
  let dynamic = params.Dynamic ?? 1
  let lastResp = null
  let pagesUsed = 0
  for (let page = 0; page < maxPages; page++) {
    const resp = await callBmbyGetAllJson(service, { ...params, UniqID: uniqID, Dynamic: dynamic })
    lastResp = resp
    pagesUsed++
    if (resp.rows.length) allRows.push(...resp.rows)
    // No next page if we got less than the BMBY page cap
    if (!resp.foundRows || resp.foundRows < 3000) break
    if (!resp.lastUniqID || resp.lastUniqID === uniqID) break
    uniqID = resp.lastUniqID
    dynamic = 0
    // Early stop: if the last row in this page is already past ToDate, no point continuing
    if (params.ToDate && resp.rows.length) {
      const candidates = ['client_date', 'create_date', 'start_date', 'task_date', 'date', 'offer_date', 'contract_date', 'signed_date']
      const lastRow = resp.rows[resp.rows.length - 1]
      for (const key of candidates) {
        const v = (lastRow[key] || '').toString().slice(0, 10)
        if (v && v > params.ToDate) return { rows: allRows, foundRows: lastResp.foundRows, lastUniqID: lastResp.lastUniqID, pages: pagesUsed, earlyStop: true }
      }
    }
  }
  return {
    rows: allRows,
    foundRows: lastResp?.foundRows || 0,
    lastUniqID: lastResp?.lastUniqID || 0,
    pages: pagesUsed,
  }
}

// ===== source detection =====
// Map a raw BMBY source/entry-channel string to a canonical bucket used in the dashboard.
const SOURCE_BUCKETS = [
  { bucket: 'Facebook', patterns: [/facebook/i, /\bFB\b/i, /אינסטגרם/, /instagram/i, /פייסבוק/] },
  { bucket: 'Google',   patterns: [/google/i, /גוגל/, /\bSEM\b/i, /adwords/i] },
  { bucket: 'Organic',  patterns: [/organic/i, /אורגני/, /SEO/i, /ישיר/i, /direct/i] },
  { bucket: 'Phone',    patterns: [/phone/i, /טלפון/, /שיחה/] },
  { bucket: 'Referral', patterns: [/refer/i, /הפניה/, /המלצה/] },
]
function bucketSource(raw) {
  const s = (raw || '').toString().trim()
  if (!s) return 'Unknown'
  for (const { bucket, patterns } of SOURCE_BUCKETS) {
    for (const p of patterns) if (p.test(s)) return bucket
  }
  return s // return the raw value as its own bucket
}

// ===== main sync logic =====

async function runSync(opts = {}) {
  const { month, since: sinceOpt, until: untilOpt } = opts

  const login = process.env.BMBY_LOGIN
  const password = process.env.BMBY_PASSWORD
  const projectIdsRaw = process.env.BMBY_PROJECT_IDS
  const relevantStatusesRaw = process.env.BMBY_RELEVANT_STATUSES

  if (!login || !password || !projectIdsRaw) {
    return {
      status: 200,  // not a real error — just pending credentials
      body: {
        ok: false,
        pending: true,
        message: 'BMBY API credentials not configured yet. Set BMBY_LOGIN, BMBY_PASSWORD, BMBY_PROJECT_IDS env vars in Vercel once available.',
      },
    }
  }

  let projectMap
  try { projectMap = JSON.parse(projectIdsRaw) }
  catch (e) { return { status: 500, body: { error: 'BMBY_PROJECT_IDS is not valid JSON: ' + e.message } } }

  const relevantStatuses = relevantStatusesRaw
    ? (() => { try { return new Set(JSON.parse(relevantStatusesRaw).map(String)) } catch { return null } })()
    : null

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return { status: 500, body: { error: 'Missing Supabase credentials' } }
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  // Build date range (SOAP expects YYYY-MM-DD for FromDate/ToDate)
  let since, until, m
  if (sinceOpt && untilOpt) {
    since = sinceOpt; until = untilOpt
    m = `${since}_${until}`
  } else {
    const mArg = month || currentMonth()
    const [y, mm] = mArg.split('-').map(Number)
    since = `${y}-${String(mm).padStart(2, '0')}-01`
    const lastDay = new Date(y, mm, 0).getDate()
    until = `${y}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    m = mArg
  }

  // Load our projects list from Supabase
  const { data: projects, error: projectsError } = await supabase
    .from('projects')
    .select('id, name')
  if (projectsError) return { status: 500, body: { error: 'Failed to load projects: ' + projectsError.message } }

  // Helper shared by all projects
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timed out after ' + ms + 'ms')), ms))
  ])

  // Process ALL projects in parallel — so total runtime ≈ slowest single call, not sum
  const projectResults = await Promise.all((projects || []).map(async (p) => {
    const bmbyPid = projectMap[p.name]
    if (!bmbyPid) {
      return { project: p.name, skipped: true, reason: 'no BMBY project_id mapping' }
    }

    const commonParams = { Login: login, Password: password, ProjectID: parseInt(bmbyPid), UniqID: 1, FromDate: since, ToDate: until, Dynamic: 1 }
    // Each service runs paginated with up to 10 pages of 3000 rows. Per-service total budget 45s.
    const [clientsR, tasksR, pricesR, contractsR] = await Promise.allSettled([
      withTimeout(callBmbyGetAllJsonPaginated('clients',      commonParams, 4), 45000, 'clients'),
      withTimeout(callBmbyGetAllJsonPaginated('tasks',        commonParams, 10), 45000, 'tasks'),
      withTimeout(callBmbyGetAllJsonPaginated('price_offers', commonParams, 4), 45000, 'price_offers'),
      withTimeout(callBmbyGetAllJsonPaginated('contracts',    commonParams, 4), 45000, 'contracts'),
    ])

    const safeRows = (r) => (r.status === 'fulfilled' && Array.isArray(r.value?.rows)) ? r.value.rows : []
    const clients   = safeRows(clientsR)
    const tasks     = safeRows(tasksR)
    const prices    = safeRows(pricesR)
    const contracts = safeRows(contractsR)

    const errors = []
    const debug = {}
    const captureDebug = (label, res) => {
      if (res.status === 'rejected') {
        errors.push(label + ': ' + (res.reason?.message || String(res.reason)))
      } else if (res.value && !Array.isArray(res.value.rows)) {
        debug[label] = { rawPreview: res.value.rawPreview?.slice(0, 500), foundRows: res.value.foundRows, lastUniqID: res.value.lastUniqID, valueKeys: Object.keys(res.value || {}) }
      } else if (res.value && Array.isArray(res.value.rows)) {
        debug[label] = {
          count: res.value.rows.length,
          foundRows: res.value.foundRows,
          lastUniqID: res.value.lastUniqID,
          firstRowKeys: res.value.rows.length > 0 ? Object.keys(res.value.rows[0] || {}).slice(0, 10) : undefined,
          rawSnippet: res.value.rows.length === 0 ? res.value.rawSnippet : undefined,
        }
      }
    }
    captureDebug('clients', clientsR)
    captureDebug('tasks', tasksR)
    captureDebug('price_offers', pricesR)
    captureDebug('contracts', contractsR)

    // ===== Reverse-engineered "דוח יחסי המרה" counting logic =====
    // BMBY's conversion-rate report bucketing:
    //   "סה"כ לידים" per media = number of LID tasks in window with task.media_title == media
    //   "תואמו" per media       = number of LIDs in window whose client_id has an Appointment in window
    //   "בוצעו" per media       = number of LIDs in window whose client_id has a completed Appointment in window
    //   "עסקאות" per media      = number of contracts whose agreement_date is in window AND
    //                              whose client_id appears in any LID with that media (in window)
    //   "סכום העסקאות"          = sum of list_price for those contracts
    //   "רלוונטיים/לא"          = relevant flag on the underlying client (most-recent value)
    //
    // April LIDs are the universe of "leads" for the period. Per the report each LID is one row,
    // and the media_title carried on the LID task is the bucketing key — not the client's media.

    // Helper: dates may come as YYYY-MM-DD or YYYY-MM-DD HH:MM:SS — strip to date portion
    const inRangeDate = (d) => {
      if (!d) return false
      const dateOnly = String(d).slice(0, 10)
      return dateOnly >= since && dateOnly <= until
    }

    // 1. LID tasks in window — each row counts as one lead under its own media_title
    const aprilLids = tasks.filter(t => {
      const ty = (t.type || '').toString().toLowerCase()
      return ty === 'lid' && inRangeDate(t.start_date || t.create_date)
    })

    // 2. Appointments — multiple counting strategies to find the one matching BMBY's report
    // Strategy A (current): client has appointment in window
    // Strategy B: client has ANY appointment (regardless of date)
    // Strategy C: client has appointment with start_date >= their first LID's start_date
    const clientsWithAppt = new Set()
    const clientsWithDoneAppt = new Set()
    const clientsWithCancelledAppt = new Set()
    const clientsWithAnyAppt = new Set()
    const clientsWithAnyDoneAppt = new Set()
    const clientsWithAnyCancelledAppt = new Set()
    // For each client, track earliest LID start_date (in window) — used by strategy C
    const clientFirstAprilLidDate = new Map()
    // Debug: collect unique task types & appointment statuses we encountered
    const _taskTypeCounts = {}
    const _apptStatusCounts = {}
    const _apptsInWindowByMonth = {}
    for (const t of tasks) {
      const tyRaw = (t.type || '').toString()
      const ty = tyRaw.toLowerCase()
      _taskTypeCounts[tyRaw || '(empty)'] = (_taskTypeCounts[tyRaw || '(empty)'] || 0) + 1
      const isAppt = /appointment|meeting|פגישה/i.test(ty)
      if (!isAppt) continue
      const cid = String(t.client_id || '')
      if (!cid) continue
      const statusRaw = (t.status || '').toString()
      const status = statusRaw.toLowerCase()
      _apptStatusCounts[statusRaw || '(empty)'] = (_apptStatusCounts[statusRaw || '(empty)'] || 0) + 1
      // Always count toward "any appointment" set
      clientsWithAnyAppt.add(cid)
      if (/done|complete|בוצע|התקיים|סגור|סגרה|נסגרה|ended|success|finaliz|הסתיים/.test(status)) clientsWithAnyDoneAppt.add(cid)
      if (/cancel|בוטל/.test(status)) clientsWithAnyCancelledAppt.add(cid)
      // Window-only sets
      if (inRangeDate(t.start_date || t.create_date)) {
        const dateMonth = String(t.start_date || t.create_date || '').slice(0, 7)
        _apptsInWindowByMonth[dateMonth] = (_apptsInWindowByMonth[dateMonth] || 0) + 1
        clientsWithAppt.add(cid)
        if (/done|complete|בוצע|התקיים|סגור|סגרה|נסגרה|ended|success|finaliz|הסתיים/.test(status)) clientsWithDoneAppt.add(cid)
        if (/cancel|בוטל/.test(status)) clientsWithCancelledAppt.add(cid)
      }
    }

    // 3. Map client_id → relevant flag (from clients table, ALL clients not just inRange)
    const clientRelevant = new Map()
    for (const c of clients) {
      if (!c.client_id) continue
      // Stored as string "1"/"0" in BMBY
      clientRelevant.set(String(c.client_id), c.relevant === '1' || c.relevant === 1)
    }

    // 4. Per-media aggregation from LIDs
    const totals = {
      totalLeads: 0, relevantLeads: 0, nonRelevantLeads: 0, irrelevantLeads: 0,
      meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
      // Strategy B: any-time appointment counts per LID
      meetingsScheduledAny: 0, meetingsCompletedAny: 0, meetingsCancelledAny: 0,
      registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
    }
    const sources = {}
    const mediaClientIds = new Map() // media → Set<client_id> in window (for contracts attribution)
    const ensureSrc = (key) => {
      if (!sources[key]) sources[key] = {
        totalLeads: 0, relevantLeads: 0, nonRelevantLeads: 0,
        meetingsScheduled: 0, meetingsCompleted: 0, meetingsCancelled: 0,
        registrations: 0, registrationValue: 0, contracts: 0, contractValue: 0,
      }
      return sources[key]
    }

    for (const lid of aprilLids) {
      const media = (lid.media_title || 'ללא מקור').trim() || 'ללא מקור'
      const cid = String(lid.client_id || '')
      const bucket = ensureSrc(media)

      // Track which clients per media (for contract attribution)
      if (!mediaClientIds.has(media)) mediaClientIds.set(media, new Set())
      if (cid) mediaClientIds.get(media).add(cid)

      // Total leads
      totals.totalLeads += 1
      bucket.totalLeads += 1

      // Relevant
      if (clientRelevant.get(cid)) {
        totals.relevantLeads += 1
        bucket.relevantLeads += 1
      } else {
        totals.nonRelevantLeads += 1
        bucket.nonRelevantLeads += 1
      }

      // Meetings (counted per LID — if same client has 2 LIDs and 1 appointment, both LIDs count)
      if (clientsWithAppt.has(cid)) {
        totals.meetingsScheduled += 1
        bucket.meetingsScheduled += 1
      }
      if (clientsWithDoneAppt.has(cid)) {
        totals.meetingsCompleted += 1
        bucket.meetingsCompleted += 1
      }
      if (clientsWithCancelledAppt.has(cid)) {
        totals.meetingsCancelled += 1
        bucket.meetingsCancelled += 1
      }
      // Strategy B (any-time)
      if (clientsWithAnyAppt.has(cid)) totals.meetingsScheduledAny += 1
      if (clientsWithAnyDoneAppt.has(cid)) totals.meetingsCompletedAny += 1
      if (clientsWithAnyCancelledAppt.has(cid)) totals.meetingsCancelledAny += 1
    }

    // After bucketing LIDs we can compute "any appointment ever" counts for comparison
    // (Strategy B: at most one of each per April-LID-client, regardless of appointment date)
    // Computed inline below in the LID loop.

    // 5b. Historical attribution maps (across ALL fetched tasks, not just window)
    //   - clientToAnyLidMedia: latest LID's media_title per client (any date in fetched data)
    //   - clientMedia: client.media field from clients table (BMBY's source-of-truth attribution)
    const clientToAnyLidMedia = new Map()
    {
      // Sort LIDs by start_date desc so first hit per client is the most recent
      const allLidsByDate = tasks
        .filter(t => (t.type || '').toString().toLowerCase() === 'lid')
        .sort((a, b) => String(b.start_date || b.create_date || '').localeCompare(String(a.start_date || a.create_date || '')))
      for (const lid of allLidsByDate) {
        const cid = String(lid.client_id || '')
        if (!cid || clientToAnyLidMedia.has(cid)) continue
        const mt = (lid.media_title || '').trim()
        if (mt) clientToAnyLidMedia.set(cid, mt)
      }
    }
    const clientMedia = new Map()
    for (const c of clients) {
      if (!c.client_id) continue
      const media = (c.media || c.media_title || '').toString().trim()
      if (media) clientMedia.set(String(c.client_id), media)
    }

    // 5. Contracts: agreement_date in window. Attribute to media via client_id with fallback chain.
    const contractsInRange = contracts.filter(k => inRangeDate(k.agreement_date || k.contract_date || k.signed_date || k.create_date))
    const _contractAttribDebug = []
    for (const k of contractsInRange) {
      const cid = String(k.client_id || '')
      const val = num(k.list_price || k.price_agreement || k.final_price || k.price_agreement_inc_vat)
      // Fallback chain: window LIDs → any historical LID → client.media → "ללא מקור"
      let attributedMedia = null
      let attribSource = null
      for (const [media, ids] of mediaClientIds.entries()) {
        if (ids.has(cid)) { attributedMedia = media; attribSource = 'window_lid'; break }
      }
      if (!attributedMedia && clientToAnyLidMedia.has(cid)) {
        attributedMedia = clientToAnyLidMedia.get(cid); attribSource = 'historical_lid'
      }
      if (!attributedMedia && clientMedia.has(cid)) {
        attributedMedia = clientMedia.get(cid); attribSource = 'client_media'
      }
      if (!attributedMedia) { attributedMedia = 'ללא מקור'; attribSource = 'none' }
      _contractAttribDebug.push({
        client_id: cid,
        client_name: ((k.client_fname || '') + ' ' + (k.client_lname || '')).trim() || undefined,
        agreement_date: k.agreement_date,
        contract_date: k.contract_date,
        used_val: val,
        list_price: num(k.list_price),
        price_agreement: num(k.price_agreement),
        price_agreement_inc_vat: num(k.price_agreement_inc_vat),
        final_price: num(k.final_price),
        final_price_inc_vat: num(k.final_price_inc_vat),
        contract_status: k.contract_status,
        attributedMedia,
        attribSource,
      })
      const bucket = ensureSrc(attributedMedia)
      totals.contracts += 1
      bucket.contracts += 1
      totals.contractValue += val
      bucket.contractValue += val
    }

    // 6. Price offers (currently unused for ש.ברוך — kept for future)
    const pricesInRange = prices.filter(po => inRangeDate(po.offer_date || po.create_date))
    for (const po of pricesInRange) {
      const cid = String(po.client_id || '')
      let attributedMedia = null
      for (const [media, ids] of mediaClientIds.entries()) {
        if (ids.has(cid)) { attributedMedia = media; break }
      }
      if (!attributedMedia) continue
      const bucket = ensureSrc(attributedMedia)
      totals.registrations += 1
      bucket.registrations += 1
    }

    // Build xlsx-shape rows (one row per source) so the dashboard's aggregateCrmRows works as-is
    const xlsxRows = Object.entries(sources).map(([sourceName, s]) => ({
      source: sourceName,
      totalLeads: s.totalLeads,
      relevantLeads: s.relevantLeads,
      irrelevantLeads: s.nonRelevantLeads,
      meetingsScheduled: s.meetingsScheduled,
      meetingsCompleted: s.meetingsCompleted,
      meetingsCancelled: 0,
      registrations: s.registrations,
      registrationValue: 0,
      contracts: s.contracts,
      contractValue: s.contractValue,
    }))

    // Upsert to Supabase — `data` stays xlsx-shape so the existing dashboard aggregator works
    const { error: upsertErr } = await supabase.from('reports').upsert({
      project_id: p.id,
      source: 'crm',
      month: m,
      data: xlsxRows,
      summary: { ...totals, sources },
      file_name: 'BMBY API (live)',
      row_count: aprilLids.length + contractsInRange.length + pricesInRange.length,
    }, { onConflict: 'project_id,source,month' })

    if (upsertErr) errors.push('upsert: ' + upsertErr.message)

    return {
      project: p.name,
      bmbyProjectId: bmbyPid,
      counts: {
        leads: aprilLids.length,
        contracts: contractsInRange.length,
        prices: pricesInRange.length,
      },
      totalRaw: {
        clients: clients.length,
        tasks: tasks.length,
        prices: prices.length,
        contracts: contracts.length,
      },
      totals,
      sources,
      errors: errors.length ? errors : undefined,
      debug: Object.keys(debug).length ? debug : undefined,
      diag: {
        taskTypeCounts: _taskTypeCounts,
        apptStatusCounts: _apptStatusCounts,
        apptsInWindowByMonth: _apptsInWindowByMonth,
        contractAttrib: _contractAttribDebug,
        historicalLidMediaSize: clientToAnyLidMedia.size,
        clientMediaSize: clientMedia.size,
        clientsWithAnyAppt: clientsWithAnyAppt.size,
        clientsWithAnyDoneAppt: clientsWithAnyDoneAppt.size,
        clientsWithAnyCancelledAppt: clientsWithAnyCancelledAppt.size,
        clientsWithAprilApptOnly: clientsWithAppt.size,
        clientsWithAprilDoneApptOnly: clientsWithDoneAppt.size,
      },
    }
  }))

  return { status: 200, body: { ok: true, month: m, projects: projectResults } }
}

// ===== handlers =====

export async function POST(request) {
  const anon = request.headers.get('x-client-key')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body = {}
  try { body = await request.json() } catch {}
  try {
    const { status, body: responseBody } = await runSync({
      month: body.month,
      since: body.since,
      until: body.until,
    })
    return Response.json(responseBody, { status })
  } catch (err) {
    return Response.json({
      error: 'runSync threw: ' + (err.message || String(err)),
      stack: (err.stack || '').split('\n').slice(0, 5).join('\n'),
    }, { status: 500 })
  }
}

export async function GET(request) {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '')
  const expected = process.env.CRON_SECRET

  if (expected && bearer === expected) {
    const { status, body: responseBody } = await runSync()
    return Response.json(responseBody, { status })
  }

  // Health check
  return Response.json({
    ok: true,
    configured: Boolean(process.env.BMBY_LOGIN && process.env.BMBY_PASSWORD && process.env.BMBY_PROJECT_IDS),
    note: 'Configured means env vars are set. Actual API connectivity is verified only when POST is called.',
  })
}
