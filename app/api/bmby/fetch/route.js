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
      withTimeout(callBmbyGetAllJsonPaginated('tasks',        commonParams, 6), 45000, 'tasks'),
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

    // Aggregate per-source metrics
    const totals = { totalLeads: 0, relevantLeads: 0, nonRelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, registrations: 0, contracts: 0, contractValue: 0 }
    const sources = {}

    const ensureSrc = (key) => {
      if (!sources[key]) sources[key] = { totalLeads: 0, relevantLeads: 0, nonRelevantLeads: 0, meetingsScheduled: 0, meetingsCompleted: 0, registrations: 0, contracts: 0, contractValue: 0 }
      return sources[key]
    }

    // Helper: dates may come as YYYY-MM-DD or YYYY-MM-DD HH:MM:SS — strip to date portion
    const inRange = (d) => {
      if (!d) return false
      const dateOnly = String(d).slice(0, 10)
      return dateOnly >= since && dateOnly <= until
    }

    // Filter clients to those CREATED within the requested date window
    // (BMBY's FromDate/ToDate filters by last-modified, not client_date)
    const clientsInRange = clients.filter(c => inRange(c.client_date || c.created_date))
    // Tasks: use start_date (when task is scheduled) — falls back to create_date
    const tasksInRange = tasks.filter(t => inRange(t.start_date || t.create_date || t.task_date || t.date))
    // Price offers: offer_date / create_date
    const pricesInRange = prices.filter(po => inRange(po.offer_date || po.create_date || po.price_offer_date || po.date))
    // Contracts: contract_date / signed_date / create_date
    const contractsInRange = contracts.filter(k => inRange(k.contract_date || k.signed_date || k.create_date || k.date))

    // Helper: determine if a client is "relevant"
    // BMBY clients service exposes a `relevant` field: "1" = relevant, "0" = not.
    const isRelevant = (c) => {
      if (c.relevant === '1' || c.relevant === 1) return true
      if (c.relevant === '0' || c.relevant === 0) return false
      // Optional override via env var (status whitelist)
      const status = (c.status ?? c.Status ?? '').toString()
      if (relevantStatuses) return relevantStatuses.has(status)
      // Fallback heuristic for older / non-standard data
      const all = JSON.stringify(c).toLowerCase()
      if (/לא ?רלוונ|not ?relevant|cold|קר/.test(all)) return false
      if (/רלוונ|relevant|hot|warm|חם|פושר/.test(all)) return true
      return true
    }

    // BMBY's `media` field looks like: "hi park | מסחר - חנויות למכירה | פייסבוק"
    // It carries the channel info we want to bucket.
    const clientSourceText = (c) => c.media || c.source || c.Source || c.entry_channel || c.origin || ''

    // Process clients (leads) — only those created within the window
    for (const c of clientsInRange) {
      const src = bucketSource(clientSourceText(c))
      const srcBucket = ensureSrc(src)
      totals.totalLeads += 1
      srcBucket.totalLeads += 1
      if (isRelevant(c)) {
        totals.relevantLeads += 1
        srcBucket.relevantLeads += 1
      } else {
        totals.nonRelevantLeads += 1
        srcBucket.nonRelevantLeads += 1
      }
    }

    // Process tasks — BMBY task types: Task / LID / Appointment / Comment / SMS
    // We count Appointment as "meeting scheduled"
    for (const t of tasksInRange) {
      const type = (t.type || t.Type || t.task_type || '').toString().toLowerCase()
      if (type !== 'appointment' && type !== 'meeting' && !/פגישה/.test(JSON.stringify(t))) continue
      const src = bucketSource(t.media_title || t.media || t.source || t.client_source || '')
      const srcBucket = ensureSrc(src)
      totals.meetingsScheduled += 1
      srcBucket.meetingsScheduled += 1
      const status = (t.status || t.Status || '').toString().toLowerCase()
      const completed = /done|complete|בוצע|סגור|ended/.test(status)
      if (completed) {
        totals.meetingsCompleted += 1
        srcBucket.meetingsCompleted += 1
      }
    }

    // Process price offers (registrations / sales opportunities)
    for (const po of pricesInRange) {
      const src = bucketSource(po.media || po.source || po.client_source || '')
      const srcBucket = ensureSrc(src)
      totals.registrations += 1
      srcBucket.registrations += 1
    }

    // Process contracts
    for (const k of contractsInRange) {
      const src = bucketSource(k.media || k.source || k.client_source || '')
      const srcBucket = ensureSrc(src)
      totals.contracts += 1
      srcBucket.contracts += 1
      const val = num(k.price_agreement_inc_vat || k.price_agreement || k.final_price_inc_vat || k.final_price)
      totals.contractValue += val
      srcBucket.contractValue += val
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
      row_count: clientsInRange.length + tasksInRange.length + pricesInRange.length + contractsInRange.length,
    }, { onConflict: 'project_id,source,month' })

    if (upsertErr) errors.push('upsert: ' + upsertErr.message)

    return {
      project: p.name,
      bmbyProjectId: bmbyPid,
      counts: {
        clients: clientsInRange.length,
        tasks: tasksInRange.length,
        prices: pricesInRange.length,
        contracts: contractsInRange.length,
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
