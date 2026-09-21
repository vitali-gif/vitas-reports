'use client'
/**
 * בורר תצוגה למובייל.
 *
 * המפרט: "CRM: בורר תצוגה יחיד פותח רשימה בחלונית תחתונה. בנדל״ן חמש
 * תצוגות; ב-KLOSS חמש אחרות; באריקה אין בורר תתי־טאבים."
 *
 * הרכיב לא מחליף את שורת הטאבים בדסקטופ — הוא נוסף לידה, וה-CSS מחליט
 * מי מהם נראה. הסיבה: זיהוי רוחב ב-JS היה גורר hydration mismatch (השרת
 * לא יודע את רוחב המסך) והבהוב של השורה הלא נכונה בטעינה הראשונה.
 * שורת כפתורים מוסתרת היא זולה; גרף חי מוסתר לא היה מתקבל על הדעת.
 */
import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import BottomSheet from './BottomSheet'

export default function ViewPicker({ title = 'תצוגות', value, options = [], onChange }) {
  const [open, setOpen] = useState(false)
  const active = options.find(o => o.key === value)

  return (
    <div className="vpick">
      <button
        type="button"
        className="vpick-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <ChevronDown size={16} aria-hidden="true" />
        <span className="vpick-trigger-label">{title}</span>
        <span className="vpick-trigger-value"><bdi>{active?.label || '—'}</bdi></span>
      </button>

      <BottomSheet open={open} title={title} onClose={() => setOpen(false)}>
        <ul className="vpick-list" role="listbox" aria-label={title}>
          {options.map(o => {
            const on = o.key === value
            return (
              <li key={o.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`vpick-option${on ? ' on' : ''}`}
                  onClick={() => { onChange?.(o.key); setOpen(false) }}
                >
                  <span className="vpick-check" aria-hidden="true">{on ? <Check size={18} /> : null}</span>
                  <span className="vpick-option-label"><bdi>{o.label}</bdi></span>
                  {o.icon ? <span className="vpick-option-icon" aria-hidden="true">{o.icon}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </BottomSheet>
    </div>
  )
}
