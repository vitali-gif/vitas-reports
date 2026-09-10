// /api/bmby/lead-notes — full note history for ONE lead, fetched live from BMBY on demand.
//
// WHY LIVE AND NOT STORED: the nightly sync pulls tasks with FromDate/ToDate = the period
// being synced, so a lead that arrived in March and met in September has its March notes
// outside every September report. Storing "all notes for all leads" in the report row would
// bloat the payload we just spent a week shrinking. A single lead's history, pulled when the
// user actually clicks a row, costs nothing until it is asked for.
//
// BMBY's GetAll input type declares a ClientID parameter, so the filter is applied server-side.
// We do NOT trust that: rows are filtered by client_id here too, and the response reports
// `filterHonored` so a silent BMBY change shows up as a diagnostic instead of wrong data.
//
// NOTE: this file keeps its own small copy of the SOAP envelope/parser rather than importing
// from ../fetch/route.js — deliberately, so a change here can never destabilise the nightly sync.
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const BMBY_BASE = 'https://www.bmby.com/WebServices/srv/v3'
const YEARS_BACK = 4          // how far back to look for a lead's history
const MAX_PAGES = 5

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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

function parseDataXmlRows(dataXml) {
  const rows = []
  if (!dataXml) return rows
  dataXml = dataXml.replace(/<Dynamic>[\s\S]*?<\/Dynamic>/g, '')   // custom fields not needed here
  const rowRegex = /<row>([\s\S]*?)<\/row>/g
  let m
  while ((m = rowRegex.exec(dataXml)) !== null) {
    const obj = {}
    const fieldRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
    let fm
    while ((fm = fieldRegex.exec(m[1])) !== null) {
      let val = fm[2]
      const cdata = val.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
      if (cdata) val = cdata[1]
      obj[fm[1]] = val
    }
    rows.push(obj)
  }
  return rows
}

// BMBY returns Hebrew as HTML numeric entities (&#1493; = ו).
function decodeBmbyEntities(str) {
  if (!str) return str
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return _ } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)) } catch { return _ } })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

async function callTasksGetAll(params) {
  const body = buildSoapGetAll(params)
  let text, res, lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 400 * attempt))
    try {
      res = await fetch(`${BMBY_BASE}/tasks.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"GetAll"' },
        body,
        cache: 'no-store',
      })
      text = await res.text()
    } catch (e) { lastErr = e; res = null; continue }
    if (res.ok) { lastErr = null; break }
    if ([429, 500, 502, 503, 504].includes(res.status)) { lastErr = new Error(`BMBY tasks HTTP ${res.status}`); continue }
    throw new Error(`BMBY tasks HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  if (!res || !res.ok) throw lastErr || new Error('BMBY tasks failed after retries')

  const ret = text.match(/<GetAllReturn[^>]*>([\s\S]*?)<\/GetAllReturn>/)
  if (!ret) {
    const fault = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/)
    if (fault) throw new Error(`BMBY tasks fault: ${fault[1].slice(0, 200)}`)
    return { rows: [], lastUniqID: 0 }
  }
  const inner = ret[1]
  const errM = inner.match(/<Error[^>]*>([\s\S]*?)<\/Error>/)
  if (errM && errM[1].trim()) throw new Error(`BMBY tasks error: ${errM[1].slice(0, 200)}`)
  const lastUniqID = parseInt((inner.match(/<LastUniqID[^>]*>([^<]*)<\/LastUniqID>/) || [])[1] || '0', 10) || 0
  let dataXml = (inner.match(/<Data[^>]*>([\s\S]*?)<\/Data>/) || [])[1] || ''
  dataXml = dataXml.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  return { rows: parseDataXmlRows(dataXml), lastUniqID }
}

