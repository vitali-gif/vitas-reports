'use client';
/* ============================================================
   VITAS Reports — Mobile Date Range Picker
   Bottom-sheet for mobile (≤ 768px). RTL-first.
   Portal root created via JS so position:fixed is immune to
   any CSS or RTL interference from the document.
   ============================================================ */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';

const HE_MONTHS_SHORT = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'];
const HE_MONTHS_LONG  = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HE_DOW = ['א','ב','ג','ד','ה','ו','ש'];

/* ---------- Date helpers ---------- */
const sod = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const addDays = (d, n) => { const x = sod(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => a && b && sod(a).getTime() === sod(b).getTime();
const isBetween = (d, from, to) => {
  if (!from || !to) return false;
  const t = sod(d).getTime();
  return t >= sod(from).getTime() && t <= sod(to).getTime();
};
const startOfMonth = (d) => { const x = sod(d); x.setDate(1); return x; };
const endOfMonth   = (d) => { const x = startOfMonth(d); x.setMonth(x.getMonth()+1); x.setDate(0); return x; };
const fmtLong  = (d) => d ? `${d.getDate()} ב${HE_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : '';

/* ---------- Presets ---------- */
const DEFAULT_PRESETS = [
  { id: 'today',      label: 'היום',        range: () => { const t = sod(new Date()); return { from: t, to: t }; } },
  { id: 'yesterday',  label: 'אתמול',       range: () => { const t = addDays(new Date(), -1); return { from: t, to: t }; } },
  { id: '7d',         label: '7 ימים',      range: () => { const t = sod(new Date()); return { from: addDays(t,-6), to: t }; } },
  { id: '14d',        label: '14 ימים',     range: () => { const t = sod(new Date()); return { from: addDays(t,-13), to: t }; } },
  { id: '30d',        label: '30 ימים',     range: () => { const t = sod(new Date()); return { from: addDays(t,-29), to: t }; } },
  { id: 'this-month', label: 'החודש',       range: () => { const t = sod(new Date()); return { from: startOfMonth(t), to: t }; } },
  { id: 'last-month', label: 'החודש שעבר',  range: () => { const t = sod(new Date()); const a = startOfMonth(addDays(startOfMonth(t),-1)); return { from: a, to: endOfMonth(a) }; } },
  { id: '90d',        label: '90 ימים',     range: () => { const t = sod(new Date()); return { from: addDays(t,-89), to: t }; } },
  { id: 'ytd',        label: 'השנה',        range: () => { const t = sod(new Date()); return { from: new Date(t.getFullYear(),0,1), to: t }; } },
];

/* ---------- Icons ---------- */
const Icon = {
  cal:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  chevDown:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"   strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
  chevLeft:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>,
  chevRight: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  x:         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"   strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
};

/* ---------- Calendar grid builder ---------- */
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const grid = [];
  const prevEnd = new Date(year, month, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    grid.push({ date: new Date(year, month - 1, prevEnd - i), inMonth: false });
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    grid.push({ date: new Date(year, month, d), inMonth: true });
  }
  while (grid.length < 42) {
    const idx = grid.length - (startWeekday + daysInMonth) + 1;
    grid.push({ date: new Date(year, month + 1, idx), inMonth: false });
  }
  return grid;
}

/* ============================================================
   Component
   ============================================================ */
export default function DateRangePicker({
  value = { from: null, to: null, presetId: null },
  onChange = () => {},
  presets = DEFAULT_PRESETS,
  triggerLabel,
}) {
  const [open, setOpen]               = useState(false);
  const [closing, setClosing]         = useState(false);
  const [draftFrom, setDraftFrom]     = useState(value.from);
  const [draftTo, setDraftTo]         = useState(value.to);
  const [activePreset, setActivePreset] = useState(value.presetId);
  const [editing, setEditing]         = useState('from');
  const [navDate, setNavDate]         = useState(value.to || value.from || new Date());

  /* Portal root — created once on mount, appended to <body>.
     Styles applied via JS so no CSS can override position:fixed.  */
  const portalRef = useRef(null);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      'top:0', 'left:0',
      'width:100%', 'height:100%',
      'z-index:9999',
      'pointer-events:none',
      'overflow:hidden',
    ].join(';');
    document.body.appendChild(el);
    portalRef.current = el;
    setPortalReady(true);
    return () => { if (document.body.contains(el)) document.body.removeChild(el); };
  }, []);

  /* Body scroll lock */
  useEffect(() => {
    if (open) {
      setDraftFrom(value.from);
      setDraftTo(value.to);
      setActivePreset(value.presetId);
      setEditing('from');
      setNavDate(value.to || value.from || new Date());
      document.body.classList.add('drp-no-scroll');
    } else {
      document.body.classList.remove('drp-no-scroll');
    }
    return () => document.body.classList.remove('drp-no-scroll');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ESC to close */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 220);
  }, []);

  const handleConfirm = () => {
    onChange({
      from: draftFrom,
      to: draftTo,
      presetId: activePreset,
      presetLabel: presets.find(p => p.id === activePreset)?.label,
    });
    handleClose();
  };

  const handlePreset = (preset) => {
    const { from, to } = preset.range();
    setDraftFrom(from);
    setDraftTo(to);
    setActivePreset(preset.id);
    setEditing('to');
    setNavDate(to);
  };

  const handleDayClick = (date) => {
    if (editing === 'from' || !draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(date); setDraftTo(null); setEditing('to');
    } else {
      if (date < draftFrom) { setDraftTo(draftFrom); setDraftFrom(date); }
      else { setDraftTo(date); }
      setEditing('from');
    }
    setActivePreset(null);
  };

  const grid = useMemo(
    () => buildMonthGrid(navDate.getFullYear(), navDate.getMonth()),
    [navDate]
  );

  const dayProps = (date, inMonth) => {
    const isStart = draftFrom && sameDay(date, draftFrom);
    const isEnd   = draftTo   && sameDay(date, draftTo);
    const inRange = draftFrom && draftTo && isBetween(date, draftFrom, draftTo) && !isStart && !isEnd;
    const weekIdx = grid.findIndex(g => sameDay(g.date, date));
    const col = weekIdx % 7;
    return { isStart, isEnd, inRange, isToday: sameDay(date, new Date()), isMuted: !inMonth, isRowStart: col === 0, isRowEnd: col === 6 };
  };

  const presetLabel = useMemo(
    () => presets.find(p => p.id === value.presetId)?.label,
    [presets, value.presetId]
  );
  const triggerText = triggerLabel ?? (
    value.from && value.to ? `${fmtLong(value.from)} — ${fmtLong(value.to)}` : 'בחר טווח תאריכים'
  );

  /* ---- Render ---- */
  return (
    <>
      {/* Trigger pill */}
      <button
        type="button"
        className={`drp-pill ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}>
        <span className="drp-cal-ico">{Icon.cal}</span>
        <span className="drp-range" dir="ltr">{triggerText}</span>
        {presetLabel && <span className="drp-badge">{presetLabel}</span>}
        <span className="drp-chev">{Icon.chevDown}</span>
      </button>

      {/* Portal: scrim + bottom sheet */}
      {open && portalReady && createPortal(
        <div style={{ pointerEvents: 'auto' }}>
          {/* Scrim */}
          <div
            style={{ position:'absolute', inset:0, background:'rgba(11,15,30,0.55)', backdropFilter:'blur(2px)' }}
            onClick={handleClose}
          />
          {/* Sheet — direction:rtl for Hebrew content, but positioned physically */}
          <div
            className={`drp-sheet ${closing ? 'is-closing' : ''}`}
            style={{ position:'absolute', left:0, right:0, bottom:0, direction:'rtl' }}
            role="dialog"
            aria-modal="true"
            aria-label="בורר טווח תאריכים">

            <div className="drp-handle-wrap"><div className="drp-handle"/></div>

            <div className="drp-head">
              <h3>טווח תאריכים</h3>
              <button type="button" className="drp-close" onClick={handleClose} aria-label="סגור">
                {Icon.x}
              </button>
            </div>

            {/* Range banner */}
            <div className="drp-banner">
              <button type="button" className={`drp-field ${editing==='from'?'is-focused':''}`} onClick={() => setEditing('from')}>
                <span className="drp-field-lbl">מתאריך</span>
                <span className="drp-field-val">{fmtLong(draftFrom) || '—'}</span>
              </button>
              <span className="drp-arrow">←</span>
              <button type="button" className={`drp-field ${editing==='to'?'is-focused':''}`} onClick={() => setEditing('to')}>
                <span className="drp-field-lbl">עד תאריך</span>
                <span className="drp-field-val">{fmtLong(draftTo) || '—'}</span>
              </button>
            </div>

            {/* Preset chips */}
            <div className="drp-presets-wrap">
              <div className="drp-presets-eyebrow">בחירה מהירה</div>
              <div className="drp-presets">
                {presets.map(p => (
                  <button key={p.id} type="button"
                    className={`drp-chip ${activePreset===p.id?'is-active':''}`}
                    onClick={() => handlePreset(p)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Calendar */}
            <div className="drp-cal">
              <div className="drp-cal-nav">
                <button type="button" className="drp-nav-btn" aria-label="חודש קודם"
                  onClick={() => setNavDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}>
                  {Icon.chevRight}
                </button>
                <span className="drp-month-label">
                  {HE_MONTHS_LONG[navDate.getMonth()]} {navDate.getFullYear()}
                </span>
                <button type="button" className="drp-nav-btn" aria-label="חודש הבא"
                  onClick={() => setNavDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}>
                  {Icon.chevLeft}
                </button>
              </div>

              <div className="drp-dow">
                {HE_DOW.map(d => <span key={d}>{d}</span>)}
              </div>

              <div className="drp-days">
                {grid.map(({ date, inMonth }, i) => {
                  const p = dayProps(date, inMonth);
                  const cls = ['drp-day', p.isMuted&&'is-muted', p.inRange&&'is-in-range',
                    p.isStart&&'is-range-start', p.isEnd&&'is-range-end', p.isToday&&'is-today',
                    p.isRowStart&&p.inRange&&'is-row-start', p.isRowEnd&&p.inRange&&'is-row-end',
                  ].filter(Boolean).join(' ');
                  return (
                    <button key={i} type="button" className={cls} onClick={() => handleDayClick(date)}>
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="drp-foot">
              <button type="button" className="drp-btn drp-btn-secondary" onClick={handleClose}>ביטול</button>
              <button type="button" className="drp-btn drp-btn-primary" onClick={handleConfirm} disabled={!draftFrom||!draftTo}>עדכן</button>
            </div>
          </div>
        </div>,
        portalRef.current
      )}
    </>
  );
}
