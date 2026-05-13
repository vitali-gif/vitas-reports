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

  // Extract the <Data>...</Data> content — BMBY's GetAllJson returns a JSON string inside <Data>
  const dataMatch = text.match(/<Data[^>]*>([\s\S]*?)<\/Data>/)
  const foundMatch = text.match(/<FoundRows[^>]*>(\d+)<\/FoundRows>/)
  const lastUniqMatch = text.match(/<LastUniqID[^>]*>(\d+)<\/LastUniqID>/)
  const errMatch = text.match(/<Error[^>]*>([\s\S]*?)<\/Error>/)
  if (errMatch && errMatch[1].trim()) {
    throw new Error(`BMBY ${service} error: ${errMatch[1].trim().slice(0, 200)}`)
  }
  if (!dataMatch) {
    // Sometimes the data is returned directly without wrapping — try to find a JSON array/object
    const jsonMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]|\{[\s\S]*?\}/)
    if (jsonMatch) {
      try { return { rows: JSON.parse(jsonMatch[0]), foundRows: 0, lastUniqID: 0 } } catch {}
    }
    return { rows: [], foundRows: 0, lastUniqID: 0, rawPreview: text.slice(0, 500) }
  }

  let rows = []
  const rawData = dataMatch[1].trim()
  // The inner content may be XML-escaped — decode it first
  const decoded = rawData
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  try {
    const parsed = JSON.parse(decoded)
    if (Array.isArray(parsed)) rows = parsed
    else if (parsed && typeof parsed === 'object') rows = parsed.rows || [parsed]
  } catch {
    // If it's XML instead of JSON, we'd need an XML parser — skip for now
  }

  return {
    rows,
    foundRows: foundMatch ? parseInt(foundMatch[1]) : 0,
    lastUniqID: lastUniqMatch ? parseInt(lastUniqMatch[1]) : 0,
    rawSnippet: text.slice(0, 600),
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

  const results = []

  for (const p of projects || []) {
    const bmbyPid = projectMap[p.name]
    if (!bmbyPid) {
      results.push({ project: p.name, skipped: true, reason: 'no BMBY project_id mapping' })
      continue
    }

    const commonParams = { Login: login, Password: password, ProjectID: parseInt(bmbyPid), UniqID: 1, FromDate: since, ToDate: until, Dynamic: 1 }

    // Fetch all 4 services in parallel for this project, with per-call timeout
    const withTimeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timed out after ' + ms + 'ms')), ms))
    ])
    const [clientsR, tasksR, pricesR, contractsR] = await Promise.allSettled([
      withTimeout(callBmbyGetAllJson('clients',      commonParams), 10000, 'clients'),
      withTimeout(callBmbyGetAllJson('tasks',        commonParams), 10000, 'tasks'),
      withTimeout(callBmbyGetAllJson('price_offers', commonParams), 10000, 'price_offers'),
      withTimeout(callBmbyGetAllJson('contracts',    commonParams), 10000, 'contracts'),
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

    // Helper: determine if a client is "relevant"
    const isRelevant = (c) => {
      const status = (c.status ?? c.Status ?? '').toString()
      if (relevantStatuses) return relevantStatuses.has(status)
      // Fallback heuristic: look for Hebrew/English keywords
      const all = JSON.stringify(c).toLowerCase()
      if (/לא ?רלוונ|not ?relevant|cold|קר/.test(all)) return false
      if (/רלוונ|relevant|hot|warm|חם|פושר/.test(all)) return true
      // Default: treat as relevant (conservative)
      return true
    }

    // Process clients (leads)
    for (const c of clients) {
      const src = bucketSource(c.source || c.Source || c.entry_channel || c.origin || '')
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

    // Process tasks (appointments)
    // Appointment = meeting scheduled. If task has a "completed" flag / past-date + flag — completed.
    // The BMBY API doc mentions Type=Appointment. We'll consider a meeting "completed" if task.status === 'completed' or similar.
    for (const t of tasks) {
      const type = (t.type || t.Type || '').toString().toLowerCase()
      if (type !== 'appointment' && type !== 'meeting' && !/פגישה/.test(JSON.stringify(t))) continue
      // figure out source from the linked client if present
      const src = bucketSource(t.source || t.client_source || '')
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
    for (const po of prices) {
      const src = bucketSource(po.source || po.client_source || '')
      const srcBucket = ensureSrc(src)
      totals.registrations += 1
      srcBucket.registrations += 1
    }

    // Process contracts
    for (const k of contracts) {
      const src = bucketSource(k.source || k.client_source || '')
      const srcBucket = ensureSrc(src)
      totals.contracts += 1
      srcBucket.contracts += 1
      const val = num(k.price_agreement_inc_vat || k.price_agreement || k.final_price_inc_vat || k.final_price)
      totals.contractValue += val
      srcBucket.contractValue += val
    }

    // Upsert to Supabase
    const { error: upsertErr } = await supabase.from('reports').upsert({
      project_id: p.id,
      source: 'crm',
      month: m,
      data: { clients, tasks, prices, contracts },
      summary: { ...totals, sources },
      file_name: 'BMBY API (live)',
      row_count: clients.length + tasks.length + prices.length + contracts.length,
    }, { onConflict: 'project_id,source,month' })

    if (upsertErr) errors.push('upsert: ' + upsertErr.message)

    results.push({
      project: p.name,
      bmbyProjectId: bmbyPid,
      counts: {
        clients: clients.length,
        tasks: tasks.length,
        prices: prices.length,
        contracts: contracts.length,
      },
      totals,
      sources,
      errors: errors.length ? errors : undefined,
      debug: Object.keys(debug).length ? debug : undefined,
    })
  }

  return { status: 200, body: { ok: true, month: m, projects: results } }
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