export async function POST(request) {
  const anon = request.headers.get('x-client-key')
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || anon !== process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body = {}
  try { body = await request.json() } catch {}
  const projectId = String(body.projectId || '')
  const clientId = String(body.clientId || '').trim()
  if (!projectId || !/^\d+$/.test(clientId)) {
    return Response.json({ error: 'projectId and a numeric clientId are required' }, { status: 400 })
  }

  const login = process.env.BMBY_LOGIN
  const password = process.env.BMBY_PASSWORD
  const projectIdsRaw = process.env.BMBY_PROJECT_IDS
  if (!login || !password || !projectIdsRaw) {
    return Response.json({ error: 'BMBY credentials not configured' }, { status: 500 })
  }
  let projectMap
  try { projectMap = JSON.parse(projectIdsRaw) }
  catch (e) { return Response.json({ error: 'BMBY_PROJECT_IDS is not valid JSON' }, { status: 500 }) }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return Response.json({ error: 'Missing Supabase credentials' }, { status: 500 })
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  const { data: proj, error: projErr } = await supabase.from('projects').select('id, name').eq('id', projectId).limit(1)
  if (projErr) return Response.json({ error: 'Failed to load project: ' + projErr.message }, { status: 500 })
  const project = (proj || [])[0]
  if (!project) return Response.json({ error: 'project not found' }, { status: 404 })
  const bmbyPid = projectMap[project.name]
  if (!bmbyPid) return Response.json({ error: `no BMBY mapping for project "${project.name}"` }, { status: 400 })

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
  const from = `${Number(today.slice(0, 4)) - YEARS_BACK}${today.slice(4)}`

  const base = {
    Login: login, Password: password,
    ProjectID: parseInt(bmbyPid, 10),
    ClientID: parseInt(clientId, 10),
    Dynamic: 0, FromDate: from, ToDate: today,
  }

  // Verified live 2026-09-10: with ClientID set, BMBY returns the SAME rows on every page —
  // it advances LastUniqID but ignores it. Paging blindly produced each note 2-4 times.
  // Dedupe by task_id and stop as soon as a page adds nothing new.
  const all = []
  const seenTaskIds = new Set()
  let uniqID = 1
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const { rows, lastUniqID } = await callTasksGetAll({ ...base, UniqID: uniqID })
      if (!rows.length) break
      let added = 0
      for (const r of rows) {
        const tid = String(r.task_id || '')
        const key = tid || `${r.client_id}|${r.create_date}|${(r.message || '').slice(0, 40)}`
        if (seenTaskIds.has(key)) continue
        seenTaskIds.add(key)
        all.push(r)
        added++
      }
      if (!added) break
      if (!lastUniqID || lastUniqID <= uniqID) break
      uniqID = lastUniqID
    }
  } catch (e) {
    return Response.json({ error: 'BMBY: ' + (e.message || String(e)) }, { status: 502 })
  }

  // Did BMBY actually apply the ClientID filter? Surfaced so a silent API change is visible.
  const mine = all.filter(t => String(t.client_id || '') === clientId)
  const filterHonored = all.length === 0 || mine.length === all.length

  // decode THEN trim: BMBY sends &nbsp;, which is not whitespace until it is decoded.
  // Trimming first let notes whose whole body was &nbsp; through as blank rows.
  const _clean = (v) => decodeBmbyEntities((v || '').toString()).replace(/\u00a0/g, ' ').trim()
  const notes = mine
    .map(t => ({
      date: (t.create_date || t.start_date || '').toString(),
      type: _clean(t.type),
      subject: _clean(t.subject),
      status: _clean(t.status),
      user: _clean(t.user_name || t.agent_name),
      message: _clean(t.message),
    }))
    // Drop BMBY's automatic bookkeeping comment — it carries no human content and would
    // otherwise dominate the timeline. Same rule the response-time calc already applies.
    .filter(n => n.message && n.subject.toLowerCase() !== 'update info lead')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))

  return Response.json({
    ok: true,
    clientId,
    project: project.name,
    from, to: today,
    count: notes.length,
    scanned: all.length,
    filterHonored,
    notes,
  })
}
