'use client';

/**
 * ProjectTour — "3 דברים שכדאי לראות" (ויטלי, 14.11). הצעדים מחושבים ב-lib/tour-insights.js מהמספרים
 * של התקופה שעל המסך; לחיצה על צעד מעבירה לטאב, גוללת ומדגישה (onGo בדף). בשלב ראשון — אדמין בלבד.
 */
import { useState } from 'react';
import { Sparkles, ChevronLeft, X } from 'lucide-react';

export default function ProjectTour({ steps, onGo, onOpen, label = '3 דברים שכדאי לראות' }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => new Set());
  if (!steps || !steps.length) return null;
  const toggle = () => { const next = !open; setOpen(next); if (next) onOpen?.(); };
  return (
    <div className="ptour" dir="rtl">
      <button type="button" className={'ptour-chip' + (open ? ' on' : '')} onClick={toggle} aria-expanded={open}>
        <Sparkles size={15} aria-hidden="true" />
        <span>{label.replace(/^3/, String(steps.length))}</span>
        {!open && seen.size < steps.length ? <i className="ptour-dot" aria-hidden="true" /> : null}
      </button>
      {open && (
        <div className="ptour-panel" role="region" aria-label={label}>
          <button type="button" className="ptour-close" onClick={() => setOpen(false)} aria-label="סגור"><X size={16} /></button>
          <ol className="ptour-list">
            {steps.map((s) => (
              <li key={s.id}>
                <button type="button" className={'ptour-step' + (seen.has(s.id) ? ' seen' : '')}
                  onClick={() => { setSeen(prev => new Set(prev).add(s.id)); onGo?.(s); }}>
                  <span className="ptour-stat">{s.stat}</span>
                  <span className="ptour-body">
                    <b>{s.title}</b>
                    <span>{s.text}</span>
                    <small>{s.todo}</small>
                  </span>
                  <span className="ptour-go">הראו לי<ChevronLeft size={14} aria-hidden="true" /></span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
