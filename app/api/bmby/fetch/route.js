// API route: /api/bmby/fetch
//   POST - from the admin UI (הרשאה: אדמין מאומת (JWT) או CRON_SECRET פנימי)
//   GET  - from Vercel Cron (auth via Authorization: Bearer <CRON_SECRET>)
//
// Pulls data from BMBY CRM SOAP services (Clients / Tasks / Price Offers / Contracts)
// for each project listed in BMBY_PROJECT_IDS env var, aggregates per-source metrics,
// and writes one `reports` row per project per month with source='crm'.
//
// Env vars required:
//   BMBY_LOGIN                  - API username (from BMBY support, not the web-UI login)
//   BMBY_PASSWORD               - API password
//   BMBY_PROJECT_IDS            - JSON mapping of our project name -> BMBY project_id, e.g.
//                                 {"HI PARK":"1234","ONCE":"1235","REHAVIA":"1236"}
//   BMBY_RELEVANT_STATUSES      - (optional) JSON array of `status` values meaning "relevant", e.g. ["1","2","3"]
//                                 Anything not in this list is counted as "non-relevant".
//                                 If not set, falls back to: lead with status in {"relevant","hot","warm","חם","פושר","רלוונטי"}

import { requireFetchAccess } from '../../../../lib/auth'
import { createClient } from '@supabase/supabase-js'
import { computeBmbySummary, toReportRow } from '../../../../lib/crm/bmby-summary.js'
import { upsertRawRecords, rebuildCompact, ENTITIES } from '../../../../lib/crm/raw-store.js'
import { CRM_SCHEMA_VERSION } from '../../../../lib/crm/schema-version.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // was 60 — HI PARK monthly tasks fetch needs headroom (avoids 0-leads skips)

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

// Parse BMBY "Data" XML (<clients>/<tasks>/... rows) into row objects. Shared by GetAllJson & GetAll.
// Custom fields nested in a <Dynamic> block become obj._cf = {title: value, ...}.
function parseDataXmlRows(dataXml) {
  const rows = []
  if (!dataXml) return rows
  dataXml = dataXml.replace(/<Dynamic>([\s\S]*?)<\/Dynamic>/g, (whole, inner) => {
    const cf = {}
    const unc = (v) => { const c = String(v).match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/); return (c ? c[1] : v).trim() }
    const pairRe = /<title>([\s\S]*?)<\/title>\s*<value>([\s\S]*?)<\/value>/g
    let pm
    while ((pm = pairRe.exec(inner)) !== null) { const t = unc(pm[1]); if (t) cf[t] = unc(pm[2]) }
    return '<customfields>' + JSON.stringify(cf).replace(/</g, '\\u003c') + '</customfields>'
  })
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
    if (obj.customfields) { try { obj._cf = JSON.parse(obj.customfields) } catch { obj._cf = {} } delete obj.customfields }
    rows.push(obj)
  }
  return rows
}

