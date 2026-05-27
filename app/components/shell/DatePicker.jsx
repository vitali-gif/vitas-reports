'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

const HE_MONTHS_SHORT = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳']
const DOW = ['א','ב','ג','ד','ה','ו','ש']

const PRESET_LABELS = {
  today: 'היום', yesterday: 'אתמול',
  last7: '7 ימים אחרונים', last14: '14 ימים אחרונים',
  last28: '28 ימים אחרונים', last30: '30 ימים אחרונים',
  last90: '90 ימים אחרונים',
  currentMonth: 'החודש הנוכחי', lastMonth: 'חודש שעבר',
  currentYear: 'השנה הנוכחית', lastYear: 'השנה שעברה',
  custom: 'טווח גמיש',
}

const PRESET_LIST = [
  { key: 'today',         label: 'היום' },
  { key: 'yesterday',     label: 'אתמול' },
  { key: 'last7',         label: '7 ימים אחרונים' },
  { key: 'last14',        label: '14 ימים אחרונים' },
  { key: 'last28',        label: '28 ימים אחרונים' },
  { key: 'last30',        label: '30 ימים אחרונים' },
  { key: 'currentMonth',  label: 'החודש הנוכחי' },
  { key: 'lastMonth',     label: 'חודש שעבר' },
  { key: 'last90',        label: '90 ימים אחרונים' },
  { key: 'currentYear',   label: 'השנה הנוכחית' },
  { key: 'lastYear',      label: 'השנה שעברה' },
  { key: 'custom',        label: 'טווח מותאם אישית' },
]

function toYMD(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function presetToRange(key) {
  const t = new Date()
  const ago = n => { const d = new Date(t); d.setDate(d.getDate() - n); return d }
  const ymd = toYMD
  if (key === 'today')       { const s = ymd(t); return [s, s] }
  if (key === 'yesterday')   { const s = ymd(ago(1)); return [s, s] }
  if (key === 'last7')       return [ymd(ago(7)),  ymd(ago(1))]
  if (key === 'last14')      return [ymd(ago(14)), ymd(ago(1))]
  if (key === 'last28')      return [ymd(ago(28)), ymd(ago(1))]
  if (key === 'last30')      return [ymd(ago(30)), ymd(ago(1))]
  if (key === 'last90')      return [ymd(ago(90)), ymd(ago(1))]
  if (key === 'currentMonth') return [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)]
  if (key === 'lastMonth') {
    const y = t.getMonth() === 0 ? t.getFullYear() - 1 : t.getFullYear()
    const m = t.getMonth() === 0 ? 11 : t.getMonth() - 1
    return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))]
  }
  if (key === 'currentYear') return [ymd(new Date(t.getFullYear(), 0, 1)), ymd(t)]
  if (key === 'lastYear') {
    const y = t.getFullYear() - 1
    return [ymd(new Date(y, 0, 1)), ymd(new Date(y, 11, 31))]
  }
  return null
}

function formatDateHe(ymd) {
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  return `${d} ב${HE_MONTHS_SHORT[m - 1]} ${y}`
}

function getCalDays(year, month) {
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevDays = new Date(year, month, 0).getDate()
  const cells = []
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevDays - i)
    cells.push({ d, cur: false, ymd: toYMD(d) })
  }
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i)
    cells.push({ d, cur: true, ymd: toYMD(d) })
  }
  const rem = 42 - cells.length
  for (let i = 1; i <= rem; i++) {
    const d = new Date(year, month + 1, i)
    cells.push({ d, cur: false, ymd: toYMD(d) })
  }
  return cells
}

function prevMonthOf(year, month) {
  return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
}
function nextMonthOf(year, month) {
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
}

