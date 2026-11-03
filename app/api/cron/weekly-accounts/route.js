/**
 * /api/cron/weekly-accounts — סטטוס שבועי של כל חשבונות הפרסום (ויטלי, 3.11).
 *
 * ראשון בבוקר (GitHub Actions, .github/workflows/vitas-cron.yml): 7 הימים שהסתיימו אתמול מול 7 הימים
 * שלפניהם, לכל חשבון שהוציא כסף באחד מהם — גם לקוחות שאין להם פרויקט בדשבורד:
 *   מטא:  כל החשבונות שהטוקן של הדשבורד רואה (me/adaccounts), ועוד חשבונות עם טוקן משלהם.
 *   גוגל: כל החשבונות תחת ה-MCC (customer_client), ועוד חשבונות מוגדרים מחוץ לו.
 * מייל אחד לויטלי (lib/alert.js). בלי AI — מספרים ודגלים בלבד (lib/weekly-accounts.js).
 *
 * הרשאה: קרון (CRON_SECRET) או אדמין. ?dry=1 מחזיר את הנתונים בלי לשלוח מייל.
 */
import { NextResponse } from 'next/server'
import { adminClient, requireAdmin } from '../../../../lib/auth'
import { weekKeys } from '../../../../lib/ai-analysis.js'
import { META_GRAPH_VERSION, extractLeads, metaFetchAll, metaAccountIds, metaTokenFor, num } from '../../../../lib/ads/meta-api.js'
import { credsFor, getAccessToken, gaqlSearch, googleCustomerIds } from '../../../../lib/ads/google-api.js'
import { sumWeek, compareAccount, weeklyAccountsEmailHtml } from '../../../../lib/weekly-accounts.js'
import { periodLabel } from '../../../../lib/report-pdf.js'
import { sendAlert } from '../../../../lib/alert.js'
import { logJob } from '../../../../lib/job-log.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })
const G = `https://graph.facebook.com/${META_GRAPH_VERSION}`
async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

// ── מטא ──
async function metaAccounts() {
  const seen = new Map()
  const base = process.env.META_ACCESS_TOKEN
  if (base) {
    const rows = await metaFetchAll(`${G}/me/adaccounts?fields=account_id,name,account_status&limit=200`, base)
    for (const a of rows) seen.set(String(a.account_id), { id: String(a.account_id), name: a.name, status: a.account_status })
  }
  // חשבונות עם טוקן משלהם (META_ACCESS_TOKEN_<id>) שהטוקן הראשי לא רואה
  for (const id of metaAccountIds()) if (!seen.has(id)) seen.set(id, { id, name: null, status: null })
  return [...seen.values()]
}

async function metaWeeks(acc, cur, prev) {
  const token = metaTokenFor(acc.id)
  const ranges = encodeURIComponent(JSON.stringify([{ since: prev[0], until: prev[1] }, { since: cur[0], until: cur[1] }]))
  // רמת קמפיין: לכל קמפיין "התוצאה" שלו (extractLeads), כמו "תוצאות" במנהל המודעות
  const rows = await metaFetchAll(`${G}/act_${acc.id}/insights?level=campaign&fields=spend,clicks,impressions,actions&time_ranges=${ranges}&limit=500`, token)
  let name = acc.name
  if (!name) {
    const r = await fetch(`${G}/act_${acc.id}?fields=name,account_status&access_token=${encodeURIComponent(token)}`).then(x => x.json()).catch(() => ({}))
    name = r.name || acc.id; acc.status = r.account_status
  }
  const pick = (since) => sumWeek(rows.filter(r => r.date_start === since).map(r => ({ spend: num(r.spend), clicks: num(r.clicks), impressions: num(r.impressions), leads: extractLeads(r.actions) })))
  // account_status: 1 פעיל, 2 מושבת, 101 סגור (ושאר הערכים — בהמתנה/בבדיקה, נחשבים פעילים)
  const status = acc.status === 2 ? 'disabled' : acc.status === 101 ? 'closed' : 'active'
  return { name, cur: pick(cur[0]), prev: pick(prev[0]), status }
}

