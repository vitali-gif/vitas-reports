/**
 * /api/cron/ad-tags — מסווג מודעות פייסבוק חדשות לניתוח "מה עובד במודעות" (lib/ad-tags.js, מיגרציה 028).
 *
 * פעם ביום (GitHub Actions): לוקח את המודעות שהופיעו בדוחות הפייסבוק של החודש הזה ושל הקודם, מוריד את
 * אלה שכבר סווגו, ומסווג עד 40 חדשות (תמונה + טקסט). מודעה שאין עליה פרטים בדוח — התמונה והטקסט
 * נמשכים ממטא לפי המזהה. כל מודעה מסווגת פעם אחת בלבד (בערך 5 אגורות).
 *
 * הרשאה: קרון (CRON_SECRET) או אדמין. ?limit=N (עד 100), ?dry=1 מחזיר את הרשימה בלי לסווג.
 * ?months=N (עד 13) — כמה חודשים אחורה לקחת מודעות (ברירת מחדל 2). 12 = מילוי לניתוח שנתי (ויטלי, 6.11).
 * ?minSpend=₪ — רק מודעות שהוציאו לפחות הסכום הזה בכל החודשים יחד. במילוי (months > 2) ברירת המחדל ₪500:
 *   1,114 מודעות בשנה, רובן בדיקות קטנות; 242 מעל ₪500 מכסות 75%–99% מההוצאה (ויטלי אישר, 6.11).
 */
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { adminClient, requireAdmin } from '../../../../lib/auth'
import { tagCreative, fetchImage, coverKeys, lastMonths } from '../../../../lib/ad-tags.js'
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
  const months = Math.min(13, Math.max(1, Number(url.searchParams.get('months')) || 2))
  // מילוי של כמה חודשים (months > 2) — 100 בכל ריצה כברירת מחדל; בלי & ב-URL של ה-workflow (bash)
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || (months > 2 ? 100 : 40)))
  const t0 = Date.now()
  const sb = adminClient()

  if (!process.env.ANTHROPIC_API_KEY && !dry) return J({ error: 'ANTHROPIC_API_KEY לא מוגדר' }, 500)

  // המודעות של החודש הזה ושל הקודם
  const monthList = lastMonths(ym(new Date()), months)
  const from = monthList[monthList.length - 1]
  // לכל פרויקט — הדוחות שמכסים את החודשים בלי כפילות (חלק מהחודשים שמורים רק כרבעון, 6.11)
  const { data: keyRows, error: kErr } = await sb.from('reports').select('project_id, month').eq('source', 'facebook').gte('month', from)
  if (kErr) return J({ error: kErr.message }, 500)
  const byProj = new Map()
  for (const r of keyRows || []) (byProj.get(r.project_id) || byProj.set(r.project_id, []).get(r.project_id)).push(r.month)
  const want = new Set()
  for (const [pid, ks] of byProj) for (const k of coverKeys(ks, from, monthList[0])) want.add(pid + '|' + k)
  const wantKeys = [...new Set([...want].map(x => x.split('|')[1]))]
  const { data: repsAll, error } = wantKeys.length ? await sb.from('reports').select('project_id, month, data, summary').eq('source', 'facebook').in('month', wantKeys) : { data: [] }
  if (error) return J({ error: error.message }, 500)
  const reps = (repsAll || []).filter(r => want.has(r.project_id + '|' + r.month))
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
  const minSpend = Math.max(0, Number(url.searchParams.get('minSpend')) || (months > 2 ? 500 : 0))
  if (minSpend > 0) {
    const spendOf = new Map()
    for (const r of reps || []) for (const d of Array.isArray(r.data) ? r.data : []) {
      const id = String(d.adId || ''); if (id) spendOf.set(id, (spendOf.get(id) || 0) + (Number(d.spend) || 0))
    }
    for (const id of [...ads.keys()]) if ((spendOf.get(id) || 0) < minSpend) ads.delete(id)
  }
  const ids = [...ads.keys()]
  const done = new Set(), retry = new Set()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('ad_creative_tags').select('ad_id, account, image_url, ad_name, tags').in('ad_id', ids.slice(i, i + 200))
    // לא נחשב "סווג": בלי תמונה ובלי שם (הריצה הראשונה, 5.11), או סיווג מהטקסט בלבד שעוד לא נוסה שוב עם תמונה
    for (const x of data || []) {
      const textOnly = x.tags && x.tags.fromTextOnly
      // "לא זמינה" נחשב סגור רק אם נבדק מול החשבון הנכון. 73 מודעות סומנו כך בלי חשבון (5.11) — מטא ענה
      // "אין הרשאה" כי נשאלו עם הטוקן הלא נכון, לא כי נמחקו (ויטלי: "אנחנו לא מוחקים מודעות, אנחנו עוצרים").
      if (x.tags && x.tags.unavailable) { if (x.account) done.add(x.ad_id) }
      else if ((x.image_url || x.ad_name) && (!textOnly || x.tags.retried)) done.add(x.ad_id)
      else if (textOnly) retry.add(x.ad_id)
    }
  }
  const todo = ids.filter(id => !done.has(id)).slice(0, limit).map(id => ads.get(id))
  // מודעה שמופיעה רק במספרים (בלי activeAds): החשבון שלה מ-ad_daily, כדי לפנות למטא עם הטוקן הנכון
  // שורה אחת לכל מודעה: ב-ad_daily יש עשרות שורות לכל מודעה (יום × גיל × מגדר), ולכן שאילתה אחת עם
  // limit החזירה רק את המודעות הראשונות — והשאר נשאלו במטא בלי חשבון (5.11, 73 מודעות "לא זמינות").
  const noAcc = todo.filter(a => !a.account)
  await pool(noAcc, 8, async (a) => {
    const { data: r } = await sb.from('ad_daily').select('account, ad').eq('source', 'facebook').eq('ad_id', a.adId).limit(1).maybeSingle()
    if (r) { a.account = String(r.account || ''); if (!a.name && r.ad) a.name = r.ad }
  })
  // בלי חשבון אין טעם לשאול את מטא (הטוקן יהיה הלא נכון) — מדלגים, ולא מסמנים "לא זמינה"
  const noAccount = todo.filter(a => !a.account && !a.full).map(a => a.adId)
  if (noAccount.length) { for (const id of noAccount) { const i = todo.findIndex(t => t.adId === id); if (i >= 0) todo.splice(i, 1) } }
  if (dry) return J({ ads: ids.length, tagged: done.size, todo: todo.length, noAccount: noAccount.length, months, minSpend })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY.trim() })
  const errors = []
  let ok = 0, unavailable = 0
  await pool(todo, 4, async (a) => {
    try {
      // תמונה טרייה ממטא תמיד: קישורי התמונות ששמורים בדוח פגים אחרי כמה ימים. רק שדות שבאמת חזרו
      // ממטא נכנסים — תשובה ריקה לא מוחקת את מה שכבר ידוע (שם, טקסט, הקישור הישן).
      let fresh = {}
      try { fresh = await metaCreative(a.adId, a.account) } catch (e) { if (!a.full) throw e }
      const c = { ...a, ...Object.fromEntries(Object.entries(fresh).filter(([, v]) => v)) }
      const image = await fetchImage(c.imageUrl) || (fresh.imageUrl && a.imageUrl && a.imageUrl !== fresh.imageUrl ? await fetchImage(a.imageUrl) : null)
      if (!image && !c.title && !c.body) throw new Error('no image and no text for this ad (Meta returned nothing) - not tagged')
      const { tags, model } = await tagCreative(anthropic, { image, title: c.title, body: c.body, adName: c.name })
      const { error: upErr } = await sb.from('ad_creative_tags').upsert({
        ad_id: a.adId, account: c.account || '', ad_name: c.name || null, image_url: image ? (c.imageUrl || null) : null,
        is_video: !!c.isVideo, tags: { ...tags, ...(image ? {} : { fromTextOnly: true, ...(retry.has(a.adId) ? { retried: true } : {}) }) }, model, tagged_at: new Date().toISOString(),
      })
      if (upErr) throw new Error(upErr.message)
      ok++
    } catch (e) {
      const msg = String(e?.message || e)
      // מודעה שנמחקה במטא: מסמנים פעם אחת "לא זמינה", כדי שלא תתפוס כל יום מקום בתור של 40 (לא נכנסת להשוואה)
      if (/does not exist|cannot be loaded|Unsupported get request/i.test(msg)) {
        await sb.from('ad_creative_tags').upsert({ ad_id: a.adId, account: a.account || '', ad_name: a.name || null, image_url: null, is_video: false, tags: { unavailable: true }, model: null, tagged_at: new Date().toISOString() })
        unavailable++
      } else errors.push({ adId: a.adId, error: msg.slice(0, 200) })
    }
  })
  const out = { months, minSpend, ads: ids.length, alreadyTagged: done.size, tagged: ok, unavailable, noAccount: noAccount.length, errors: errors.slice(0, 10), left: Math.max(0, ids.length - done.size - todo.length - noAccount.length) }
  try { await logJob(sb, 'ad-tags', errors.length < todo.length || !todo.length, Date.now() - t0, out) } catch { /* הרישום לא מפיל */ }
  return J(out)
}
