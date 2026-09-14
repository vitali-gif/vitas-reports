/**
 * /api/demo — ניהול פרויקט הדמו
 * ─────────────────────────────────────────────────────────────────────────────
 * GET                        → מצב הדמו (פרויקט, תקופות שנכתבו, גיל ה-seed)
 * POST { action: 'seed' }    → כותב את DEMO_DATASET ל-DB תחת מפתחות התקופה של היום
 * POST { action: 'unseed' }  → מוחק את דוחות הדמו (הפרויקט נשאר)
 *
 * ═══ למה זה לא "פשוט לצרוב 3 שורות" ═══
 * מפתחות התקופה בדשבורד מחושבים מהתאריך של היום (`presetToPayload`,
 * app/admin/page.js): 'currentMonth' → 'YYYY-MM', 'q2' → 'YYYY-04-01_YYYY-06-30'.
 * שורות שנצרבו ביולי 2026 יהפכו לבלתי-נגישות ב-1 באוגוסט, והדמו יציג
 * "אין נתונים לטווח התאריכים שנבחר" בדיוק ברגע הלא נכון.
 *
 * לכן ה-seeder:
 *   1. מחשב את מפתחות התקופה של **היום** באותה נוסחה בדיוק כמו הדשבורד
 *   2. מזיז את כל התאריכים **בתוך** הנתונים באותו מספר חודשים
 *   3. משאיר את כל המספרים ללא שינוי — "הנתונים קבועים" מתקיים במלואו
 *
 * ההרצה אידמפוטנטית: אפשר להריץ שוב ושוב, התוצאה זהה.
 * להרצה חודשית אוטומטית ראה scripts/demo/README.md.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DEMO_DATASET } from '../../../lib/demo-dataset'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

// ═══════════════════════════════════════════════════════════════════════════
// עזרי תאריך — חייבים לשקף את presetToPayload ב-app/admin/page.js
// ═══════════════════════════════════════════════════════════════════════════

const pad = (n) => String(n).padStart(2, '0')

/** "עכשיו" לפי שעון ישראל — כמו בכל ה-crons, כדי שלא נחליף חודש בטעות. */
function nowIsrael() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number)
  return { year: y, month: m, day: d }
}

/**
 * מפתחות התקופה של היום.
 * ⚠️ אם `presetToPayload` בדשבורד משתנה — יש לעדכן גם כאן, אחרת ה-seed
 *    ייכתב תחת מפתחות שהדשבורד לא מחפש והדמו ייראה ריק.
 */
function todayPeriodKeys() {
  const { year, month } = nowIsrael()
  const py = month === 1 ? year - 1 : year
  const pm = month === 1 ? 12 : month - 1
  return {
    current:  `${year}-${pad(month)}`,
    previous: `${py}-${pad(pm)}`,
    q2:       `${year}-04-01_${year}-06-30`,
  }
}

/**
 * הזזת התאריכים היא **לכל תקופה בנפרד** — וזו הנקודה העדינה ביותר בקובץ.
 *
 * `current` ו-`previous` זזים חודש-בחודש יחד עם היום.
 * `q2` **לא** — הוא נשאר אפריל–יוני וזז רק פעם בשנה. הזזה גלובלית אחת
 * הייתה דוחפת את תאריכי Q2 אל תוך יולי כבר באוגוסט, בעוד המפתח עדיין
 * אומר "אפריל–יוני" (הבדיקה ב-test-seed-shift.mjs תפסה בדיוק את זה).
 */
function periodOffsets(baseMonthKey) {
  const [by, bm] = baseMonthKey.split('-').map(Number)
  const { year, month } = nowIsrael()
  return {
    current:  (year - by) * 12 + (month - bm),
    previous: (year - by) * 12 + (month - bm),
    q2:       (year - by) * 12,   // שנים שלמות בלבד — אפריל נשאר אפריל
  }
}

/**
 * מיפוי יום-בחודש של התקופה הנוכחית אל הטווח [1 .. היום].
 * בלי זה, seed שרץ ב-3 בחודש היה מציג "פגישות שבוצעו" בתאריכים עתידיים.
 * משנה תאריכים בלבד — אף מספר לא זז.
 */
function remapCurrentDay(str, spanDays) {
  const { day } = nowIsrael()
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})([ T].*)?$/)
  if (!m) return str
  const [, y, mo, d, tail] = m
  const srcDay = Number(d)
  const mapped = Math.max(1, Math.min(day, Math.round((srcDay * day) / Math.max(1, spanDays))))
  return `${y}-${mo}-${pad(mapped)}${tail || ''}`
}