// ── גוגל ──
async function googleAccounts() {
  const out = new Map()
  const main = credsFor(null)
  if (main.loginCustomerId && main.refreshToken) {
    const at = await getAccessToken(main)
    const rows = await gaqlSearch(at, main.loginCustomerId,
      "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.status = 'ENABLED'",
      { login: main.loginCustomerId, developerToken: main.developerToken })
    for (const r of rows) {
      const c = r.customerClient || {}
      if (c.manager) continue
      out.set(String(c.id), { id: String(c.id), name: c.descriptiveName || String(c.id) })
    }
  }
  for (const id of googleCustomerIds()) if (!out.has(id)) out.set(id, { id, name: null })
  return [...out.values()]
}

async function googleWeeks(acc, cur, prev) {
  const c = credsFor(acc.id)
  const at = await getAccessToken(c)
  const rows = await gaqlSearch(at, acc.id,
    `SELECT customer.descriptive_name, segments.date, metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions FROM customer WHERE segments.date BETWEEN '${prev[0]}' AND '${cur[1]}'`,
    { login: c.loginCustomerId || undefined, developerToken: c.developerToken })
  const inW = (d, w) => d >= w[0] && d <= w[1]
  const toRow = (r) => ({ spend: num(r.metrics?.costMicros) / 1e6, leads: num(r.metrics?.conversions), clicks: num(r.metrics?.clicks), impressions: num(r.metrics?.impressions) })
  return {
    name: acc.name || rows[0]?.customer?.descriptiveName || acc.id,
    cur: sumWeek(rows.filter(r => inW(r.segments?.date, cur)).map(toRow)),
    prev: sumWeek(rows.filter(r => inW(r.segments?.date, prev)).map(toRow)),
    status: 'active',
  }
}

export async function GET(req) {
  const gate = await requireAdmin(req)   // קרון (CRON_SECRET) עובר כאן כ-internal
  if (!gate.ok) return gate.res
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const t0 = Date.now()
  const { key, prevKey } = weekKeys()
  const cur = key.split('_'), prev = prevKey.split('_')

  const errors = []
  const lists = await Promise.allSettled([metaAccounts(), googleAccounts()])
  const [metaList, googleList] = lists.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    errors.push({ platform: i ? 'google' : 'meta', name: 'רשימת החשבונות', error: r.reason?.message || String(r.reason) })
    return []
  })
  const jobs = [...metaList.map(a => ({ platform: 'meta', acc: a })), ...googleList.map(a => ({ platform: 'google', acc: a }))]
  const results = await pool(jobs, 6, async ({ platform, acc }) => {
    try {
      const w = platform === 'meta' ? await metaWeeks(acc, cur, prev) : await googleWeeks(acc, cur, prev)
      return { platform, id: acc.id, name: w.name, cmp: compareAccount(w) }
    } catch (e) {
      // חשבון סגור בלי הוצאה הוא לא תקלה — רק חשבון שאמור לעבוד
      if (platform === 'meta' && (acc.status === 101 || acc.status === 2)) return null
      errors.push({ platform, name: acc.name || acc.id, error: e.message || String(e) })
      return null
    }
  })
  const accounts = results.filter(a => a && (a.cmp.cur.spend > 0 || a.cmp.prev.spend > 0))

  const weekLabel = periodLabel(key), prevLabel = periodLabel(prevKey)
  let email = null
  if (!dry) {
    email = await sendAlert({
      subject: `סטטוס שבועי - ${accounts.length} חשבונות${accounts.some(a => a.cmp.flags.length) ? ` · ${accounts.filter(a => a.cmp.flags.length).length} דורשים תשומת לב` : ''}`,
      html: weeklyAccountsEmailHtml({ accounts, errors, weekLabel, prevLabel }),
    })
  }
  const out = { key, prevKey, accounts: accounts.length, flagged: accounts.filter(a => a.cmp.flags.length).length, errors, emailed: email ? !!email.ok : false }
  try { await logJob(adminClient(), 'weekly-accounts', !errors.length && (dry || !!email?.ok), Date.now() - t0, out) } catch { /* הרישום לא מפיל */ }
  return J(dry ? { ...out, detail: accounts.map(a => ({ platform: a.platform, name: a.name, cur: a.cmp.cur, prev: a.cmp.prev, flags: a.cmp.flags })) } : out)
}
