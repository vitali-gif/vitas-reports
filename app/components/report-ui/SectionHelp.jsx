'use client'
import { useEffect } from 'react'
import { helpFor } from '../../../lib/section-help.js'

// "איך זה עוזר לך?" (ויטלי, 5.11) — כפתור קטן ליד כותרת של כל טבלה וגרף שיש לה הסבר ב-lib/section-help.js.
// לחיצה פותחת מתחת לכותרת תיבת הסבר (כמו .cz-note). 42 כותרות שונות בדשבורד, בלי רכיב משותף — לכן
// הרכיב הזה מוצא אותן בעצמו (MutationObserver) ומוסיף את הכפתור, בלי לגעת בקוד של כל סעיף.
const ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>'
const SELECTOR = '.section-head > h2, .vr-section-heading h2'

function enhance(root) {
  root.querySelectorAll(SELECTOR).forEach(h2 => {
    const title = h2.textContent || ''
    if (h2.dataset.helpFor === title) return
    h2.dataset.helpFor = title
    const head = h2.closest('.section-head, .vr-section-heading')
    if (!head) return
    head.querySelectorAll(':scope > .sh-btn, :scope .sh-btn').forEach(n => n.remove())
    const next = head.nextElementSibling
    if (next && next.classList.contains('sh-note')) next.remove()
    const text = helpFor(title)
    if (!text) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'sh-btn'
    btn.setAttribute('aria-expanded', 'false')
    btn.innerHTML = ICON + '<span>איך זה עוזר לך?</span>'
    const note = document.createElement('p')
    note.className = 'cz-note sh-note'
    note.hidden = true
    const label = document.createElement('span'); label.className = 'cz-note-label'; label.textContent = 'איך זה עוזר לך'
    const body = document.createElement('span'); body.textContent = text
    note.append(label, body)
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      note.hidden = !note.hidden
      btn.setAttribute('aria-expanded', String(!note.hidden))
      btn.classList.toggle('on', !note.hidden)
    })
    h2.insertAdjacentElement('afterend', btn)
    head.insertAdjacentElement('afterend', note)
  })
}

export default function SectionHelp() {
  useEffect(() => {
    let raf = 0
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => enhance(document)) }
    run()
    const mo = new MutationObserver(run)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { mo.disconnect(); cancelAnimationFrame(raf) }
  }, [])
  return null
}
