'use client'
/**
 * קישורים טריים לסרטון / לתמונה של מודעת פייסבוק (ויטלי, 8.11: ב-HI PARK, רבעון 3, הסרטונים נשארו אפורים).
 *
 * הקישורים מ-fbcdn ששמורים בדוח פגים אחרי כ-5 ימים (הפרמטר oe= בקישור הוא זמן התפוגה, בהקסה),
 * ודוח של תקופה סגורה לא נמשך שוב. כשהקישור פג — או שיש סרטון בלי קובץ לנגן — מבקשים קישור חדש
 * מ-/api/ad-media. כל הכרטיסים שנטענים יחד נאספים לבקשה אחת.
 *
 * שימוש: <FreshAd projectId={id} ad={ad}>{(fresh) => ...}</FreshAd> — fresh הוא ad עם הקישורים המעודכנים.
 */
import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api-fetch'
import { fbUrlExpired } from '../../../lib/fb-url.js'

export { fbUrlExpired }

export function needsFresh(ad) {
  if (!ad || !ad.id || !/^\d{5,25}$/.test(String(ad.id))) return false
  if (ad.videoUrl ? fbUrlExpired(ad.videoUrl) : !!ad.videoId) return true
  return fbUrlExpired(ad.imageUrl || ad.thumbnailUrl)
}

const _done = new Map()      // `${projectId}:${adId}` → media | null
const _wait = new Map()      // key → [resolve]
let _queue = new Map()       // projectId → Set(adId)
let _timer = null

function flush() {
  _timer = null
  const q = _queue; _queue = new Map()
  for (const [projectId, set] of q) {
    const ids = [...set]
    for (let i = 0; i < ids.length; i += 10) {
      const part = ids.slice(i, i + 10)
      apiFetch(`/api/ad-media?projectId=${encodeURIComponent(projectId)}&ids=${part.join(',')}`)
        .then(r => (r.ok ? r.json() : null)).catch(() => null)
        .then(j => {
          for (const id of part) {
            const key = projectId + ':' + id
            const v = (j && j.media && j.media[id]) || null
            _done.set(key, v)
            for (const res of _wait.get(key) || []) res(v)
            _wait.delete(key)
          }
        })
    }
  }
}

function requestMedia(projectId, adId) {
  const key = projectId + ':' + adId
  if (_done.has(key)) return Promise.resolve(_done.get(key))
  return new Promise(res => {
    const first = !_wait.has(key)
    _wait.set(key, [...(_wait.get(key) || []), res])
    if (!first) return
    if (!_queue.has(projectId)) _queue.set(projectId, new Set())
    _queue.get(projectId).add(String(adId))
    if (!_timer) _timer = setTimeout(flush, 30)
  })
}

export default function FreshAd({ projectId, ad, children }) {
  const want = !!projectId && needsFresh(ad)
  const [media, setMedia] = useState(undefined)   // undefined = עוד מחכים, null = מטא לא החזיר
  useEffect(() => {
    if (!want) return undefined
    let live = true
    setMedia(undefined)
    requestMedia(projectId, ad.id).then(v => { if (live) setMedia(v) })
    return () => { live = false }
  }, [want, projectId, ad && ad.id])
  if (!want || media === null) return children(ad)
  // בזמן ההמתנה לא מציגים את הקישור שפג: התמונה נכשלת מיד, ה-onError של הכרטיס מסתיר אותה
  // ומשאיר רקע כהה — וזה נשאר גם אחרי שהקישור החדש מגיע (ויטלי, 8.11: המודעות הסטטיות ריקות).
  const live = (u) => (u && !fbUrlExpired(u) ? u : '')
  if (media === undefined) {
    return children({ ...ad, videoUrl: live(ad.videoUrl), imageUrl: live(ad.imageUrl), thumbnailUrl: live(ad.thumbnailUrl) })
  }
  return children({
    ...ad,
    videoUrl: media.videoUrl || live(ad.videoUrl),
    videoPermalink: media.permalink || ad.videoPermalink,
    imageUrl: media.imageUrl || live(ad.imageUrl),
    thumbnailUrl: media.imageUrl || live(ad.thumbnailUrl),
  })
}
