/**
 * קישורי הקבצים של פייסבוק (fbcdn) פגים אחרי כ-5 ימים. הפרמטר oe= בקישור הוא זמן התפוגה (שניות, בהקסה).
 * משמש את הדשבורד (FreshAd), את דוח ה-PDF ואת /api/ad-media.
 */
/** true אם הקישור פג (או יפוג ב-10 הדקות הקרובות). קישור בלי oe= נחשב תקף. */
export function fbUrlExpired(u, now = Date.now()) {
  const m = /[?&]oe=([0-9A-Fa-f]{6,10})(?:&|$)/.exec(String(u || ''))
  if (!m) return false
  return parseInt(m[1], 16) * 1000 < now + 10 * 60 * 1000
}

/**
 * מחליף בדוח ה-PDF תמונות של מודעות שהקישור שלהן פג. getMedia(ids) מחזיר { [adId]: { imageUrl } }
 * (בדפדפן — /api/ad-media; בשרת — freshAdMedia). שגיאה לא עוצרת את הדוח: נשאר הקישור הישן.
 */
export async function refreshModelAdImages(model, getMedia) {
  const ads = ((model && model.topAds) || []).filter(a => a && a.id && fbUrlExpired(a.image))
  if (!ads.length) return model
  const media = await Promise.resolve(getMedia(ads.map(a => String(a.id)))).catch(() => null)
  for (const a of ads) { const m = media && media[String(a.id)]; if (m && m.imageUrl) a.image = m.imageUrl }
  return model
}
