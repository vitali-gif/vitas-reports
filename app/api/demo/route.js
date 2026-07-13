/**
 * /api/demo — setup and manage the demo project
 * GET  → return demo project info
 * POST { action: 'setup' } → clone HI PARK data → demo project (anonymized)
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '../../../lib/auth'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const HIPARK_PROJECT_ID = 'c2251f06-197b-43f0-b91c-4947f2e8760c'
const DEMO_PROJECT_NAME = 'מטרופוליס'
const DEMO_CLIENT_NAME  = 'קבוצת אורבן'
const DEMO_CLIENT_COLOR = '#6366F1'

// Hebrew fake names pool
const FIRST = ['אורן','מיכל','ירון','ענת','גלעד','נועה','אמיר','שירה','רן','דנה','יובל','תמר','איתי','מאיה','עידן','ליאת','אסף','רוני','בן','הילה','ניר','עינב','אור','קרן','אלון','ריטה','גיא','ורד','שחר','נוי']
const LAST  = ['כהן','לוי','מזרחי','פרץ','ביטון','אברהם','דיין','אוחיון','שמש','גרוס','הלוי','גולן','כץ','פרידמן','רוזן','בן דוד','שפירא','עמר','ניסים','אלמוג']
function fakeName(seed) {
  const h = [...seed].reduce((a,c) => (a * 31 + c.charCodeAt(0)) | 0, 0)
  return FIRST[Math.abs(h) % FIRST.length] + ' ' + LAST[Math.abs(h >> 4) % LAST.length]
}

function anonymize(report, demoProjectId) {
  const r = { ...report, project_id: demoProjectId, id: undefined }
  delete r.id

  // Anonymize summary
  if (r.summary) {
    const s = JSON.parse(JSON.stringify(r.summary))
    // Named leads
    if (s.namedLeads) {
      for (const k of Object.keys(s.namedLeads)) {
        const arr = s.namedLeads[k]
        if (Array.isArray(arr)) s.namedLeads[k] = arr.map(n => fakeName(String(n)))
      }
    }
    // Sources — keep structure but rename
    if (s.sources) {
      const ns = {}
      for (const [k, v] of Object.entries(s.sources)) {
        const kl = k.toLowerCase()
        const newKey = kl.includes('facebook') || kl.includes('פייסבוק') ? 'פייסבוק'
          : kl.includes('google') || kl.includes('גוגל') ? 'גוגל'
          : kl.includes('yad2') || kl.includes('יד2') ? 'פורטל א׳'
          : kl.includes('מדלן') ? 'פורטל ב׳'
          : k
        ns[newKey] = v
      }
      s.sources = ns
    }
    // crmRepRows — anonymize addresses
    if (Array.isArray(s.crmRepRows)) {
      s.crmRepRows = s.crmRepRows.map(row => ({
        ...row,
        address: row.address ? 'רחוב הדוגמה ' + Math.abs(fakeName(row.address).charCodeAt(0) % 50 + 1) : '',
      }))
    }
    r.summary = s
  }

  // Anonymize rows — replace project name in campaign names
  if (Array.isArray(r.rows)) {
    r.rows = r.rows.map(row => {
      const ro = { ...row }
      for (const f of ['campaign', 'campaign_name', 'ad_name', 'adset_name', 'name']) {
        if (ro[f]) {
          ro[f] = ro[f]
            .replace(/hi\s*park/gi, DEMO_PROJECT_NAME)
            .replace(/once/gi, DEMO_PROJECT_NAME)
            .replace(/rehavia/gi, DEMO_PROJECT_NAME)
            .replace(/ש\.ברוך/g, DEMO_CLIENT_NAME)
        }
      }
      // Blur image URLs — replace with placeholder
      if (ro.imageUrl) ro.imageUrl = '/brand/vitas-logo-black.png'
      if (ro.thumbnailUrl) ro.thumbnailUrl = '/brand/vitas-logo-black.png'
      return ro
    })
  }

  return r
}



export async function GET(req) {
  const auth = await requireAuth(req, { adminOnly: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { data } = await supabaseAdmin
    .from('projects')
    .select('*, clients(name, color)')
    .eq('is_demo', true)
    .single()
  return NextResponse.json(data || null)
}

export async function POST(req) {
  const auth = await requireAuth(req, { adminOnly: true })
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await req.json().catch(() => ({}))

  if (body.action !== 'setup') return NextResponse.json({ error: 'unknown action' }, { status: 400 })

  // 1. Ensure demo client exists
  let clientId
  const { data: existing } = await supabaseAdmin.from('clients').select('id').eq('name', DEMO_CLIENT_NAME).single()
  if (existing) {
    clientId = existing.id
  } else {
    const { data: nc } = await supabaseAdmin.from('clients')
      .insert({ name: DEMO_CLIENT_NAME, color: DEMO_CLIENT_COLOR })
      .select('id').single()
    clientId = nc.id
  }

  // 2. Ensure demo project exists
  let demoProjectId
  const { data: existingP } = await supabaseAdmin.from('projects').select('id').eq('is_demo', true).single()
  if (existingP) {
    demoProjectId = existingP.id
  } else {
    const { data: np } = await supabaseAdmin.from('projects')
      .insert({ client_id: clientId, name: DEMO_PROJECT_NAME, is_demo: true })
      .select('id').single()
    demoProjectId = np.id
  }

  // 3. Copy HI PARK reports → anonymized → demo project
  const { data: reports } = await supabaseAdmin
    .from('reports')
    .select('*')
    .eq('project_id', HIPARK_PROJECT_ID)
    .order('month', { ascending: false })
    .limit(30) // last 10 months × 3 sources

  const anonymized = (reports || []).map(r => anonymize(r, demoProjectId))

  // Upsert in batches
  let copied = 0
  for (const r of anonymized) {
    const { error } = await supabaseAdmin.from('reports').upsert(r, {
      onConflict: 'project_id,source,month'
    })
    if (!error) copied++
  }

  return NextResponse.json({ ok: true, demoProjectId, copied, total: anonymized.length })
}
