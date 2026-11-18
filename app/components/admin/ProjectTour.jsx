'use client';

/**
 * ProjectTour — סיור מודרך בדשבורד (ויטלי, 14.11; סיור מלא 18.11).
 * המסך מתעמעם, רק המקום של הצעד מואר, ולידו חלון הסבר עם "הקודם" / "הבא" / "סיום סיור".
 * הצעדים מ-lib/tour-insights.js. locate(step) בדף מעביר לטאב הנכון ומחזיר את האלמנט (Promise).
 *
 * ההחשכה היא ארבעה מלבנים סביב האלמנט — הם גם חוסמים לחיצות מחוץ לו, והחור באמצע נשאר לחיץ
 * (אפשר ללחוץ על הכרטיס או על הטבלה עצמה). כשנפתח חלון (רשימת לידים) הוא מעל הסיור (9999 מול 9000).
 *
 * 18.11:
 *  - חלון הצעה שקופץ פעם בחודש לכל פרויקט (offerKey): "בואו נתחיל" / "לא עכשיו".
 *  - מדידה: offer / start / dismiss / skip / done, וכל צעד עם n ו-of — עד איזה צעד הגיעו.
 *  - חלון ההסבר לא מסתיר את האזור המואר: מתחת, מעל, או לצדו. אם אין מקום — פינה, וכשלוחצים
 *    בתוך האזור (למשל פותחים שורה בטבלה) החלון מתקפל לפס קטן.
 *  - צעד optional שהחלק שלו לא מוצג בתקופה — מדלגים עליו.
 *  - בטלפון אין סיור.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles, X, ChevronLeft, ChevronRight, List, PenLine, ChevronUp } from 'lucide-react';

const PAD = 8;
const GAP = 14;
const lsGet = (k) => { try { return localStorage.getItem(k) } catch { return '1' } };
const lsSet = (k) => { try { localStorage.setItem(k, String(Date.now())) } catch {} };

export default function ProjectTour({ steps, locate, openList, onEvent, offerKey, label = '3 דברים שכדאי לראות' }) {
  const [idx, setIdx] = useState(-1);          // -1 = סגור
  const [rect, setRect] = useState(null);
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState(false);
  const [mini, setMini] = useState(false);
  const elRef = useRef(null);
  const boxRef = useRef(null);
  const dirRef = useRef(1);
  const seqRef = useRef(0);   // לחיצה מהירה על "הבא" — רק הקריאה האחרונה ממשיכה
  const [boxPos, setBoxPos] = useState(null);
  const [phone, setPhone] = useState(true);   // בטלפון אין סיור (ויטלי, 18.11)
  const total = steps ? steps.length : 0;

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => { setPhone(mq.matches); if (mq.matches) { setIdx(-1); setOffer(false); setRect(null); elRef.current = null; } };
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // חלון ההצעה: פעם בחודש לכל פרויקט, אחרי שהנתונים נטענו, ורק כשאין חלון אחר פתוח
  useEffect(() => {
    if (phone || !offerKey || total < 4 || lsGet(offerKey)) return;
    let n = 0, t;
    const tryOpen = () => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) { if (++n < 30) t = setTimeout(tryOpen, 2000); return; }
      setOffer(true); onEvent?.('offer', { of: total });
    };
    t = setTimeout(tryOpen, 1800);
    return () => clearTimeout(t);
  }, [phone, offerKey, total]);   // eslint-disable-line react-hooks/exhaustive-deps

  const measure = useCallback(() => {
    const el = elRef.current;
    if (!el || !el.isConnected) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, []);

  const go = useCallback(async (i, dir = 1) => {
    if (!steps || i < 0 || i >= steps.length) return;
    dirRef.current = dir;
    const my = ++seqRef.current;
    setIdx(i); setBusy(true); setRect(null); setMini(false); elRef.current = null;
    let el = null;
    try { el = await locate(steps[i]); } catch { el = null; }
    if (my !== seqRef.current) return;
    if (!el && steps[i].optional) {
      // החלק לא מוצג בתקופה הזו — ממשיכים באותו כיוון. אין לאן — מציגים את הצעד בלי הדגשה.
      const j = i + dir;
      if (j >= 0 && j < steps.length) return go(j, dir);
    }
    onEvent?.(steps[i].id, { n: i + 1, of: steps.length });
    elRef.current = el;
    if (el) {
      // מקום לאזור וגם לחלון ההסבר מתחתיו — אם נכנסים שניהם; אחרת האזור לראש המסך
      const r0 = el.getBoundingClientRect(), H = window.innerHeight;
      const bh = (boxRef.current?.offsetHeight || 260) + 14;
      const fixed = getComputedStyle(el).position === 'fixed' || el.closest('header, .h-actions');
      if (!fixed) {
        const top = r0.height + bh + 40 <= H ? Math.max(72, (H - r0.height - bh) / 2) : 84;   // 72: מתחת לסרגל העליון
        window.scrollBy({ top: r0.top - top, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 500));
        if (my !== seqRef.current) return;
      }
    }
    measure(); setBusy(false);
  }, [steps, locate, measure, onEvent]);

  const start = useCallback(() => { setOffer(false); if (offerKey) lsSet(offerKey); onEvent?.('start', { of: total }); go(0); }, [offerKey, onEvent, total, go]);
  const dismissOffer = useCallback(() => { setOffer(false); if (offerKey) lsSet(offerKey); onEvent?.('dismiss', { of: total }); }, [offerKey, onEvent, total]);
  const close = useCallback((how) => { onEvent?.(how, { n: idx + 1, of: total }); setIdx(-1); setRect(null); setMini(false); elRef.current = null; }, [onEvent, idx, total]);

  // האזור המואר משנה גודל (שורה בטבלה נפתחת) — הטבעת גדלה איתו
  useEffect(() => {
    const el = elRef.current;
    if (idx < 0 || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure()); ro.observe(el);
    return () => ro.disconnect();
  }, [idx, busy, measure]);

  useEffect(() => {
    if (idx < 0) return;
    const on = () => measure();
    window.addEventListener('scroll', on, true); window.addEventListener('resize', on);
    const key = (e) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;   // חלון רשימה פתוח — Esc שלו
      if (e.key === 'Escape') close('skip');
      if (e.key === 'ArrowLeft' && idx < steps.length - 1) go(idx + 1, 1);
      if (e.key === 'ArrowRight' && idx > 0) go(idx - 1, -1);
    };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('scroll', on, true); window.removeEventListener('resize', on); window.removeEventListener('keydown', key); };
  }, [idx, measure, close, go, steps]);

  // מיקום חלון ההסבר: מתחת / מעל / משמאל / מימין לאזור המואר — הראשון שנכנס בלי לכסות אותו.
  // אין מקום — הפינה שמכסה הכי מעט (ואז לחיצה בתוך האזור מקפלת את החלון).
  const [covers, setCovers] = useState(false);
  useLayoutEffect(() => {
    if (idx < 0) { setBoxPos(null); return; }
    const box = boxRef.current; if (!box) return;
    const bw = box.offsetWidth, bh = box.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    if (!rect) { setBoxPos({ top: Math.max(16, (H - bh) / 2), left: Math.max(16, (W - bw) / 2) }); setCovers(false); return; }
    const fitsX = (l) => Math.min(Math.max(12, l), W - bw - 12);
    const fitsY = (t) => Math.min(Math.max(12, t), H - bh - 12);
    const alignR = fitsX(rect.left + rect.width - bw);   // RTL: מיושר לקצה הימני של האזור
    const cands = [
      { top: rect.top + rect.height + GAP, left: alignR },
      { top: rect.top - bh - GAP, left: alignR },
      { top: fitsY(rect.top), left: rect.left - bw - GAP },
      { top: fitsY(rect.top), left: rect.left + rect.width + GAP },
    ];
    const inView = (c) => c.top >= 12 && c.left >= 12 && c.top + bh <= H - 12 && c.left + bw <= W - 12;
    const overlap = (c) => {
      const x = Math.max(0, Math.min(c.left + bw, rect.left + rect.width) - Math.max(c.left, rect.left));
      const y = Math.max(0, Math.min(c.top + bh, rect.top + rect.height) - Math.max(c.top, rect.top));
      return x * y;
    };
    const ok = cands.find(c => inView(c) && overlap(c) === 0);
    if (ok) { setBoxPos(ok); setCovers(false); return; }
    const corners = [
      { top: H - bh - 16, left: 16 }, { top: H - bh - 16, left: W - bw - 16 },
      { top: 16, left: 16 }, { top: 16, left: W - bw - 16 },
    ].sort((a, b) => overlap(a) - overlap(b));
    setBoxPos(corners[0]); setCovers(overlap(corners[0]) > 0);
  }, [rect, idx, busy, mini]);

  // חלון שמכסה את האזור: אחרי לחיצה בתוך האזור (פותחים שורה) הוא מתקפל לפס קטן —
  // גם אם הוא התחיל להסתיר רק אחרי הלחיצה (הטבלה גדלה עד אליו)
  const touchedRef = useRef(false);
  useEffect(() => { touchedRef.current = false }, [idx]);
  useEffect(() => {
    if (idx < 0) return;
    const onDown = (e) => {
      if (!rect || boxRef.current?.contains(e.target)) return;
      const { clientX: x, clientY: y } = e;
      if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) { touchedRef.current = true; if (covers) setMini(true); }
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [idx, covers, rect]);
  useEffect(() => { if (covers && touchedRef.current) setMini(true) }, [covers]);

  if (!steps || !steps.length || phone) return null;
  const s = idx >= 0 ? steps[idx] : null;
  const last = idx === steps.length - 1;
  const W = typeof window !== 'undefined' ? window.innerWidth : 0, H = typeof window !== 'undefined' ? window.innerHeight : 0;
  const big = steps.length > 5;
  const nav = (
    <>
      {idx > 0 && <button type="button" className="ptour-btn ghost" onClick={() => go(idx - 1, -1)}><ChevronRight size={15} aria-hidden="true" />הקודם</button>}
      {last
        ? <button type="button" className="ptour-btn" onClick={() => close('done')}>סיום סיור</button>
        : <button type="button" className="ptour-btn" onClick={() => go(idx + 1, 1)}>הבא<ChevronLeft size={15} aria-hidden="true" /></button>}
    </>
  );

  return (
    <>
      <div className="ptour">
        <button type="button" className="ptour-chip" onClick={() => { onEvent?.('start', { of: total }); go(0) }}>
          <Sparkles size={15} aria-hidden="true" /><span>{big ? `סיור בדשבורד · ${steps.length} צעדים` : label.replace(/^3/, String(steps.length))}</span>
        </button>
      </div>

      {offer && idx < 0 && (
        <div className="ptour-offer-wrap" dir="rtl">
          <div className="ptour-offer" role="dialog" aria-modal="true" aria-labelledby="ptour-offer-t">
            <button type="button" className="ptour-x" onClick={dismissOffer} aria-label="סגירה"><X size={16} /></button>
            <span className="ptour-offer-ico" aria-hidden="true"><Sparkles size={22} /></span>
            <h3 id="ptour-offer-t">סיור קצר בדשבורד</h3>
            <div className="ptour-offer-text">{big ? `${steps.length} צעדים, כ-3 דקות. נראה לכם מאיפה מגיעות המכירות, מה עובד בפרסום, ומה אפשר לשפר.` : 'כמה דברים מהנתונים שלכם שכדאי לראות.'}</div>
            <div className="ptour-offer-actions">
              <button type="button" className="ptour-btn" onClick={start} autoFocus>בואו נתחיל</button>
              <button type="button" className="ptour-btn ghost" onClick={dismissOffer}>לא עכשיו</button>
            </div>
            <small>אפשר להתחיל בכל רגע מהכפתור "סיור בדשבורד".</small>
          </div>
        </div>
      )}

      {s && (
        <div className="ptour-layer" dir="rtl">
          {rect ? (<>
            <div className="ptour-dim" style={{ top: 0, left: 0, width: '100%', height: Math.max(0, rect.top) }} onClick={() => close('skip')} />
            <div className="ptour-dim" style={{ top: rect.top + rect.height, left: 0, width: '100%', height: Math.max(0, H - rect.top - rect.height) }} onClick={() => close('skip')} />
            <div className="ptour-dim" style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }} onClick={() => close('skip')} />
            <div className="ptour-dim" style={{ top: rect.top, left: rect.left + rect.width, width: Math.max(0, W - rect.left - rect.width), height: rect.height }} onClick={() => close('skip')} />
            <div className="ptour-ring" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
          </>) : <div className="ptour-dim" style={{ inset: 0 }} />}

          <div ref={boxRef} className={'ptour-box' + (mini ? ' mini' : '')} role="dialog" aria-live="polite" aria-label={s.title}
            style={boxPos ? { top: boxPos.top, left: boxPos.left } : { visibility: 'hidden' }}>
            {mini ? (
              <div className="ptour-mini">
                <button type="button" className="ptour-mini-open" onClick={() => setMini(false)} aria-label="פתיחת ההסבר">
                  <ChevronUp size={15} aria-hidden="true" /><span className="ptour-count">{idx + 1} מתוך {steps.length}</span><b>{s.title}</b>
                </button>
                <span style={{ flex: 1 }} />
                {nav}
              </div>
            ) : (<>
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
              {s.go?.interact && rect && !busy && <p className="ptour-try">👆 אפשר ללחוץ בתוך האזור המואר{covers ? '. החלון הזה יתקפל כדי לא להסתיר.' : ''}</p>}
              {busy ? <p className="ptour-wait">עוברים למקום...</p> : !rect ? <p className="ptour-wait">החלק הזה לא מוצג כרגע בתקופה שנבחרה.</p> : null}
              <div className="ptour-actions">
                {s.go?.card && rect ? <button type="button" className="ptour-btn ghost" onClick={() => { onEvent?.('list:' + s.id, { n: idx + 1, of: total }); openList?.(s) }}><List size={15} aria-hidden="true" />פתחו את הרשימה</button> : null}
                <span style={{ flex: 1 }} />
                {nav}
              </div>
              {!last && <button type="button" className="ptour-skip" onClick={() => close('skip')}>סיום סיור</button>}
            </>)}
          </div>
        </div>
      )}
    </>
  );
}
