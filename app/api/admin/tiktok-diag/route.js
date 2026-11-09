/**
 * GET /api/admin/tiktok-diag?days=30 — בדיקה חד-פעמית של מה ש-TikTok מחזיר (ויטלי, 9.11), לפני בניית הטאב.
 * אדמין או קרון (vitas-cron.yml → tiktok-diag). מחזיר רק אגרגטים ושמות קמפיינים / מודעות — בלי טוקן ובלי לידים.
 * לכל חשבון: אילו מדדים התקבלו (מנסה רשימה מלאה, ואם TikTok דוחה מדד — רשימה מצומצמת), סיכום, ו-3 שורות לדוגמה.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/auth'
import { tiktokGet, tiktokAdvertisers, TIKTOK_ACCOUNTS } from '../../../../lib/ads/tiktok-api.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d)

const FULL = ['campaign_name', 'adgroup_name', 'ad_name', 'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'conversion', 'cost_per_conversion', 'result', 'cost_per_result', 'real_time_conversion', 'form', 'onsite_form', 'video_play_actions', 'currency']
const SAFE = ['campaign_name', 'adgroup_name', 'ad_name', 'spend', 'impressions', 'clicks', 'conversion', 'result']

export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const token = String(process.env.TIKTOK_ACCESS_TOKEN || '').trim()
  const appId = String(process.env.TIKTOK_APP_ID || '').trim(), secret = String(process.env.TIKTOK_APP_SECRET || '').trim()
  if (!token) return J({ error: 'TIKTOK_ACCESS_TOKEN חסר ב-Vercel' }, 500)
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 30, 1), 30)
  const until = ymd(new Date()), since = ymd(new Date(Date.now() - (days - 1) * 864e5))
  let advertisers = []
  try { advertisers = await tiktokAdvertisers(token, { appId, secret }) } catch (e) { return J({ error: 'advertiser/get: ' + String(e.message || e) }, 502) }
  // רק החשבונות שמחוברים לפרויקט (TIKTOK_ACCOUNTS) — כרגע אלפא בלבד
  const wanted = new Set(TIKTOK_ACCOUNTS.map(a => a.advertiserId))
  const visible = advertisers.map(a => a.id)
  advertisers = advertisers.filter(a => wanted.has(a.id))
  const out = []
  for (const a of advertisers) {
    const res = { id: a.id, name: a.name }
    // פרטי החשבון: מטבע ואזור זמן
    try {
      const info = await tiktokGet('advertiser/info/', { advertiser_ids: [a.id], fields: ['currency', 'timezone', 'display_timezone', 'status'] }, token)
      const i = (info.list || [])[0] || {}; res.currency = i.currency; res.timezone = i.display_timezone || i.timezone; res.status = i.status
    } catch (e) { res.infoError = String(e.message || e).slice(0, 200) }
    for (const metrics of [FULL, SAFE]) {
      try {
        const d = await tiktokGet('report/integrated/get/', {
          advertiser_id: a.id, report_type: 'BASIC', data_level: 'AUCTION_AD', dimensions: ['ad_id', 'stat_time_day'],
          metrics, start_date: since, end_date: until, page_size: 1000,
        }, token)
        const rows = d.list || []
        const num = (r, k) => Number(r.metrics?.[k]) || 0
        res.metricsUsed = metrics === FULL ? 'full' : 'safe'
        res.rows = rows.length
        res.page = d.page_info || null
        res.totals = Object.fromEntries(['spend', 'impressions', 'clicks', 'conversion', 'result', 'onsite_form', 'form', 'real_time_conversion'].map(k => [k, Math.round(rows.reduce((s, r) => s + num(r, k), 0) * 100) / 100]))
        res.campaigns = [...new Set(rows.map(r => r.metrics?.campaign_name).filter(Boolean))].slice(0, 20)
        res.sample = rows.slice(0, 3)
        res.metricKeys = rows[0] ? Object.keys(rows[0].metrics || {}) : []
        break
      } catch (e) { res[metrics === FULL ? 'fullError' : 'safeError'] = String(e.message || e).slice(0, 300) }
    }
    out.push(res)
  }
  return J({ since, until, visibleToToken: visible.length, advertisers: out })
}
