// lib/fb-url.js — תפוגת קישורי fbcdn והחלפת תמונות בדוח ה-PDF (8.11)
import assert from 'node:assert/strict'
import { fbUrlExpired, refreshModelAdImages } from '../../lib/fb-url.js'

const now = Date.parse('2026-11-08T12:00:00Z')
const hex = (d) => Math.floor(Date.parse(d) / 1000).toString(16).toUpperCase()
assert.equal(fbUrlExpired(`https://x.fbcdn.net/a.jpg?oe=${hex('2026-10-13T00:00:00Z')}&x=1`, now), true)
assert.equal(fbUrlExpired(`https://x.fbcdn.net/a.jpg?a=1&oe=${hex('2026-11-12T00:00:00Z')}`, now), false)
assert.equal(fbUrlExpired(`https://x.fbcdn.net/a.jpg?oe=${hex('2026-11-08T12:05:00Z')}`, now), true, 'פג בעוד פחות מ-10 דקות')
assert.equal(fbUrlExpired('https://example.com/a.jpg', now), false)
assert.equal(fbUrlExpired('', now), false)

const old = `https://x.fbcdn.net/a.jpg?oe=${hex('2020-01-01T00:00:00Z')}`
const model = { topAds: [{ id: '1234567', image: old }, { id: '7654321', image: 'https://ok.example/b.jpg' }, { id: '', image: old }] }
let asked = null
await refreshModelAdImages(model, ids => { asked = ids; return { 1234567: { imageUrl: 'https://fresh.example/a.jpg' } } })
assert.deepEqual(asked, ['1234567'], 'רק מודעה עם מזהה וקישור שפג')
assert.equal(model.topAds[0].image, 'https://fresh.example/a.jpg')
assert.equal(model.topAds[1].image, 'https://ok.example/b.jpg')
assert.equal(model.topAds[2].image, old)
// שגיאה לא עוצרת את הדוח
const m2 = { topAds: [{ id: '1234567', image: old }] }
await refreshModelAdImages(m2, () => Promise.reject(new Error('meta down')))
assert.equal(m2.topAds[0].image, old)
console.log('fb-url: ok')