/** מזיז מחרוזת תאריך ב-N חודשים ושומר על הפורמט המקורי (עם/בלי שעה). */
function shiftDateString(str, months) {
  if (!str || months === 0) return str
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})([ T].*)?$/)
  if (!m) return str
  const [, y, mo, d, tail] = m
  const targetDay = Number(d)
  const dt = new Date(Number(y), Number(mo) - 1, 1)
  dt.setMonth(dt.getMonth() + months)
  // אם היום לא קיים בחודש היעד (31 בחודש בן 30) — נצמדים לסוף החודש
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()
  dt.setDate(Math.min(targetDay, lastDay))
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}${tail || ''}`
}

/**
 * מזיז רקורסיבית כל תאריך במבנה. עובר רק על שדות שידוע שהם תאריכים —
 * כדי לא לגעת בטעות במחרוזת אחרת שנראית כמו תאריך.
 */
const DATE_FIELDS = new Set(['date', 'lastMeeting', 'created_at', 'meetingDate', 'scheduledAt'])

function shiftDates(node, months, post) {
  if (node == null) return node
  if (Array.isArray(node)) return node.map(v => shiftDates(v, months, post))
  if (typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (DATE_FIELDS.has(k) && typeof v === 'string' && v) {
        let s = shiftDateString(v, months)
        if (post) s = post(s)
        out[k] = s
      } else {
        out[k] = shiftDates(v, months, post)
      }
    }
    return out
  }
  return node
}

// ═══════════════════════════════════════════════════════════════════════════
// אימות
// ═══════════════════════════════════════════════════════════════════════════

/**
 * seed/unseed כותבים ל-DB ולכן דורשים CRON_SECRET, כמו שאר הפעולות
 * הכותבות במערכת. GET מסתפק ב-anon key.
 */
function checkWriteAuth(req) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET
}

function checkReadAuth(req) {
  return req.headers.get('x-client-key') === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

// ═══════════════════════════════════════════════════════════════════════════
// GET — מצב
// ═══════════════════════════════════════════════════════════════════════════

export async function GET(req) {
  if (!checkReadAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('id, name, is_demo, monthly_budgets, clients(name, color)')
    .eq('is_demo', true)
    .maybeSingle()

  const keys = todayPeriodKeys()

  if (!project) {
    return NextResponse.json({ seeded: false, project: null, expectedKeys: keys })
  }

  const { data: reports } = await supabaseAdmin
    .from('reports')
    .select('source, month, created_at, summary')
    .eq('project_id', project.id)

  const present = new Set((reports || []).map(r => `${r.month}|${r.source}`))
  const missing = []
  for (const key of Object.values(keys)) {
    for (const src of ['crm', 'facebook', 'google']) {
      if (!present.has(`${key}|${src}`)) missing.push(`${key}/${src}`)
    }
  }

  return NextResponse.json({
    seeded: missing.length === 0,
    project: { id: project.id, name: project.name, client: project.clients?.name },
    expectedKeys: keys,
    reportCount: (reports || []).length,
    missing,
    lastSeededAt: (reports || []).map(r => r.summary?._seededAt).filter(Boolean).sort().pop()
      || (reports || []).map(r => r.created_at).sort().pop() || null,
    datasetBaseMonth: DEMO_DATASET.meta.baseMonth,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// POST — seed / unseed
// ═══════════════════════════════════════════════════════════════════════════

export async function POST(req) {
  if (!checkWriteAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized — requires CRON_SECRET bearer token' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const action = body.action

  if (action === 'unseed') return unseed()
  if (action !== 'seed') {
    return NextResponse.json({ error: "unknown action — use 'seed' or 'unseed'" }, { status: 400 })
  }

  const meta = DEMO_DATASET.meta

  // ── 1. לקוח הדמו ──────────────────────────────────────────────────────
  let clientId
  {
    const { data: existing } = await supabaseAdmin
      .from('clients').select('id').eq('name', meta.client).maybeSingle()
    if (existing) {
      clientId = existing.id
    } else {
      const { data: created, error } = await supabaseAdmin
        .from('clients').insert({ name: meta.client, color: meta.color })
        .select('id').single()
      if (error) return NextResponse.json({ error: 'client insert: ' + error.message }, { status: 500 })
      clientId = created.id
    }
  }

  // ── 2. פרויקט הדמו ────────────────────────────────────────────────────
  // מזוהה לפי is_demo ולא לפי שם — כדי שאפשר יהיה לשנות את שם הדמו בלי
  // ליצור בטעות פרויקט דמו שני.
  let projectId
  {
    const { data: existing } = await supabaseAdmin
      .from('projects').select('id, name').eq('is_demo', true).maybeSingle()
    if (existing) {
      projectId = existing.id
      if (existing.name !== meta.project) {
        await supabaseAdmin.from('projects').update({ name: meta.project }).eq('id', projectId)
      }
    } else {
      const { data: created, error } = await supabaseAdmin
        .from('projects')
        .insert({ client_id: clientId, name: meta.project, is_demo: true })
        .select('id').single()
      if (error) return NextResponse.json({ error: 'project insert: ' + error.message }, { status: 500 })
      projectId = created.id
    }
  }

  const todayKeys = todayPeriodKeys()

  // ── 3. תקציב חודשי (פס התקציב בדשבורד) ────────────────────────────────
  if (meta.monthlyBudget) {
    const budgets = {
      [todayKeys.current]:  meta.monthlyBudget,
      [todayKeys.previous]: meta.monthlyBudget,
    }
    await supabaseAdmin.from('projects').update({ monthly_budgets: budgets }).eq('id', projectId)
  }

  // ── 4. מיפוי מפתחות הדאטהסט → מפתחות התקופה של היום ───────────────────
  const keys = meta.periodKeys
  const keyMap = {
    [keys.current]:  { month: todayKeys.current,  period: 'current'  },
    [keys.previous]: { month: todayKeys.previous, period: 'previous' },
    [keys.q2]:       { month: todayKeys.q2,       period: 'q2'       },
  }
  const offsets = periodOffsets(meta.baseMonth)

  // ── 5. ניקוי דוחות ישנים (מפתחות של חודשים קודמים) ────────────────────
  // בלי זה `reports` של הדמו תצבור שורה חדשה בכל חודש — בדיוק בעיית
  // ההצטברות שכבר תועדה בפרויקטים האמיתיים.
  const keepKeys = Object.values(todayKeys)
  const { data: existingReports } = await supabaseAdmin
    .from('reports').select('id, month').eq('project_id', projectId)
  const stale = (existingReports || []).filter(r => !keepKeys.includes(r.month)).map(r => r.id)
  let pruned = 0
  if (stale.length) {
    const { error } = await supabaseAdmin.from('reports').delete().in('id', stale)
    if (!error) pruned = stale.length
  }

  // ── 6. כתיבת 9 הדוחות ─────────────────────────────────────────────────
  const written = []
  const errors = []
  for (const report of DEMO_DATASET.reports) {
    const target = keyMap[report.month]
    if (!target) { errors.push(`no key mapping for ${report.month}`); continue }
    const targetMonth = target.month
    const offset = offsets[target.period]
    const post = target.period === 'current'
      ? (s) => remapCurrentDay(s, meta.currentSpanDays || 26)
      : null

    const row = {
      project_id: projectId,
      source: report.source,
      month: targetMonth,
      data: shiftDates(report.data, offset, post),
      // _seededAt: חותמת זמן אמיתית. אי אפשר להסתמך על created_at — upsert
      // לא מעדכן אותו, כך ש-GET היה מדווח על ה-seed הראשון לנצח ונראה כאילו
      // הזריעה לא רצה.
      summary: { ...shiftDates(report.summary, offset, post), _seededAt: new Date().toISOString() },
      file_name: report.file_name,
      row_count: report.row_count,
    }

    const { error } = await supabaseAdmin
      .from('reports').upsert(row, { onConflict: 'project_id,source,month' })
    if (error) errors.push(`${targetMonth}/${report.source}: ${error.message}`)
    else written.push(`${targetMonth}/${report.source}`)
  }

  return NextResponse.json({
    ok: errors.length === 0,
    projectId,
    clientId,
    offsets,
    periodKeys: todayKeys,
    written,
    pruned,
    errors,
  }, { status: errors.length ? 500 : 200 })
}

async function unseed() {
  const { data: project } = await supabaseAdmin
    .from('projects').select('id').eq('is_demo', true).maybeSingle()
  if (!project) return NextResponse.json({ ok: true, deleted: 0, note: 'no demo project' })

  const { error, count } = await supabaseAdmin
    .from('reports').delete({ count: 'exact' }).eq('project_id', project.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, deleted: count ?? 0, projectId: project.id })
}
