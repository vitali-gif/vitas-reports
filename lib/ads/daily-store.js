/**
 * lib/ads/daily-store.js — שמירה, כיסוי וסכימה של עובדות המודעות היומיות (טבלת ad_daily,
 * מיגרציה 007). שלב 2 של docs/daily-ranges-plan.md.
 *
 * שורה יומית (השדות בדיוק כמו בטבלה):
 *   { source, account, day, campaign_id, campaign, adset_id, adset, ad_id, ad, age, gender,
 *     ad_text, spend, impressions, reach, clicks, leads, campaign_status, adset_status, ad_status }
 */
import { createHash } from 'crypto'

export const IDENTITY_FIELDS = ['campaign_id', 'campaign', 'adset_id', 'adset', 'ad_id', 'ad', 'age', 'gender']

/** מפתח זהות של שורה בתוך (source, account, day): md5 של שדות הזהות. */
export function rowKey(r) {
  return createHash('md5').update(IDENTITY_FIELDS.map(k => String(r[k] ?? '')).join('')).digest('hex')
}

/** מנרמל שורה לצורת הטבלה: מחרוזות ריקות במקום undefined, מספרים אמיתיים. */
export function normalizeDailyRow(r) {
  const s = (v) => (v === undefined || v === null) ? '' : String(v)
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
  const out = {
    source: s(r.source), account: s(r.account), day: s(r.day).slice(0, 10),
    campaign_id: s(r.campaign_id), campaign: s(r.campaign), adset_id: s(r.adset_id), adset: s(r.adset),
    ad_id: s(r.ad_id), ad: s(r.ad), age: s(r.age), gender: s(r.gender), ad_text: s(r.ad_text),
    spend: n(r.spend), impressions: Math.round(n(r.impressions)), reach: Math.round(n(r.reach)), clicks: Math.round(n(r.clicks)), leads: n(r.leads),
    campaign_status: s(r.campaign_status), adset_status: s(r.adset_status), ad_status: s(r.ad_status),
  }
  out.row_key = rowKey(out)
  return out
}

/**
 * upsert של שורות יומיות. שורות עם אותו (source, account, day, row_key) בתוך המשיכה
 * מתמזגות (סכומים מתחברים) — Meta לא אמורה להחזיר כפילות, אבל אם כן, לא מאבדים כלום.
 */
export async function upsertDailyRows(sb, rows, { batch = 500 } = {}) {
  const merged = new Map()
  for (const raw of rows || []) {
    const r = normalizeDailyRow(raw)
    if (!r.source || !r.account || !r.day) continue
    const k = [r.source, r.account, r.day, r.row_key].join('|')
    const prev = merged.get(k)
    if (prev) { prev.spend += r.spend; prev.impressions += r.impressions; prev.reach += r.reach; prev.clicks += r.clicks; prev.leads += r.leads }
    else merged.set(k, r)
  }
  const fetchedAt = new Date().toISOString()
  const all = [...merged.values()].map(r => ({ ...r, fetched_at: fetchedAt }))
  for (let i = 0; i < all.length; i += batch) {
    const { error } = await sb.from('ad_daily').upsert(all.slice(i, i + batch), { onConflict: 'source,account,day,row_key' })
    if (error) throw new Error(`ad_daily upsert (batch ${i / batch}): ${error.message}`)
  }
  return { count: all.length }
}

/**
 * מוחק את שורות היום/החשבון לפני כתיבה מחדש — כדי שמודעה שנעלמה מהתשובה של Meta
 * (נמחקה, או שהמערכת תיקנה שיוך) לא תישאר כזומבי. נקרא לפני upsertDailyRows לאותו טווח.
 */
export async function deleteDailyRange(sb, source, account, since, until) {
  const { error } = await sb.from('ad_daily').delete()
    .eq('source', source).eq('account', account).gte('day', since).lte('day', until)
  if (error) throw new Error(`ad_daily delete ${source}/${account} ${since}..${until}: ${error.message}`)
}

