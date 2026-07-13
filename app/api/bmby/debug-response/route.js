// API route: /api/bmby/debug-response
//   GET /api/bmby/debug-response?key=<ANON_KEY>&project=HI%20PARK&days=30
//
// For each LID in the window, finds the first non-LID task and returns:
//   - delta minutes
//   - user_id, type, subject, message of the first task
// Filters to show fastest responses (< 1 min) so we can check if they're bots.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BMBY_BASE = 'https://www.bmby.com/WebServices/srv/v3'
const ENDPOINTS = {
  clients: { file: '', ns: 'clients.php' },
  tasks:   { file: 'tasks.php', ns: 'tasks.php' },
}

function xmlEscape(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

function buildSoap(service, params) {
  const ns = ENDPOINTS[service].ns
  const nsUrl = `https://www.bmby.com/WebServices/srv/v3/${ns}`
  const ks = ['Login','Password','ProjectID','UniqID','Dynamic','FromDate','ToDate']
  const types = { Login:'xsd:string', Password:'xsd:string', ProjectID:'xsd:int', UniqID:'xsd:int', Dynamic:'xsd:int', FromDate:'xsd:string', ToDate:'xsd:string' }
  const xml = ks.map(k => {
    const v = params[k]
    return `<${k} xsi:type="${types[k]}">${v !== undefined && v !== null ? xmlEscape(v) : ''}</${k}>`
  }).join('\n      ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:svc="${nsUrl}">
<soapenv:Header/><soapenv:Body><svc:GetAllJson><Parameters>
${xml}
</Parameters></svc:GetAllJson></soapenv:Body></soapenv:Envelope>`
}

async function call(service, params) {
  const url = ENDPOINTS[service].file ? `${BMBY_BASE}/${ENDPOINTS[service].file}` : `${BMBY_BASE}/`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '"GetAllJson"' },
    body: buildSoap(service, params),
  })
  const text = await res.text()
  const m = text.match(/<GetAllJsonReturn[^>]*>([\s\S]*?)<\/GetAllJsonReturn>/)
  if (!m) return { rows: [], lastUniqID: 0, foundRows: 0 }
  const jsonStr = m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')
  const parsed = JSON.parse(jsonStr)
  const rows = []
  const data = parsed.Data || ''
  let rm
  const rowRegex = /<row>([\s\S]*?)<\/row>/g
  while ((rm = rowRegex.exec(data)) !== null) {
    const obj = {}
    const fieldRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
    let fm
    while ((fm = fieldRegex.exec(rm[1])) !== null) {
      let v = fm[2]
      const cd = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
      if (cd) v = cd[1]
      obj[fm[1]] = v
    }
    rows.push(obj)
  }
  return { rows, lastUniqID: parsed.LastUniqID || 0, foundRows: parsed.FoundRows || 0 }
}

async function callPaginated(service, baseParams, maxPages = 6) {
  const all = []
  let uniq = 1, dyn = 1
  for (let i = 0; i < maxPages; i++) {
    const r = await call(service, { ...baseParams, UniqID: uniq, Dynamic: dyn })
    all.push(...r.rows)
    if (r.rows.length < 3000) break
    uniq = r.lastUniqID
    dyn = 0
  }
  return all
}

export async function GET(req) {
  const url = new URL(req.url)
  // Restricted to CRON_SECRET only — anon key is public so allowing it
  // would expose raw BMBY data (names, phones) to anyone.
  const key = url.searchParams.get('secret') || ''
  const cronSecret = process.env.CRON_SECRET || ''
  if (!cronSecret || key !== cronSecret) {
    return Response.json({ error: 'unauthorized — pass ?secret=<CRON_SECRET>' }, { status: 401 })
  }

  let projectMap = {}
  try { projectMap = JSON.parse(process.env.BMBY_PROJECT_IDS || '{}') } catch {}
  const projectName = url.searchParams.get('project') || Object.keys(projectMap)[0] || ''
  const bmbyPid = projectMap[projectName]
  if (!bmbyPid) return Response.json({ error: 'unknown project' }, { status: 400 })

  const days = parseInt(url.searchParams.get('days') || '30', 10)
  const maxSeconds = parseInt(url.searchParams.get('maxSec') || '60', 10) // threshold for "fast"
  const from = new Date(Date.now() - days * 86400 * 1000)
  const to = new Date()
  const FromDate = from.toISOString().slice(0, 10)
  const ToDate = to.toISOString().slice(0, 10)

  const params = {
    Login: process.env.BMBY_LOGIN || '',
    Password: process.env.BMBY_PASSWORD || '',
    ProjectID: bmbyPid,
    FromDate, ToDate,
  }

  const [clients, tasks] = await Promise.all([
    callPaginated('clients', params, 4),
    callPaginated('tasks', params, 10),
  ])

  const userIdToName = new Map()
  for (const c of clients) {
    const uid = String(c.user_id || '')
    const uname = (c.user_name || '').toString().trim()
    if (uid && uname && !userIdToName.has(uid)) userIdToName.set(uid, uname)
  }

  const tasksByClient = new Map()
  for (const t of tasks) {
    const cid = String(t.client_id || '')
    if (!cid) continue
    if (!tasksByClient.has(cid)) tasksByClient.set(cid, [])
    tasksByClient.get(cid).push(t)
  }

  const parseTs = (s) => new Date(String(s || '').replace(' ', 'T')).getTime()
  const inRange = (d) => {
    if (!d) return false
    const ymd = String(d).slice(0, 10)
    return ymd >= FromDate && ymd <= ToDate
  }

  const lids = tasks.filter(t =>
    (t.type || '').toString().toLowerCase() === 'lid' &&
    inRange(t.start_date || t.create_date)
  )

  // For each LID, find first non-LID followup, compute delta
  const fastEntries = []
  const allEntries = []
  for (const lid of lids) {
    const cid = String(lid.client_id || '')
    if (!cid) continue
    const lidMs = parseTs(lid.create_date || lid.start_date)
    if (isNaN(lidMs)) continue
    const followups = (tasksByClient.get(cid) || [])
      .filter(t => (t.type || '').toString().toLowerCase() !== 'lid')
      .filter(t => {
        const ms = parseTs(t.create_date || t.start_date)
        return !isNaN(ms) && ms >= lidMs
      })
      .sort((a, b) => parseTs(a.create_date || a.start_date) - parseTs(b.create_date || b.start_date))
    if (followups.length === 0) continue
    const first = followups[0]
    const firstMs = parseTs(first.create_date || first.start_date)
    const deltaSec = Math.round((firstMs - lidMs) / 1000)
    const userId = String(first.user_id || first.create_user_id || '')
    const entry = {
      deltaSec,
      lidDate: lid.create_date || lid.start_date,
      firstDate: first.create_date || first.start_date,
      firstType: first.type,
      firstSubject: (first.subject || '').slice(0, 80),
      firstMessage: (first.message || '').slice(0, 200),
      firstUserId: userId,
      firstUserName: userIdToName.get(userId) || '(unknown)',
      lidSource: lid.media_title || '',
    }
    allEntries.push(entry)
    if (deltaSec <= maxSeconds) fastEntries.push(entry)
  }

  // Aggregate analysis of the fast entries
  const userCounts = {}
  const typeCounts = {}
  const subjectCounts = {}
  const messageCounts = {}
  for (const e of fastEntries) {
    userCounts[e.firstUserName + ' (id:' + e.firstUserId + ')'] = (userCounts[e.firstUserName + ' (id:' + e.firstUserId + ')'] || 0) + 1
    typeCounts[e.firstType] = (typeCounts[e.firstType] || 0) + 1
    const subj = e.firstSubject || '(empty)'
    subjectCounts[subj] = (subjectCounts[subj] || 0) + 1
    const msg = (e.firstMessage || '(empty)').slice(0, 60)
    messageCounts[msg] = (messageCounts[msg] || 0) + 1
  }

  return Response.json({
    project: projectName,
    window: { from: FromDate, to: ToDate, days },
    maxSeconds,
    totalLidsAnalyzed: lids.length,
    lidsWithFollowup: allEntries.length,
    fastResponseCount: fastEntries.length,
    fastResponseRatio: allEntries.length > 0 ? (fastEntries.length / allEntries.length * 100).toFixed(1) + '%' : '0%',
    // Aggregated breakdowns — these are the diagnostics
    fastResponseUsers: Object.entries(userCounts).sort((a,b) => b[1] - a[1]),
    fastResponseTypes: typeCounts,
    fastResponseTopSubjects: Object.entries(subjectCounts).sort((a,b) => b[1] - a[1]).slice(0, 10),
    fastResponseTopMessages: Object.entries(messageCounts).sort((a,b) => b[1] - a[1]).slice(0, 10),
    sampleEntries: fastEntries.slice(0, 8),  // first 8 raw entries for inspection
  })
}
