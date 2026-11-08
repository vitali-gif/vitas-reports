/**
 * אילו מודעות פייסבוק שייכות לפרויקט (מזהה → חשבון, מזהה → סרטון), לפי דוחות הפייסבוק שלו ב-13 החודשים
 * האחרונים. משמש את /api/ad-images ואת /api/ad-media: מחזירים תמונה או סרטון רק למודעה של הפרויקט.
 *
 * במטמון של 10 דקות לכל instance: דוחות הפייסבוק של שנה שלמה הם עד ~11MB (KLOSS).
 * עד 6.11 נקראו 24 הדוחות האחרונים — רובם טווחים יומיים ושבועיים, ולכן מודעות ישנות נפסלו. עכשיו:
 * חודשים ('2026-05') וטווחים שמתחילים ב-1 לחודש (חודש מלא, רבעון).
 */
const _own = new Map()

export async function ownedAds(sb, projectId) {
  const hit = _own.get(projectId)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit
  const now = new Date()
  const since = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
  const { data: reps, error } = await sb.from('reports').select('data, summary->activeAds').eq('project_id', projectId).eq('source', 'facebook')
    .gte('month', since).or('month.like.____-__,month.like.____-__-01_*').limit(80)
  if (error) throw new Error(error.message)
  const ids = new Set(), accountOf = {}, videoOf = {}
  for (const r of reps || []) {
    for (const d of Array.isArray(r.data) ? r.data : []) if (d && d.adId) { ids.add(String(d.adId)); if (d.account && !accountOf[d.adId]) accountOf[String(d.adId)] = String(d.account) }
    for (const a of Array.isArray(r.activeAds) ? r.activeAds : []) {
      if (!a || !a.id) continue
      const id = String(a.id)
      ids.add(id)
      if (a.account && !accountOf[id]) accountOf[id] = String(a.account)
      if (a.videoId && !videoOf[id]) videoOf[id] = String(a.videoId)
    }
  }
  const out = { ids, accountOf, videoOf, at: Date.now() }
  _own.set(projectId, out)
  return out
}

/** משלים חשבון למודעות שאין להן חשבון בדוחות — מ-ad_daily. */
export async function fillAccounts(sb, own, adIds) {
  const missing = adIds.filter(id => !own.accountOf[id])
  if (!missing.length) return
  const { data: acc } = await sb.from('ad_daily').select('ad_id, account').eq('source', 'facebook').in('ad_id', missing).limit(500)
  for (const x of acc || []) if (!own.accountOf[x.ad_id]) own.accountOf[String(x.ad_id)] = String(x.account || '')
}