/** כל הימים בטווח [since, until] שנרשמו כנמשכים בהצלחה עבור (source, account). */
export async function fetchedDays(sb, source, account, since, until) {
  const out = new Set()
  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await sb.from('ad_daily_fetch')
      .select('day').eq('source', source).eq('account', account)
      .gte('day', since).lte('day', until)
      .order('day', { ascending: true }).range(from, from + pageSize - 1)
    if (error) throw new Error(`ad_daily_fetch select ${source}/${account}: ${error.message}`)
    for (const r of data || []) out.add(String(r.day).slice(0, 10))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return out
}

/**
 * רישום שכל יום בטווח נמשך *במלואו*. נקרא רק אחרי משיכה שהושלמה — יום עם 0 שורות
 * נרשם גם הוא, וזה כל העניין: אחרת "אין הוצאה" ו"לא נמשך" נראים אותו דבר וה-backfill
 * מבקש את אותו טווח ריק שוב ושוב. ראו מיגרציה 021.
 */
export async function recordFetchedRange(sb, source, account, since, until, rows = [], { batch = 500 } = {}) {
  const perDay = new Map()
  for (const r of rows || []) {
    const d = String(r.day || '').slice(0, 10)
    if (d) perDay.set(d, (perDay.get(d) || 0) + 1)
  }
  const fetchedAt = new Date().toISOString()
  const all = []
  for (let d = since; d <= until; ) {
    all.push({ source, account, day: d, fetched_at: fetchedAt, rows: perDay.get(d) || 0 })
    const nx = new Date(d + 'T00:00:00Z')
    nx.setUTCDate(nx.getUTCDate() + 1)
    d = nx.toISOString().slice(0, 10)
  }
  for (let i = 0; i < all.length; i += batch) {
    const { error } = await sb.from('ad_daily_fetch').upsert(all.slice(i, i + batch), { onConflict: 'source,account,day' })
    if (error) throw new Error(`ad_daily_fetch upsert ${source}/${account} ${since}..${until}: ${error.message}`)
  }
  return { days: all.length }
}

/** כיסוי לכל (source, account): min/max יום, מספר ימים, מספר שורות. */
export async function coverage(sb) {
  const { data, error } = await sb.rpc('ad_daily_coverage')
  if (error) throw new Error('ad_daily_coverage: ' + error.message)
  return data || []
}

/**
 * שורות מסוכמות לטווח, לכל החשבונות, דרך ה-RPC ad_daily_aggregate. הניתוב לפרויקט
 * נעשה אצל הקורא (lib/ads/routing.js). מעמד עמודים של 1000 כי PostgREST מגביל.
 * מחזיר שורות בצורת הדוח: { account, campaign, adSet, adName, campaignId, adsetId, adId,
 *   adText, gender, age, spend, impressions, reach, clicks, leads, campaignStatus, adSetStatus, adStatus, days }
 */
export async function aggregateRange(sb, source, since, until, { pageSize = 1000 } = {}) {
  const out = []
  let from = 0
  for (;;) {
    const { data, error } = await sb.rpc('ad_daily_aggregate', { p_source: source, p_since: since, p_until: until }).range(from, from + pageSize - 1)
    if (error) throw new Error('ad_daily_aggregate: ' + error.message)
    for (const r of data || []) {
      out.push({
        account: r.account,
        campaign: r.campaign || '', adSet: r.adset || '', adName: r.ad || '',
        campaignId: r.campaign_id || '', adsetId: r.adset_id || '', adId: r.ad_id || '',
        adText: r.ad_text || '', gender: r.gender || '', age: r.age || '',
        spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, reach: Number(r.reach) || 0,
        clicks: Number(r.clicks) || 0, leads: Number(r.leads) || 0,
        campaignStatus: r.campaign_status || '', adSetStatus: r.adset_status || '', adStatus: r.ad_status || '',
        days: Number(r.days) || 0, lastDay: r.last_day || null,
      })
    }
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return out
}
