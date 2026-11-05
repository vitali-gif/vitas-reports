/**
 * /api/cron/ad-tags — מסווג מודעות פייסבוק חדשות לניתוח "מה עובד במודעות" (lib/ad-tags.js, מיגרציה 028).
 *
 * פעם ביום (GitHub Actions): לוקח את המודעות שהופיעו בדוחות הפייסבוק של החודש הזה ושל הקודם, מוריד את
 * אלה שכבר סווגו, ומסווג עד 40 חדשות (תמונה + טקסט). מודעה שאין עליה פרטים בדוח — התמונה והטקסט
 * נמשכים ממטא לפי המזהה. כל מודעה מסווגת פעם אחת בלבד (בערך 5 אגורות).
 *
 * הרשאה: קרון (CRON_SECRET) או אדמין. ?limit=N (עד 100), ?dry=1 מחזיר את הרשימה בלי לסווג.
 */
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminClient, requireAdmin } from '../../../../lib/auth'
import { tagCreative, fetchImage } from '../../../../lib/ad-tags.js'
import { META_GRAPH_VERSION, metaTokenFor } from '../../../../lib/ads/meta-api.js'
import { logJob } from '../../../../lib/job-log.js'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

const J = (b, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } })
const ym = (d) => d.toISOString().slice(0, 7)

async function pool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

// פרטי הקריאייטיב ממטא, למודעה שלא מופיעה ב-activeAds של הדוח
async function metaCreative(adId, account) {
  const token = metaTokenFor(account || '')
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${adId}?fields=name,creative{title,body,image_url,thumbnail_url,video_id}&access_token=${encodeURIComponent(token)}`
  const r = await fetch(url).then(x => x.json()).catch(() => ({}))
  if (r.error) throw new Error('Meta: ' + String(r.error.message || r.error.type || 'error').slice(0, 160))
  const c = r.creative || {}
  return { name: r.name || '', title: c.title || '', body: c.body || '', imageUrl: c.image_url || c.thumbnail_url || '', isVideo: !!c.video_id }
}

export async function GET(req) {
  const gate = await requireAdmin(req)
  if (!gate.ok) return gate.res
  const url = new URL(req.url)
  const dry = url.searchParams.get('dry') === '1'
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 40))
  const t0 = Date.now()
  const sb = adminClient()

  if (!process.env.ANTHROPIC_API_KEY && !dry) return J({ error: 'ANTHROPIC_API_KEY לא מוגדר' }, 500)

  // המודעות של החודש הזה ושל הקודם
  const now = new Date(), prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15))
  const { data: reps, error } = await sb.from('reports').select('month, data, summary').eq('source', 'facebook').in('month', [ym(now), ym(prev)])
  if (error) return J({ error: error.message }, 500)
  const ads = new Map()
  for (const r of reps || []) {
    for (const a of r.summary?.activeAds || []) {
      const id = String(a.id || ''); if (!id) continue
      ads.set(id, { adId: id, account: String(a.account || ''), name: a.name || '', title: a.title || '', body: a.body || '', imageUrl: a.imageUrl || a.thumbnailUrl || '', isVideo: !!(a.videoId || a.videoUrl), full: true })
    }
    for (const d of Array.isArray(r.data) ? r.data : []) {
      const id = String(d.adId || ''); if (!id || ads.has(id) || !(Number(d.spend) > 0)) continue
      ads.set(id, { adId: id, account: '', name: d.adName || '', full: false })
    }
  }
  const ids = [...ads.keys()]
  const done = new Set()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('ad_creative_tags').select('ad_id, image_url, ad_name').in('ad_id', ids.slice(i, i + 200))
    // סיווג בלי תמונה ובלי שם (ריצה ראשונה, 5.11 — הקלט הגיע ריק) לא נחשב: מסווגים שוב ודורסים
    for (const x of data || []) if (x.image_url || x.ad_name) done.add(x.ad_id)
  }
  const todo = ids.filter(id => !done.has(id)).slice(0, limit).map(id => ads.get(id))
  // מודעה שמופיעה רק במספרים (בלי activeAds): החשבון שלה מ-ad_daily, כדי לפנות למטא עם הטוקן הנכון
  const noAcc = todo.filter(a => !a.account).map(a => a.adId)
  if (noAcc.length) {
    const { data: accs } = await sb.from('ad_daily').select('ad_id, account, ad').eq('source', 'facebook').in('ad_id', noAcc).limit(2000)
    for (const r of accs || []) { const a = ads.get(String(r.ad_id)); if (a && !a.account) { a.account = String(r.account || ''); if (!a.name && r.ad) a.name = r.ad } }
  }
  if (dry) return J({ ads: ids.length, tagged: done.size, todo: todo.length })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY.trim() })
  const errors = []
  let ok = 0
  await pool(todo, 4, async (a) => {
    try {
      // רק שדות שבאמת חזרו ממטא — תשובה ריקה לא מוחקת את מה שכבר ידוע (שם המודעה מהדוח)
      const c = a.full ? a : { ...a, ...Object.fromEntries(Object.entries(await metaCreative(a.adId, a.account)).filter(([, v]) => v)) }
      const image = await fetchImage(c.imageUrl)
      if (!image && !c.title && !c.body) throw new Error('no image and no text for this ad (Meta returned nothing) - not tagged')
      const { tags, model } = await tagCreative(anthropic, { image, title: c.title, body: c.body, adName: c.name })
      const { error: upErr } = await sb.from('ad_creative_tags').upsert({
        ad_id: a.adId, account: c.account || '', ad_name: c.name || null, image_url: c.imageUrl || null,
        is_video: !!c.isVideo, tags: { ...tags, ...(image ? {} : { fromTextOnly: true }) }, model, tagged_at: new Date().toISOString(),
      })
      if (upErr) throw new Error(upErr.message)
      ok++
    } catch (e) {
      errors.push({ adId: a.adId, error: String(e?.message || e).slice(0, 200) })
    }
  })
  const out = { ads: ids.length, alreadyTagged: done.size, tagged: ok, errors: errors.slice(0, 10), left: Math.max(0, ids.length - done.size - todo.length) }
  try { await logJob(sb, 'ad-tags', errors.length < todo.length || !todo.length, Date.now() - t0, out) } catch { /* הרישום לא מפיל */ }
  return J(out)
}
