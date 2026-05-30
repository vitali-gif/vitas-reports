// API route: /api/bmby/debug
//   GET /api/bmby/debug?key=<ANON_KEY>&project=HI%20PARK&days=30&sample=3
//
// Returns RAW rows from BMBY's 4 SOAP services with NO field filtering.
// Lets us discover every field BMBY actually exposes.
//
// Auth: either
//   - ?key=<NEXT_PUBLIC_SUPABASE_ANON_KEY>   (public key, fine for read-only debug)
//   - x-client-key header = anon key
//   - ?secret=<CRON_SECRET>
// Read-only — does NOT write to Supabase.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BMBY_BASE = 'https://www.bmby.com/WebServices/srv/v3'
const ENDPOINTS = {
  clients:      { file: '',                 ns: 'clients.php'      },
  tasks:        { file: 'tasks.php',        ns: 'tasks.php'        },
  price_offers: { file: 'price_offers.php', ns: 'price_offers.php' },
  contracts:    { file: 'contracts.php',    ns: 'contracts.php'    },
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildSoapGetAllJson(service, params) {
  const { ns } = ENDPOINTS[service]
  const nsUrl = `https://www.bmby.com/WebServices/srv/v3/${ns}`
  const paramKeys = [
    { key: 'Login',     type: 'xsd:string' },
    { key: 'Password',  type: 'xsd:string' },
    { key: 'ProjectID', type: 'xsd:int'    },
    { key: 'UniqID',    type: 'xsd:int'    },
    { key: 'Dynamic',   type: 'xsd:int'    },
    { key: 'FromDate',  type: 'xsd:string' },
    { key: 'ToDate',    type: 'xsd:string' },
    { key: 'Limit',     type: 'xsd:int'    },
    { key: 'Offset',    type: 'xsd:int'    },
  ]
  const paramXml = paramKeys.map(({ key, type }) => {
    const v = params[key]
    return `<${key} xsi:type="${type}">${v !== undefined && v !== null ? xmlEscape(v) : ''}</${key}>`
  }).join('\n      ')

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

async function callBmbyGetAllJson(service, params) {
  const { file } = ENDPOINTS[service]
  const url = file ? `${BMBY_BASE}/${file}` : `${BMBY_BASE}/`
  const body = buildSoapGetAllJson(service, params)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"GetAllJson"' },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`BMBY ${service} HTTP ${res.status}: ${text.slice(0, 300)}`)

  const retMatch = text.match(/<GetAllJsonReturn[^>]*>([\s\S]*?)<\/GetAllJsonReturn>/)
  if (!retMatch) {
    const faultMatch = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/)
    if (faultMatch) throw new Error(`BMBY ${service} fault: ${faultMatch[1].slice(0, 200)}`)
    return { rows: [], foundRows: 0, lastUniqID: 0 }
  }
  const jsonStr = retMatch[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

  let parsed
  try { parsed = JSON.parse(jsonStr) } catch (e) {
    return { rows: [], foundRows: 0, lastUniqID: 0, parseError: e.message }
  }
  if (parsed.Error && String(parsed.Error).trim()) {
    throw new Error(`BMBY ${service} error: ${String(parsed.Error).slice(0, 200)}`)
  }

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
  return { rows, foundRows: parsed.FoundRows || 0, lastUniqID: parsed.LastUniqID || 0 }
}

function summarizeFields(rows) {
  const fieldStats = {}
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (!fieldStats[k]) fieldStats[k] = { count: 0, nonEmptyCount: 0, exampleValue: null }
      fieldStats[k].count += 1
      const hasVal = v !== '' && v !== null && v !== undefined
      if (hasVal) {
        fieldStats[k].nonEmptyCount += 1
        if (fieldStats[k].exampleValue === null) fieldStats[k].exampleValue = String(v).slice(0, 80)
      }
    }
  }
  return fieldStats
}

function nonEmptyRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (v !== '' && v !== null && v !== undefined) out[k] = v
  }
  return out
}

function isAuthorized(req) {
  const url = new URL(req.url)
  // Restricted to CRON_SECRET only — anon key is public so allowing it
  // would expose raw BMBY data (names, phones) to anyone.
  const cronSecret = process.env.CRON_SECRET || ''
  const querySecret = url.searchParams.get('secret') || ''
  if (cronSecret && querySecret === cronSecret) return true
  return false
}

export async function GET(req) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'unauthorized — pass ?secret=<CRON_SECRET>' }, { status: 401 })
  }

  const url = new URL(req.url)

  let projectMap = {}
  try { projectMap = JSON.parse(process.env.BMBY_PROJECT_IDS || '{}') } catch {}
  const projectName = url.searchParams.get('project') || Object.keys(projectMap)[0] || ''
  const bmbyPid = projectMap[projectName]
  if (!bmbyPid) {
    return Response.json({
      error: `unknown project. Available: ${Object.keys(projectMap).join(', ')}`,
      hint: 'pass ?project=HI%20PARK',
    }, { status: 400 })
  }

  const days = parseInt(url.searchParams.get('days') || '30', 10)
  const sampleLimit = parseInt(url.searchParams.get('sample') || '3', 10)
  const to = new Date()
  const from = new Date(Date.now() - days * 86400 * 1000)
  const FromDate = from.toISOString().slice(0, 10)
  const ToDate = to.toISOString().slice(0, 10)

  const commonParams = {
    Login:     process.env.BMBY_LOGIN || '',
    Password:  process.env.BMBY_PASSWORD || '',
    ProjectID: bmbyPid,
    UniqID:    1,
    Dynamic:   1,
    FromDate,
    ToDate,
  }

  const results = {}
  for (const svc of Object.keys(ENDPOINTS)) {
    try {
      const r = await callBmbyGetAllJson(svc, commonParams)
      const stats = summarizeFields(r.rows)
      const sampleRows = r.rows.slice(0, sampleLimit).map(nonEmptyRow)
      results[svc] = {
        foundRows: r.foundRows,
        rowsInSample: r.rows.length,
        fieldNames: Object.keys(stats).sort(),
        fieldStats: stats,
        sampleRows,
      }
    } catch (e) {
      results[svc] = { error: e.message }
    }
  }

  return Response.json({
    project: projectName,
    bmbyProjectId: bmbyPid,
    window: { from: FromDate, to: ToDate, days },
    sampleLimit,
    services: results,
  })
}
