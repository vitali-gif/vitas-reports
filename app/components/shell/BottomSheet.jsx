'use client'
/**
 * חלונית תחתונה (bottom sheet) — המעטפת שכל הבוררים במובייל נפתחים לתוכה.
 *
 * המפרט (Tovno-Mobile-Handoff, MOBILE-SYSTEM §חלוניות):
 * כותרת, סגירה ברורה, גוף שגולל פנימית, safe-area בתחתית, max-block-size
 * סביב 90dvh, ניהול פוקוס, Escape לסגירה, החזרת פוקוס לכפתור הפותח ונעילת
 * גלילת הרקע. במפורש: לא להסתמך על מחוות גרירה לסגירה.
 *
 * הרכיב מרונדר דרך portal ל-body — בתוך העץ הוא היה יורש stacking context
 * של כרטיס או של ה-header הדביק, ונחתך.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export default function BottomSheet({ open, title, subtitle, onClose, children, labelledBy }) {
  const panelRef = useRef(null)
  const openerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    // מי היה בפוקוס לפני הפתיחה — לשם הפוקוס חוזר בסגירה.
    openerRef.current = document.activeElement

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return }
      if (e.key !== 'Tab') return
      // מלכודת פוקוס: בלעדיה Tab בורח לתוכן שמאחורי החלונית, שממילא נעול לגלילה.
      const focusables = panelRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusables || !focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)

    // פוקוס ראשוני על הפאנל עצמו ולא על הפריט הראשון: קורא מסך מקריא את
    // הכותרת, ומשתמש מקלדת לא "בולע" בטעות בחירה בלחיצת רווח.
    const t = setTimeout(() => panelRef.current?.focus(), 0)

    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      const opener = openerRef.current
      if (opener && typeof opener.focus === 'function') opener.focus()
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="vsheet-root" dir="rtl">
      <div className="vsheet-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="vsheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || undefined}
        aria-label={labelledBy ? undefined : title}
        tabIndex={-1}
        ref={panelRef}
      >
        <div className="vsheet-grip" aria-hidden="true" />
        <div className="vsheet-head">
          <button type="button" className="vsheet-close" onClick={onClose} aria-label="סגור">
            <X size={18} aria-hidden="true" />
          </button>
          <div className="vsheet-titles">
            <h2 id={labelledBy || undefined}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
        <div className="vsheet-body">{children}</div>
      </div>
    </div>,
    document.body
  )
}