// ─── Calendar sub-component ─────────────────────────────────────────────────
function CalGrid({ year, month, tempStart, tempEnd, pickMode, hoverYmd, todayYmd, onClickDay, onHoverDay }) {
  const days = getCalDays(year, month)
  const effectiveEnd = pickMode === 'end' && hoverYmd && hoverYmd >= tempStart ? hoverYmd : tempEnd
  const lo = tempStart && effectiveEnd ? (tempStart < effectiveEnd ? tempStart : effectiveEnd) : tempStart
  const hi = tempStart && effectiveEnd ? (tempStart > effectiveEnd ? tempStart : effectiveEnd) : tempStart

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 6 }}>
        {DOW.map(d => (
          <span key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', padding: '4px 0' }}>{d}</span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
        {days.map((cell, i) => {
          const col = i % 7
          const isRowStart = col === 0
          const isRowEnd = col === 6
          const isStart = lo && cell.ymd === lo
          const isEnd = hi && cell.ymd === hi && hi !== lo
          const isSolo = lo && cell.ymd === lo && lo === hi
          const inRange = lo && hi && cell.ymd > lo && cell.ymd < hi
          const isToday = cell.ymd === todayYmd
          const isMuted = !cell.cur

          // circle style
          let circBg = 'transparent', circColor = isMuted ? 'var(--text-4)' : 'var(--text)'
          let circFont = 500, circShadow = 'none', circRadius = '50%'
          if (isStart || isEnd || isSolo) {
            circBg = 'var(--indigo)'; circColor = 'white'; circFont = 700
            circShadow = '0 2px 8px -2px rgba(91,94,244,0.4)'
          }
          if (isToday && !isStart && !isEnd && !isSolo) {
            circColor = 'var(--indigo)'; circFont = 800
          }

          // strip style (half-width indigo-50 bar connecting circle to range)
          let stripStyle = null
          if ((isStart || isSolo) && !isRowEnd && (isEnd === false) && (inRange || (hi && !isSolo))) {
            // range-start: strip extends to the left (toward lower days in RTL)
            stripStyle = { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%', background: 'var(--indigo-50)', zIndex: 0 }
          }
          if (isEnd && !isRowStart) {
            // range-end: strip extends to the right (toward higher days in RTL)
            stripStyle = { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%', background: 'var(--indigo-50)', zIndex: 0 }
          }

          // row background
          let rowBg = 'transparent', rowBorderRadius = 0
          if (inRange) {
            rowBg = 'var(--indigo-50)'
            if (isRowStart && isRowEnd) rowBorderRadius = '999px'
            else if (isRowStart) rowBorderRadius = '0 999px 999px 0'
            else if (isRowEnd) rowBorderRadius = '999px 0 0 999px'
          }

          return (
            <div
              key={cell.ymd + i}
              style={{ position: 'relative', height: 32, cursor: 'pointer', userSelect: 'none' }}
              onClick={() => onClickDay(cell.ymd)}
              onMouseEnter={() => onHoverDay(cell.ymd)}
              onMouseLeave={() => onHoverDay(null)}
            >
              {/* range background */}
              {(inRange) && (
                <div style={{ position: 'absolute', inset: 0, background: rowBg, borderRadius: rowBorderRadius, pointerEvents: 'none' }} />
              )}
              {/* endpoint strip */}
              {stripStyle && <div style={{...stripStyle, pointerEvents: 'none'}} />}
              {/* circle / number */}
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 2,
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: circRadius,
                  background: circBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: circFont, color: circColor,
                  boxShadow: circShadow, fontVariantNumeric: 'tabular-nums',
                  cursor: 'pointer', transition: 'background .1s',
                }}>
                  {cell.d.getDate()}
                  {isToday && (
                    <span style={{
                      position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)',
                      width: 3, height: 3, borderRadius: '50%',
                      background: (isStart || isEnd || isSolo) ? 'white' : 'var(--indigo)',
                      pointerEvents: 'none',
                    }} />
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main DatePicker component ───────────────────────────────────────────────
export default function DatePicker({ activePreset, since, until, onApplyPreset, onApplyRange }) {
  const [open, setOpen] = useState(false)
  const [tempPreset, setTempPreset] = useState(activePreset || 'lastMonth')
  const [tempStart, setTempStart] = useState(since || '')
  const [tempEnd, setTempEnd] = useState(until || '')
  const [pickMode, setPickMode] = useState('done') // 'start' | 'end' | 'done'
  const [hoverYmd, setHoverYmd] = useState(null)
  const todayYmd = toYMD(new Date())

  // Left calendar = more recent month; right = one month before
  const [viewLeft, setViewLeft] = useState(() => {
    const ref = until || since || todayYmd
    const [y, m] = ref.split('-').map(Number)
    return { year: y, month: m - 1 }
  })
  const viewRight = prevMonthOf(viewLeft.year, viewLeft.month)

  const wrapRef = useRef(null)
  const triggerRef = useRef(null)
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0, width: 760, isMobile: false })

  // Compute fixed position when opening
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const isMobile = vw <= 768
    if (isMobile) {
      const w = vw - 20
      setPopoverPos({ top: rect.bottom + 6, left: 10, width: w, isMobile: true })
    } else {
      const pickerW = Math.min(760, vw - 24)
      let left = rect.right - pickerW
      if (left < 12) left = 12
      setPopoverPos({ top: rect.bottom + 10, left, width: pickerW, isMobile: false })
    }
  }, [open])

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return
    const update = () => {
      if (!triggerRef.current) return
      const rect = triggerRef.current.getBoundingClientRect()
      const vw = window.innerWidth
      const isMobile = vw <= 768
      if (isMobile) {
        const w = vw - 20
        setPopoverPos({ top: rect.bottom + 6, left: 10, width: w, isMobile: true })
      } else {
        const pickerW = Math.min(760, vw - 24)
        let left = rect.right - pickerW
        if (left < 12) left = 12
        setPopoverPos({ top: rect.bottom + 10, left, width: pickerW, isMobile: false })
      }
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [open])

  // Sync temp state when picker opens
  useEffect(() => {
    if (!open) return
    setTempPreset(activePreset || 'lastMonth')
    setPickMode('done')
    setHoverYmd(null)
    const range = activePreset && activePreset !== 'custom'
      ? presetToRange(activePreset)
      : [since || '', until || '']
    const s = range?.[0] || since || ''
    const u = range?.[1] || until || ''
    setTempStart(s)
    setTempEnd(u)
    if (u) {
      const [y, m] = u.split('-').map(Number)
      setViewLeft({ year: y, month: m - 1 })
    } else if (s) {
      const [y, m] = s.split('-').map(Number)
      setViewLeft({ year: y, month: m - 1 })
    }
  }, [open])

  // Click outside → close without applying
  useEffect(() => {
    if (!open) return
    const handle = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // ESC → close
  useEffect(() => {
    if (!open) return
    const handle = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open])

  const navMonth = delta => {
    setViewLeft(prev => {
      const { year, month } = delta > 0 ? nextMonthOf(prev.year, prev.month) : prevMonthOf(prev.year, prev.month)
      return { year, month }
    })
  }

  const selectPreset = key => {
    setTempPreset(key)
    if (key === 'custom') {
      setPickMode('start')
      setTempStart('')
      setTempEnd('')
    } else {
      setPickMode('done')
      const range = presetToRange(key)
      if (range) {
        setTempStart(range[0])
        setTempEnd(range[1])
        const [y, m] = range[1].split('-').map(Number)
        setViewLeft({ year: y, month: m - 1 })
      }
    }
  }

  const clickDay = ymd => {
    // If actively picking end date, complete the range
    if (pickMode === 'end' && tempStart) {
      if (ymd < tempStart) {
        // Clicked before start: restart selection from this date
        setTempStart(ymd)
        setTempEnd('')
      } else {
        setTempEnd(ymd)
        setPickMode('done')
      }
      return
    }
    // Otherwise start a new selection
    setTempPreset('custom')
    setTempStart(ymd)
    setTempEnd('')
    setPickMode('end')
  }

  const handleApply = () => {
    if (tempPreset !== 'custom') {
      onApplyPreset(tempPreset)
    } else if (tempStart && tempEnd) {
      onApplyRange(tempStart, tempEnd)
    } else if (tempStart) {
      // Single day → same start and end
      onApplyRange(tempStart, tempStart)
    }
    setOpen(false)
  }

  // Compute trigger label from current (applied) state
  const triggerPresetLabel = PRESET_LABELS[activePreset] || null
  const appliedRange = activePreset && activePreset !== 'custom' ? presetToRange(activePreset) : null
  const displaySince = since || appliedRange?.[0] || ''
  const displayUntil = until || appliedRange?.[1] || ''

  // Compute footer display range from temp state
  const footerSince = tempStart || ''
  const footerUntil = tempEnd || (pickMode === 'end' && hoverYmd ? hoverYmd : '')

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* ── Trigger button ─────────────────────────────────────── */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          height: 38, padding: '0 14px',
          background: open ? 'var(--indigo-50)' : 'var(--card)',
          border: `1px solid ${open ? 'var(--indigo)' : 'var(--border-strong, var(--border))'}`,
          borderRadius: 'var(--r-sm, 8px)',
          font: 'inherit', fontSize: 13, fontWeight: 600,
          color: 'var(--text)', cursor: 'pointer',
          boxShadow: open ? '0 0 0 3px rgba(91,94,244,0.12)' : '0 1px 2px rgba(11,15,30,0.06)',
          transition: 'all .15s',
          fontFamily: 'var(--font)',
        }}
      >
        {/* Calendar icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={open ? 'var(--indigo)' : 'var(--text-3)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        {/* Dates */}
        {displaySince && (
          <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {formatDateHe(displaySince)}
          </span>
        )}
        {displaySince && displayUntil && displaySince !== displayUntil && (
          <span style={{ color: 'var(--text-4)', margin: '0 2px' }}>←</span>
        )}
        {displayUntil && displaySince !== displayUntil && (
          <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
            {formatDateHe(displayUntil)}
          </span>
        )}
        {/* Preset badge */}
        {triggerPresetLabel && (
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: '0.05em',
            color: 'var(--indigo)', background: 'var(--indigo-100, var(--indigo-50))',
            padding: '3px 9px', borderRadius: 999,
          }}>
            {triggerPresetLabel}
          </span>
        )}
        {/* Chevron */}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke={open ? 'var(--indigo)' : 'var(--text-3)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* ── Popover ─────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'fixed', top: popoverPos.top, left: popoverPos.left,
          width: popoverPos.width, background: 'var(--card)',
          border: '1px solid var(--border)', borderRadius: 16,
          boxShadow: '0 24px 48px -16px rgba(11,15,30,0.18), 0 4px 12px rgba(11,15,30,0.06)',
          zIndex: 9999, overflow: 'hidden',
          maxHeight: 'calc(100vh - ' + popoverPos.top + 'px - 16px)',
          overflowY: 'auto',
        }}>

          {/* ── MOBILE layout ── */}
          {popoverPos.isMobile ? (
            <div>
              {/* Presets grid — 3 columns */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 6, padding: '12px 12px 8px',
                borderBottom: '1px solid var(--border)',
              }}>
                {PRESET_LIST.filter(p => p.key !== 'custom').map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => selectPreset(p.key)}
                    style={{
                      padding: '7px 4px', borderRadius: 8, cursor: 'pointer',
                      background: tempPreset === p.key ? 'var(--indigo)' : 'var(--surface)',
                      border: '1px solid ' + (tempPreset === p.key ? 'var(--indigo)' : 'var(--border)'),
                      font: 'inherit', fontSize: 11, fontWeight: 700,
                      color: tempPreset === p.key ? 'white' : 'var(--text-2)',
                      textAlign: 'center', lineHeight: 1.3,
                      fontFamily: 'var(--font)',
                    }}
                  >{p.label}</button>
                ))}
                <button
                  key="custom"
                  type="button"
                  onClick={() => selectPreset('custom')}
                  style={{
                    padding: '7px 4px', borderRadius: 8, cursor: 'pointer',
                    background: tempPreset === 'custom' ? 'var(--indigo)' : 'var(--surface)',
                    border: '1px solid ' + (tempPreset === 'custom' ? 'var(--indigo)' : 'var(--border)'),
                    font: 'inherit', fontSize: 11, fontWeight: 700,
                    color: tempPreset === 'custom' ? 'white' : 'var(--text-2)',
                    textAlign: 'center', gridColumn: 'span 3',
                    fontFamily: 'var(--font)',
                  }}
                >טווח מותאם אישית</button>
              </div>

              {/* Single calendar */}
              <div style={{ padding: '12px 12px 0' }}>
                {/* Month nav */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  paddingBottom: 10, borderBottom: '1px solid var(--border)', marginBottom: 10,
                }}>
                  <button type="button" onClick={() => navMonth(-1)}
                    style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {HE_MONTHS_SHORT[viewLeft.month]} {viewLeft.year}
                  </span>
                  <button type="button" onClick={() => navMonth(1)}
                    style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                </div>
                <CalGrid
                  year={viewLeft.year} month={viewLeft.month}
                  tempStart={tempStart} tempEnd={tempEnd}
                  pickMode={pickMode} hoverYmd={hoverYmd} todayYmd={todayYmd}
                  onClickDay={clickDay} onHoverDay={setHoverYmd}
                />
              </div>

              {/* Footer */}
              <div style={{
                background: 'var(--surface)', borderTop: '1px solid var(--border)',
                padding: '10px 12px', marginTop: 10,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                  {footerSince ? formatDateHe(footerSince) : '-'}
                  {footerUntil && footerSince !== footerUntil ? ' ← ' + formatDateHe(footerUntil) : ''}
                </div>
                <button type="button" onClick={() => setOpen(false)}
                  style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)' }}>
                  ביטול
                </button>
                <button type="button" onClick={handleApply}
                  disabled={tempPreset === 'custom' && !tempStart}
                  style={{ height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--indigo)', color: 'white', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)', opacity: (tempPreset === 'custom' && !tempStart) ? 0.5 : 1 }}>
                  עדכן
                </button>
              </div>
            </div>

          ) : (
            /* ── DESKTOP layout (original) ── */
            <div>
              {/* Pointer triangle */}
              <div style={{
                position: 'absolute', top: -7, right: 28,
                width: 12, height: 12,
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderBottom: 'none', borderLeft: 'none',
                transform: 'rotate(-45deg)',
                borderTopRightRadius: 2,
              }} />

              {/* ── Main grid: calendars | presets ──────────────── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 175px', minHeight: 360 }}>

                {/* LEFT: dual calendars */}
                <div style={{ padding: '14px 16px 0' }}>
                  {/* Month navigation */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 14, paddingBottom: 14, borderBottom: '1px solid var(--border)', marginBottom: 14,
                  }}>
                    <button
                      type="button" onClick={() => navMonth(-1)}
                      style={{
                        width: 30, height: 30, borderRadius: 8, background: 'transparent',
                        border: '1px solid transparent', color: 'var(--text-2)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
                          {HE_MONTHS_SHORT[viewRight.month]} {viewRight.year}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
                          {HE_MONTHS_SHORT[viewLeft.month]} {viewLeft.year}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button" onClick={() => navMonth(1)}
                      style={{
                        width: 30, height: 30, borderRadius: 8, background: 'transparent',
                        border: '1px solid transparent', color: 'var(--text-2)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6"/>
                      </svg>
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, paddingBottom: 14 }}>
                    <CalGrid
                      year={viewRight.year} month={viewRight.month}
                      tempStart={tempStart} tempEnd={tempEnd}
                      pickMode={pickMode} hoverYmd={hoverYmd} todayYmd={todayYmd}
                      onClickDay={clickDay} onHoverDay={setHoverYmd}
                    />
                    <CalGrid
                      year={viewLeft.year} month={viewLeft.month}
                      tempStart={tempStart} tempEnd={tempEnd}
                      pickMode={pickMode} hoverYmd={hoverYmd} todayYmd={todayYmd}
                      onClickDay={clickDay} onHoverDay={setHoverYmd}
                    />
                  </div>
                </div>

                {/* RIGHT: presets sidebar */}
                <aside style={{
                  background: 'var(--surface, #F5F7FB)', borderRight: '1px solid var(--border)',
                  padding: '18px 14px', display: 'flex', flexDirection: 'column',
                  gap: 2, overflowY: 'auto',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: '0.12em',
                    color: 'var(--text-3)', textTransform: 'uppercase',
                    padding: '0 12px 8px',
                  }}>
                    תקופות
                  </div>
                  {PRESET_LIST.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => selectPreset(p.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                        background: tempPreset === p.key ? 'var(--card)' : 'transparent',
                        border: 'none', font: 'inherit',
                        fontSize: 13, fontWeight: tempPreset === p.key ? 700 : 600,
                        color: tempPreset === p.key ? 'var(--indigo)' : 'var(--text-2)',
                        textAlign: 'right', width: '100%',
                        boxShadow: tempPreset === p.key ? '0 1px 2px rgba(11,15,30,0.06)' : 'none',
                        transition: 'all .12s',
                        fontFamily: 'var(--font)',
                      }}
                    >
                      {p.label}
                      <span style={{
                        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                        marginRight: 'auto', position: 'relative',
                        border: '1.5px solid ' + (tempPreset === p.key ? 'var(--indigo)' : 'var(--border-strong, var(--border))'),
                        background: tempPreset === p.key ? 'var(--indigo)' : 'transparent',
                        transition: 'all .12s',
                      }}>
                        {tempPreset === p.key && (
                          <span style={{
                            position: 'absolute', inset: 3, borderRadius: '50%',
                            background: 'var(--card)',
                          }} />
                        )}
                      </span>
                    </button>
                  ))}
                </aside>
              </div>

              {/* ── Desktop Footer ── */}
              <div style={{
                background: 'var(--surface, #F5F7FB)', borderTop: '1px solid var(--border)',
                padding: '12px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: 'var(--card)', border: '1px solid var(--border-strong, var(--border))',
                    borderRadius: 8, padding: '8px 12px',
                    fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
                    boxShadow: '0 1px 2px rgba(11,15,30,0.06)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: '0.10em',
                      color: 'var(--text-3)', textTransform: 'uppercase',
                      paddingLeft: 8, borderLeft: '1px solid var(--border)', marginLeft: 0,
                    }}>מתאריך</span>
                    <span dir="ltr">{footerSince ? formatDateHe(footerSince) : '-'}</span>
                  </div>
                  <span style={{ color: 'var(--text-3)', fontSize: 14 }}>←</span>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: 'var(--card)', border: '1px solid var(--border-strong, var(--border))',
                    borderRadius: 8, padding: '8px 12px',
                    fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
                    boxShadow: '0 1px 2px rgba(11,15,30,0.06)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: '0.10em',
                      color: 'var(--text-3)', textTransform: 'uppercase',
                      paddingLeft: 8, borderLeft: '1px solid var(--border)', marginLeft: 0,
                    }}>עד תאריך</span>
                    <span dir="ltr">{footerUntil ? formatDateHe(footerUntil) : (pickMode === 'end' ? '...' : '-')}</span>
                  </div>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text-3)', marginRight: 'auto', paddingRight: 14 }}>
                  שעון ירושלים
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    style={{
                      height: 34, padding: '0 16px', borderRadius: 8,
                      font: 'inherit', fontSize: 13, fontWeight: 700,
                      cursor: 'pointer', border: '1px solid var(--border-strong, var(--border))',
                      background: 'var(--card)', color: 'var(--text)',
                      fontFamily: 'var(--font)',
                    }}
                  >
                    ביטול
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={tempPreset === 'custom' && !tempStart}
                    style={{
                      height: 34, padding: '0 16px', borderRadius: 8,
                      font: 'inherit', fontSize: 13, fontWeight: 700,
                      cursor: 'pointer', border: '1px solid transparent',
                      background: 'var(--indigo)', color: 'white',
                      boxShadow: '0 4px 12px -4px rgba(91,94,244,0.5)',
                      opacity: (tempPreset === 'custom' && !tempStart) ? 0.5 : 1,
                      fontFamily: 'var(--font)',
                    }}
                  >
                    עדכן
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
