'use client'
import { useEffect, useRef, useState } from 'react'
import { Megaphone, Layers } from 'lucide-react'

// הטקסט של מודעה בכרטיס (ויטלי, 6.11): תווית "כותרת" מעל הכותרת ו"קופי" מעל הטקסט הארוך. הקופי מקוצר
// לשלוש שורות עם "המשך..." שפותח את כולו; כותרת ארוכה — לשתי שורות. בלי קיצור כשהטקסט קצר ממילא.
function Clamp({ text, lines, className }) {
  const [open, setOpen] = useState(false)
  const [long, setLong] = useState(false)
  const ref = useRef(null)
  // "המשך..." רק כשהטקסט באמת נחתך ברוחב הנוכחי (טלפון / מחשב)
  useEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setLong(el.scrollHeight > el.clientHeight + 2)
    check()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [text, open])
  return (
    <div className={className}>
      <div ref={ref} className={open ? 'adc-text' : 'adc-text adc-clamp'} style={open ? undefined : { WebkitLineClamp: lines }} dir="auto">{text}</div>
      {(long || open) && <button type="button" className="adc-more" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? 'הסתרה' : 'המשך...'}</button>}
    </div>
  )
}

export function AdCopy({ title, body }) {
  if (!title && !body) return null
  return (
    <div className="adc">
      {title && <div><span className="adc-label">כותרת</span><Clamp text={title} lines={2} className="adc-title" /></div>}
      {body && <div><span className="adc-label">קופי</span><Clamp text={body} lines={3} className="adc-body" /></div>}
    </div>
  )
}

// שורת הקמפיין וקבוצת המודעות בתחתית הכרטיס — אייקוני lucide במקום 📊 ו-🎯
export function AdPlacement({ campaign, adSet }) {
  return (
    <div className="adc-place">
      <div title="קמפיין"><Megaphone size={13} aria-hidden="true" /><span dir="auto">{campaign || '-'}</span></div>
      {adSet && <div title="קבוצת מודעות"><Layers size={13} aria-hidden="true" /><span dir="auto">{adSet}</span></div>}
    </div>
  )
}
