'use client'
/**
 * בורר פרויקט למובייל (לוח 02 בחבילת Tovno-Mobile-Handoff).
 *
 * המפרט: "בחירת פרויקט בחלונית תחתונה, בלי לחשוף שמות לקוחות אחרים."
 * לכן הרשימה כאן היא projects של הלקוח הנוכחי בלבד. עץ הלקוחות המלא
 * נשאר במגירה, ושם הוא ממילא מסונן לפי ההרשאות בשרת — "אין להסתמך על
 * הסתרה ב-CSS כהרשאה".
 *
 * הבורר מוסתר בדסקטופ ב-CSS; שם הכותרת "לקוח / פרויקט" ממלאת את התפקיד.
 */
import { useState } from 'react'
import { Building2, Check, ChevronDown } from 'lucide-react'
import BottomSheet from './BottomSheet'

export default function ProjectPicker({ client, project, projects = [], onSelectProject }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="vproj">
      <button
        type="button"
        className="vproj-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <ChevronDown size={16} aria-hidden="true" />
        <span className="vproj-trigger-text">
          <bdi>{client}</bdi>
          {project ? <><span className="vproj-sep">/</span><bdi dir="ltr">{project}</bdi></> : null}
        </span>
      </button>

      <BottomSheet open={open} title="בחירת פרויקט" subtitle={client} onClose={() => setOpen(false)}>
        <ul className="vpick-list" role="listbox" aria-label="בחירת פרויקט">
          {projects.map(p => {
            const on = p.name === project
            return (
              <li key={p.id ?? p.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`vpick-option${on ? ' on' : ''}`}
                  onClick={() => { onSelectProject?.(p); setOpen(false) }}
                >
                  <span className="vpick-check" aria-hidden="true">{on ? <Check size={18} /> : null}</span>
                  <span className="vpick-option-label"><bdi dir="ltr">{p.name}</bdi></span>
                  <span className="vpick-option-icon" aria-hidden="true"><Building2 size={18} /></span>
                </button>
              </li>
            )
          })}
        </ul>
      </BottomSheet>
    </div>
  )
}