// GetAll envelope (native XML method). Unlike GetAllJson it returns the <Dynamic> custom-field
// block IMMEDIATELY for fresh leads (GetAllJson lags it by days). Same FoundRows/LastUniqID paging.
function buildSoapGetAll(params) {
  const keys = [
    { key: 'Login', type: 'xsd:string' }, { key: 'Password', type: 'xsd:string' },
    { key: 'ProjectID', type: 'xsd:int' }, { key: 'ClientID', type: 'xsd:int' },
    { key: 'UniqID', type: 'xsd:int' }, { key: 'Dynamic', type: 'xsd:int' },
    { key: 'FromDate', type: 'xsd:string' }, { key: 'ToDate', type: 'xsd:string' },
  ]
  const paramXml = keys.map(({ key, type }) => {
    const v = params[key]
    return `<${key} xsi:type="${type}">${v !== undefined && v !== null ? xmlEscape(v) : ''}</${key}>`
  }).join('\n        ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v3="http://www.bmby.com/WebServices/srv/v3/">
  <soapenv:Header/>
  <soapenv:Body>
    <v3:GetAll soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <Parameters xsi:type="v3:GetAllInput">
        ${paramXml}
      </Parameters>
    </v3:GetAll>
  </soapenv:Body>
</soapenv:Envelope>`
}

// Call BMBY SOAP service, return parsed Data (array or object) + metadata
async function callBmbyGetAllJson(service, params, useGetAll = false) {
  const { file } = ENDPOINTS[service]
  const url = file ? `${BMBY_BASE}/${file}` : `${BMBY_BASE}/`
  const body = useGetAll ? buildSoapGetAll(params) : buildSoapGetAllJson(service, params)
  // BMBY intermittently returns 502/503/504 (Cloudflare) or drops the connection
  // ("terminated") under load — especially on the heavier `tasks` call. These are
  // transient, so retry a few times with backoff before giving up. A single failed
  // page here is what makes the integrity guard flag a whole report broken.
  let text, res, lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 400 * attempt))  // 0, .4s, .8s — cheaper so cron aggregate stays < Vercel 300s
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': useGetAll ? '"GetAll"' : '"GetAllJson"' },
        body,
      })
      text = await res.text()
    } catch (e) {
      lastErr = e; res = null; continue  // network drop / terminated → retry
    }
    if (res.ok) { lastErr = null; break }
    // Retry transient gateway errors; fail fast on real 4xx (bad request/auth)
    if ([429, 500, 502, 503, 504].includes(res.status)) {
      lastErr = new Error(`BMBY ${service} HTTP ${res.status}: ${text.slice(0, 200)}`)
      continue
    }
    throw new Error(`BMBY ${service} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  if (!res || !res.ok) {
    throw lastErr || new Error(`BMBY ${service} failed after retries`)
  }

  // Extract payload — GetAll (raw XML wrapper) or GetAllJson (JSON-string wrapper). Same rows parser.
  if (useGetAll) {
    const retMatch = text.match(/<GetAllReturn[^>]*>([\s\S]*?)<\/GetAllReturn>/)
    if (!retMatch) {
      const faultMatch = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/)
      if (faultMatch) throw new Error(`BMBY ${service} fault: ${faultMatch[1].slice(0, 200)}`)
      return { rows: [], foundRows: 0, lastUniqID: 0, rawSnippet: text.slice(0, 500) }
    }
    const inner = retMatch[1]
    const errM = inner.match(/<Error[^>]*>([\s\S]*?)<\/Error>/)
    if (errM && errM[1].trim()) throw new Error(`BMBY ${service} error: ${errM[1].slice(0, 200)}`)
    const foundRows = parseInt((inner.match(/<FoundRows[^>]*>([^<]*)<\/FoundRows>/) || [])[1] || '0', 10) || 0
    const lastUniqID = parseInt((inner.match(/<LastUniqID[^>]*>([^<]*)<\/LastUniqID>/) || [])[1] || '0', 10) || 0
    let dataXml = (inner.match(/<Data[^>]*>([\s\S]*?)<\/Data>/) || [])[1] || ''
    dataXml = dataXml.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    return { rows: parseDataXmlRows(dataXml), foundRows, lastUniqID }
  }
  // GetAllJson: SOAP wraps <GetAllJsonReturn> = a JSON string { FoundRows, LastUniqID, Data, Error }.
  const retMatch = text.match(/<GetAllJsonReturn[^>]*>([\s\S]*?)<\/GetAllJsonReturn>/)
  if (!retMatch) {
    const faultMatch = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/)
    if (faultMatch) throw new Error(`BMBY ${service} fault: ${faultMatch[1].slice(0, 200)}`)
    return { rows: [], foundRows: 0, lastUniqID: 0, rawSnippet: text.slice(0, 500) }
  }
  const jsonStr = retMatch[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  let parsed
  try { parsed = JSON.parse(jsonStr) } catch (e) { return { rows: [], foundRows: 0, lastUniqID: 0, parseError: e.message, rawSnippet: jsonStr.slice(0, 400) } }
  if (parsed.Error && String(parsed.Error).trim()) throw new Error(`BMBY ${service} error: ${String(parsed.Error).slice(0, 200)}`)
  return { rows: parseDataXmlRows(parsed.Data || ''), foundRows: parsed.FoundRows || 0, lastUniqID: parsed.LastUniqID || 0 }
}

