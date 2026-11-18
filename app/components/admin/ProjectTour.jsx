'use client';

/**
 * ProjectTour — סיור מודרך "3 דברים שכדאי לראות" (ויטלי, 14.11).
 * המסך מתעמעם, רק המקום של הצעד מואר, ולידו חלון הסבר עם "הקודם" / "הבא" / "סיום סיור".
 * הצעדים מ-lib/tour-insights.js. locate(step) בדף מעביר לטאב הנכון ומחזיר את האלמנט (Promise).
 *
 * ההחשכה היא ארבעה מלבנים סביב האלמנט — הם גם חוסמים לחיצות מחוץ לו, והחור באמצע נשאר לחיץ
 * (אפשר ללחוץ על הכרטיס עצמו). כשנפתח חלון (רשימת לידים) הוא מעל הסיור (z-index 9999 מול 9000).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles, X, ChevronLeft, ChevronRight, List, PenLine } from 'lucide-react';

const PAD = 8;

export default function ProjectTour({ steps, locate, openList, onEvent, label = '3 דברים שכדאי לראות' }) {
  const [idx, setIdx] = useState(-1);          // -1 = סגור
  const [rect, setRect] = useState(null);
  const [busy, setBusy] = useState(false);
  const elRef = useRef(null);
  const boxRef = useRef(null);
  const [boxPos, setBoxPos] = useState(null);
  const [narrow, setNarrow] = useState(false);

  const measure = useCallback(() => {
    const el = elRef.current;
    if (!el || !el.isConnected) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
    setNarrow(window.innerWidth < 640);
  }, []);

  const go = useCallback(async (i) => {
    if (!steps || i < 0 || i >= steps.length) return;
    setIdx(i); setBusy(true); setRect(null); elRef.current = null;
    onEvent?.(steps[i].id);
    let el = null;
    try { el = await locate(steps[i]); } catch { el = null; }
    elRef.current = el;
    if (el) {
      // גבוה מהמסך — מיישרים לראש שלו, אחרת למרכז
      // בטלפון חלון ההסבר יושב בתחתית — האלמנט עולה לראש המסך (מתחת לסרגל העליון).
      // במחשב: גבוה מהמסך — לראש שלו, אחרת למרכז.
      const r0 = el.getBoundingClientRect()
      const top = window.innerWidth < 640 ? 84 : (r0.height > window.innerHeight * 0.6 ? 84 : (window.innerHeight - r0.height) / 2)
      window.scrollBy({ top: r0.top - top, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 500));
    }
    measure(); setBusy(false);
  }, [steps, locate, measure, onEvent]);

  // צעד שבו לוחצים בתוך האלמנט (טבלה שנפתחת) — הטבעת גדלה יחד איתו
  useEffect(() => {
    const el = elRef.current
    if (idx < 0 || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure()); ro.observe(el)
    return () => ro.disconnect()
  }, [idx, busy, measure]);

  const close = useCallback((how) => { onEvent?.(how); setIdx(-1); setRect(null); elRef.current = null; }, [onEvent]);

  useEffect(() => {
    if (idx < 0) return;
    const on = () => measure();
    window.addEventListener('scroll', on, true); window.addEventListener('resize', on);
    const key = (e) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;   // חלון רשימה פתוח — Esc שלו
      if (e.key === 'Escape') close('skip');
      if (e.key === 'ArrowLeft' && idx < steps.length - 1) go(idx + 1);
      if (e.key === 'ArrowRight' && idx > 0) go(idx - 1);
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); window.removeEventListener('keydown', key); };
  }, [idx, measure, close, go, steps]);

  // מיקום חלון ההסבר: מתחת לאלמנט אם יש מקום, אחרת מעליו; בטלפון — תמיד בתחתית המסך
  useLayoutEffect(() => {
    if (idx < 0 || narrow) { setBoxPos(null); return; }
    const box = boxRef.current; if (!box) return;
    const bw = box.offsetWidth, bh = box.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    if (!rect) { setBoxPos({ top: Math.max(16, (H - bh) / 2), left: Math.max(16, (W - bw) / 2) }); return; }
    let top = rect.top + rect.height + 12;
    if (top + bh > H - 12) top = rect.top - bh - 12;
    if (top < 12) top = Math.max(12, H - bh - 12);
    let left = rect.left + rect.width - bw;            // RTL: מיושר לקצה הימני של האלמנט
    left = Math.min(Math.max(12, left), W - bw - 12);
    setBoxPos({ top, left });
  }, [rect, idx, narrow, busy]);

  if (!steps || !steps.length) return null;
  const s = idx >= 0 ? steps[idx] : null;
  const last = idx === steps.length - 1;
  const W = typeof window !== 'undefined' ? window.innerWidth : 0, H = typeof window !== 'undefined' ? window.innerHeight : 0;

  return (
    <>
      <div className="ptour">
        <button type="button" className="ptour-chip" onClick={() => go(0)}>
          <Sparkles size={15} aria-hidden="true" /><span>{steps.length > 5 ? `סיור בדשבורד · ${steps.length} צעדים` : label.replace(/^3/, String(steps.length))}</span>
        </button>
      </div>
      {s && (
        <div className="ptour-layer" dir="rtl">
          {rect ? (<>
            <div className="ptour-dim" style={{ top: 0, left: 0, width: '100%', height: Math.max(0, rect.top) }} onClick={() => close('skip')} />
            <div className="ptour-dim" style={{ top: rect.top + rect.height, left: 0, width: '100%', height: Math.max(0, H - rect.top - rect.height) }} onClick={() => close('skip')} />
            <div className="ptour-dim" style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }} onClick={() => close('skip')} />
            <div className="ptour-dim" style={{ top: rect.top, left: rect.left + rect.width, width: Math.max(0, W - rect.left - rect.width), height: rect.height }} onClick={() => close('skip')} />
            <div className="ptour-ring" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
          </>) : <div className="ptour-dim" style={{ inset: 0 }} />}
          <div ref={boxRef} className={'ptour-box' + (narrow ? ' sheet' + (rect && rect.top + rect.height / 2 > H * 0.55 ? ' top' : '') : '')} role="dialog" aria-live="polite" aria-label={s.title}
            style={!narrow && boxPos ? { top: boxPos.top, left: boxPos.left } : undefined}>
            <div className="ptour-box-head">
              <span className="ptour-count">{idx + 1} מתוך {steps.length}</span>
              {steps.length > 3 && <span className="ptour-progress" aria-hidden="true"><i style={{ width: ((idx + 1) / steps.length) * 100 + '%' }} /></span>}
              <button type="button" className="ptour-x" onClick={() => close('skip')} aria-label="סיום סיור"><X size={16} /></button>
            </div>
            <div className="ptour-box-main">
              <span className="ptour-stat">{s.stat}</span>
              <div className="ptour-body"><b>{s.title}</b><span>{s.text}</span><small>{s.todo}</small></div>
            </div>
            {s.note && (
              <div className="ptour-note">
                <PenLine size={15} aria-hidden="true" />
                <div><b>חסר רישום ב-CRM</b> {s.note.text}{s.note.loss && <span>מה מפסידים: {s.note.loss}</span>}</div>
              </div>
            )}
            {s.go?.interact && rect && !busy && <p className="ptour-try">👆 אפשר ללחוץ בתוך האזור המואר</p>}
            {busy ? <p className="ptour-wait">עוברים למקום...</p> : !rect ? <p className="ptour-wait">החלק הזה לא מוצג כרגע בתקופה שנבחרה.</p> : null}
            <div className="ptour-actions">
              {s.go?.card && rect ? <button type="button" className="ptour-btn ghost" onClick={() => { onEvent?.('list:' + s.id); openList?.(s) }}><List size={15} aria-hidden="true" />פתחו את הרשימה</button> : null}
              <span style={{ flex: 1 }} />
              {idx > 0 && <button type="button" className="ptour-btn ghost" onClick={() => go(idx - 1)}><ChevronRight size={15} aria-hidden="true" />הקודם</button>}
              {last
                ? <button type="button" className="ptour-btn" onClick={() => close('done')}>סיום סיור</button>
                : <button type="button" className="ptour-btn" onClick={() => go(idx + 1)}>הבא<ChevronLeft size={15} aria-hidden="true" /></button>}
            </div>
            {!last && <button type="button" className="ptour-skip" onClick={() => close('skip')}>סיום סיור</button>}
          </div>
        </div>
      )}
    </>
  );
}
