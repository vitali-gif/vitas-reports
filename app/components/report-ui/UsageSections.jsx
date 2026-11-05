'use client'
import { useEffect } from 'react'
import { track, usageOn } from '../../../lib/usage-track.js'

// אילו סעיפים הלקוח באמת רואה (ויטלי, 6.11): סעיף שהיה על המסך 3 שניות ברצף נרשם פעם אחת לכל
// טאב ותקופה (scope). כמו SectionHelp — מוצא את הכותרות לבד, בלי לגעת בקוד של כל סעיף.
const SELECTOR = '.section-head > h2, .vr-section-heading h2'
const DWELL = 3000

export default function UsageSections({ scope }) {
  useEffect(() => {
    if (!usageOn() || typeof IntersectionObserver === 'undefined') return
    const seen = new Set()
    const timers = new Map()
    const watched = new WeakSet()
    const titleOf = (el) => String(el.querySelector(SELECTOR)?.textContent || '').replace(/איך זה עוזר לך\?/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const t = titleOf(e.target)
        if (!t || seen.has(t)) continue
        if (e.isIntersecting) {
          if (!timers.has(e.target)) timers.set(e.target, setTimeout(() => { seen.add(t); timers.delete(e.target); track('section', { title: t }) }, DWELL))
        } else { clearTimeout(timers.get(e.target)); timers.delete(e.target) }
      }
    }, { threshold: [0.4] })
    const scan = () => document.querySelectorAll(SELECTOR).forEach(h => {
      const box = h.closest('.section, .vr-section, section') || h.parentElement
      if (box && !watched.has(box)) { watched.add(box); io.observe(box) }
    })
    scan()
    let raf = 0
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan) })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { io.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); timers.forEach(clearTimeout) }
  }, [scope])
  return null
}