// BMBY message/remark fields come with HTML numeric entities (e.g. &#1493; = ו). Decode + shrink.
// Paginate BMBY GetAllJson - BMBY caps each response at 3000 rows.
// We page by using Dynamic=0 + UniqID = previous LastUniqID until FoundRows < 3000
// or we exceed maxPages. ToDate is used as an early-stop signal if the last row's
// create_date is already past the requested window.
async function callBmbyGetAllJsonPaginated(service, params, maxPages = 10, useGetAll = false) {
  const allRows = []
  let uniqID = params.UniqID ?? 1
  let dynamic = params.Dynamic ?? 1
  let lastResp = null
  let pagesUsed = 0
  for (let page = 0; page < maxPages; page++) {
    const resp = await callBmbyGetAllJson(service, { ...params, UniqID: uniqID, Dynamic: dynamic }, useGetAll)
    lastResp = resp
    pagesUsed++
    if (resp.rows.length) allRows.push(...resp.rows)
    // Stop only when a page comes back EMPTY or the cursor stops advancing. We deliberately do
    // NOT stop on "foundRows < 3000": BMBY's GetAll (the clients call) caps each page at 1000,
    // not 3000, so that test broke pagination after the first page → only the oldest 1000 clients
    // were fetched and every newer lead lost its custom fields / profile. Paging by lastUniqID
    // until it stops advancing is cap-agnostic (works for both GetAll=1000 and GetAllJson=3000).
    if (!resp.rows.length) break
    if (!resp.lastUniqID || resp.lastUniqID === uniqID) break
    uniqID = resp.lastUniqID
    if (!useGetAll) dynamic = 0  // GetAll: keep Dynamic=1 so custom fields return on every page
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
      status: 200,  // not a real error - just pending credentials
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
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY   // בלי נפילה חזרה למפתח הציבורי: חסר = 500 מפורש
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

  // Filter to a single project if requested (faster load - caller is viewing only this one)
  const projectsList = opts.projectId
    ? (projects || []).filter(p => p.id === opts.projectId)
    : (projects || [])

  // Helper shared by all projects
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timed out after ' + ms + 'ms')), ms))
  ])

  // Process ALL projects in parallel - so total runtime ≈ slowest single call, not sum
  const projectResults = await Promise.all(projectsList.map(async (p) => {
    const bmbyPid = projectMap[p.name]
    if (!bmbyPid) {
      return { project: p.name, skipped: true, reason: 'no BMBY project_id mapping' }
    }

    const commonParams = { Login: login, Password: password, ProjectID: parseInt(bmbyPid), UniqID: 1, FromDate: since, ToDate: until, Dynamic: 1 }
    // Each service runs paginated with up to 10 pages of 3000 rows. Per-service total budget 45s.
    // Fast diagnostic path: clients only (skips the heavy tasks/prices/contracts calls),
    // used to inspect the BMBY `client_stage` field ("לידים לטיפול") without a full sync.
    const _stagesOnly = !!opts.stagesOnly
    const _apptDump = !!opts.apptDump  // fast: clients+tasks only, dump raw appointment rows
    const [clientsR, tasksR, pricesR, contractsR] = await Promise.allSettled([
      withTimeout(callBmbyGetAllJsonPaginated('clients',      commonParams, 8, true), 120000, 'clients'),  // useGetAll=true → custom fields immediately
      _stagesOnly ? Promise.resolve({ rows: [] }) : withTimeout(callBmbyGetAllJsonPaginated('tasks',        commonParams, 10), 120000, 'tasks'),
      (_stagesOnly || _apptDump) ? Promise.resolve({ rows: [] }) : withTimeout(callBmbyGetAllJsonPaginated('price_offers', commonParams, 4), 120000, 'price_offers'),
      (_stagesOnly || _apptDump) ? Promise.resolve({ rows: [] }) : withTimeout(callBmbyGetAllJsonPaginated('contracts',    commonParams, 4), 120000, 'contracts'),
    ])

    const safeRows = (r) => (r.status === 'fulfilled' && Array.isArray(r.value?.rows)) ? r.value.rows : []
    const clients   = safeRows(clientsR)
    const tasks     = safeRows(tasksR)
    const prices    = safeRows(pricesR)
    const contracts = safeRows(contractsR)

    if (_stagesOnly) {
      // TEMP field-scan diagnostic (design living_status/property-type feature)
      const _dist = {}, _stageXstatus = {}
      for (const c of clients) {
        const st = String(c.client_stage || '(empty)')
        _dist[st] = (_dist[st] || 0) + 1
        const k = st + ' | ' + String(c.status || '(empty)') + ' | relevant=' + String(c.relevant || '')
        _stageXstatus[k] = (_stageXstatus[k] || 0) + 1
      }
      return { project: p.name, stagesOnly: true, totalClients: clients.length, stageDist: _dist, stageXstatus: _stageXstatus }
    }

    if (_apptDump) {
      const _appts = []
      for (const t of tasks) {
        const ty = (t.type || '').toString()
        if (!/appointment|meeting|פגישה/i.test(ty.toLowerCase())) continue
        _appts.push(t)  // full raw row, every field BMBY returns
      }
      // sort by meeting date
      _appts.sort((a,b) => String(a.start_date||'').localeCompare(String(b.start_date||'')))
      return { project: p.name, apptDump: true, since, until, apptCount: _appts.length, appts: _appts }
    }

    const errors = []

    // תמונת מצב גולמית (שלב 1 של docs/daily-ranges-plan.md): מה שנמשך נשמר רשומה-רשומה
    // ב-crm_raw, כדי שטווח מותאם יחושב מכאן בלי לפנות ל-BMBY. כישלון כאן לא מפיל את
    // הריצה — הדוח השמור נכתב כרגיל, והתמונה תתעדכן בריצה הבאה.
    let snapshot = null
    if (opts.snapshot !== false) {
      try {
        const parts = await Promise.all(
          [clients, tasks, prices, contracts].map((rows, i) => upsertRawRecords(supabase, p.id, 'bmby', ENTITIES[i], rows))
        )
        snapshot = Object.fromEntries(parts.map((r, i) => [ENTITIES[i], r]))
        // תמונה דחוסה לחישוב מהיר (מיגרציה 009) — נבנית בתוך ה-DB, קריאה אחת זולה.
        try { snapshot.compact = await rebuildCompact(supabase, p.id, 'bmby') }
        catch (e) { snapshot.compact = { error: String(e?.message || e) } }
      } catch (e) {
        // לא נכנס ל-errors: הדוח השמור נכתב כרגיל, ואין סיבה למייל התראה. מדווח בשדה snapshot.
        snapshot = { error: String(e?.message || e) }
      }
    }
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
          firstRowKeys: res.value.rows.length > 0 ? Object.keys(res.value.rows[0] || {}) : undefined,
          rawSnippet: res.value.rows.length === 0 ? res.value.rawSnippet : undefined,
        }
      }
    }
    captureDebug('clients', clientsR)
    captureDebug('tasks', tasksR)
    captureDebug('price_offers', pricesR)
    captureDebug('contracts', contractsR)

    // חישוב הסיכום — פונקציה טהורה ב-lib/crm/bmby-summary.js (שלב 0 של docs/daily-ranges-plan.md).
    // ה-route נשאר אחראי על המשיכה מ-BMBY ועל הכתיבה לבסיס הנתונים בלבד.
    const R = computeBmbySummary({ clients, tasks, prices, contracts }, { since, until, monthKey: m })
    const { _allRecentContracts, _apptByCoord, _apptByDate, _aprilLidStatusCounts, _completedMeetings, _contractAttribDebug, _meetRecs, _noRespAnyTask, _noRespInclUpdate, _noResponseCids, _skippedBroken, adBreakdown, apptStatusDebug, aprilLids, clientApptList, clientProfileSamples, clientRelevant, clientsWithAppt, clientsWithCancelledAppt, clientsWithDoneAppt, completedMeetingSamples, contractsSignedInRange, crmReportRows, dayOfWeekStats, hourlyApptStats, hourlyContactMeeting, hourlyContactStats, hourlyLeadStats, meetingDayOfWeek, namedLeads, noAnswerContactHour, pricesInRange, registrationsInRange, responseTimeStats, sources, tasksByClient, totals, xlsxRows } = R
    if (_skippedBroken) {
      errors.push(`SKIPPED broken write for ${p.name} [${m}]: 0 leads but registrations/contracts/meetings present (likely failed fetch)`)
    } else {
      const { error: upsertErr } = await supabase.from('reports').upsert({
        project_id: p.id,
        source: 'crm',
        month: m,
        ...toReportRow(R),   // data / summary / row_count — הגדרה אחת, משותפת לנקודת הקצה של הטווחים
        file_name: 'BMBY API (live)',
      }, { onConflict: 'project_id,source,month' })

      if (upsertErr) errors.push('upsert: ' + upsertErr.message)
    }

    // DEBUG: locate specific leads by phone (searches every field) and dump their record + tasks,
    // to reverse-engineer BMBY's "לידים לטיפול" definition against ground truth.
    const _dbgPhones = Array.isArray(opts.debugPhones) ? opts.debugPhones.map(x => String(x).replace(/\D/g, '')).filter(Boolean) : []
    let _phoneDump
    if (_dbgPhones.length) {
      _phoneDump = []
      for (const c of clients) {
        const digits = JSON.stringify(c).replace(/\D/g, '')
        const hit = _dbgPhones.find(ph => ph.length >= 7 && digits.includes(ph))
        if (!hit) continue
        const cid = String(c.client_id || '')
        _phoneDump.push({
          matchedPhone: hit,
          client: c,
          tasks: (tasksByClient.get(cid) || []).map(t => ({ type: t.type, subject: (t.subject || '').toString().slice(0, 60), status: t.status, create_date: t.create_date, start_date: t.start_date })),
        })
      }
    }

    return {
      project: p.name,
      bmbyProjectId: bmbyPid,
      skippedBroken: _skippedBroken,
      counts: {
        leads: aprilLids.length,
        registrations: registrationsInRange.length,
        contracts: contractsSignedInRange.length,
        prices: pricesInRange.length,
      },
      snapshot,
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
      phoneDump: _phoneDump,
      apptStatusDebug,
      apptByCoord: _apptByCoord,
      apptByDate: _apptByDate,
      uniqueByDate: { scheduled: new Set(_meetRecs.sched.map(r => r.cid)).size, completed: new Set(_meetRecs.comp.map(r => r.cid)).size, cancelled: new Set(_meetRecs.canc.map(r => r.cid)).size },
      noRespVariants: { strict: _noResponseCids.size, inclUpdateInfo: _noRespInclUpdate.size, anyTaskEver: _noRespAnyTask.size },
      byDateRelevant: { scheduled: _meetRecs.sched.filter(r => clientRelevant.get(r.cid)).length, completed: _meetRecs.comp.filter(r => clientRelevant.get(r.cid)).length },
      uniqueByDateRelevant: { scheduled: new Set(_meetRecs.sched.filter(r => clientRelevant.get(r.cid)).map(r => r.cid)).size, completed: new Set(_meetRecs.comp.filter(r => clientRelevant.get(r.cid)).map(r => r.cid)).size },
      completedMeetingSamples,
      clientProfileSamples,
      diag: {
        // Compact diag for ops - keep contract attribution chain + funnel status counts
        contractAttrib: _contractAttribDebug.map(c => ({
          client_id: c.client_id,
          client_name: c.client_name,
          agreement_date: c.agreement_date,
          used_val: c.used_val,
          list_price: c.list_price,
          attribSource: c.attribSource,
          attributedMedia: c.attributedMedia,
        })),
        aprilLidStatusCounts: _aprilLidStatusCounts,
        allRecentContracts: _allRecentContracts,
        apptCounts: {
          inWindow: clientsWithAppt.size,
          inWindowDone: clientsWithDoneAppt.size,
          inWindowCancelled: clientsWithCancelledAppt.size,
          totalClientsWithAppts: clientApptList.size,
        },
      },
    }
  }))

  return { status: 200, body: { ok: true, month: m, projects: projectResults } }
}

// ===== handlers =====


// Validate that a value is a safe YYYY-MM-DD date string
function isValidDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}
export async function POST(request) {
  let body = {}
  try { body = await request.json() } catch {}
  const gate = await requireFetchAccess(request, body.projectId)
  if (!gate.ok) return gate.res
  if ((body.since && !isValidDate(body.since)) || (body.until && !isValidDate(body.until))) { return Response.json({ error: 'invalid date format — use YYYY-MM-DD' }, { status: 400 }) }
  try {
    const { status, body: responseBody } = await runSync({
      month: body.month,
      since: body.since,
      until: body.until,
      projectId: body.projectId,
      // אופציות דיבוג שמדפיסות רשומות לידים — לאדמין ולקרונים בלבד.
      debugPhones: gate.admin ? body.debugPhones : undefined,
      stagesOnly: gate.admin ? body.stagesOnly : undefined,
      apptDump: gate.admin ? body.apptDump : undefined,
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
// rebuild trigger 1779228575
