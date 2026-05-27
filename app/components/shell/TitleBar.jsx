'use client'
import DatePicker from './DatePicker'
import DateRangePicker from './DateRangePicker'

// ── Mobile presets (IDs match the existing DatePicker keys) ──────────────────
const sod = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const agoD = (n) => { const d = sod(new Date()); d.setDate(d.getDate() - n); return d }

const MOBILE_PRESETS = [
  { id: 'today',        label: 'היום',      range: () => { const t = sod(new Date()); return { from: t, to: t } } },
  { id: 'yesterday',    label: 'אתמול',     range: () => { const t = agoD(1); return { from: t, to: t } } },
  { id: 'last7',        label: '7 ימים',    range: () => ({ from: agoD(7),  to: agoD(1) }) },
  { id: 'last14',       label: '14 ימים',   range: () => ({ from: agoD(14), to: agoD(1) }) },
  { id: 'last30',       label: '30 ימים',   range: () => ({ from: agoD(30), to: agoD(1) }) },
  { id: 'currentMonth', label: 'החודש',     range: () => { const t = sod(new Date()); return { from: new Date(t.getFullYear(), t.getMonth(), 1), to: t } } },
  { id: 'lastMonth',    label: 'חודש שעבר', range: () => {
    const t = sod(new Date())
    const y = t.getMonth() === 0 ? t.getFullYear() - 1 : t.getFullYear()
    const m = t.getMonth() === 0 ? 11 : t.getMonth() - 1
    return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) }
  }},
  { id: 'last90',       label: '90 ימים',   range: () => ({ from: agoD(90), to: agoD(1) }) },
  { id: 'currentYear',  label: 'השנה',      range: () => { const t = sod(new Date()); return { from: new Date(t.getFullYear(), 0, 1), to: t } } },
]

const toYMD = (d) => d
  ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  : ''

const fromYMD = (s) => s ? new Date(s + 'T00:00:00') : null

export default function TitleBar({
  crumb = [],
  client,
  project,
  activePreset,
  since,
  until,
  onApplyPreset,
  onApplyRange,
  comparisonOn = false,
  onToggleComparison,
}) {
  const drpValue = {
    from: fromYMD(since),
    to:   fromYMD(until),
    presetId: activePreset === 'custom' ? null : (activePreset || null),
  }

  const handleDrpChange = ({ from, to, presetId }) => {
    if (presetId && presetId !== 'custom') {
      onApplyPreset?.(presetId)
    } else {
      onApplyRange?.(toYMD(from), toYMD(to))
    }
  }

  return (
    <div
      className="title-bar"
      style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 24, marginBottom: 28,
      }}
    >
      {/* Left: breadcrumb + title */}
      <div>
        {crumb.length > 0 && (
          <div
            className="crumb"
            style={{
              fontSize: 13, fontWeight: 700, letterSpacing: '0.08em',
              color: 'var(--text-3)', textTransform: 'uppercase',
              marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {crumb.map((part, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <span style={{ color: 'var(--border)' }}>/</span>}
                <span dir={/^[a-zA-Z]/.test(part) ? 'ltr' : undefined}>{part}</span>
              </span>
            ))}
          </div>
        )}
        <h1
          style={{
            fontSize: 38, fontWeight: 800,
            letterSpacing: '-0.025em', lineHeight: 0.98,
            color: 'var(--text)', margin: 0,
            display: 'flex', alignItems: 'baseline', gap: 14,
          }}
        >
          {client}
          {project && (
            <>
              <span style={{ color: 'var(--border)', fontWeight: 400 }}>/</span>
              <span dir="ltr">{project}</span>
            </>
          )}
        </h1>
      </div>

      {/* Right: date picker + comparison toggle */}
      <div className="controls" style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        {onApplyPreset && (
          <>
            {/* Desktop: existing anchored popover */}
            <div className="drp-desktop-only">
              <DatePicker
                activePreset={activePreset}
                since={since}
                until={until}
                onApplyPreset={onApplyPreset}
                onApplyRange={onApplyRange}
              />
            </div>

            {/* Mobile: Claude Design bottom-sheet (portal → never clips) */}
            <div className="drp-mobile-only">
              <DateRangePicker
                value={drpValue}
                onChange={handleDrpChange}
                presets={MOBILE_PRESETS}
              />
            </div>
          </>
        )}

        {onToggleComparison && (
          <span
            className={`toggle ${comparisonOn ? '' : 'off'}`}
            onClick={onToggleComparison}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '9px 14px', background: 'var(--card)',
              border: '1px solid var(--border)', borderRadius: 999,
              fontSize: 13, fontWeight: 700, color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            השוואה לאותה תקופה
            <span
              style={{
                width: 32, height: 18, borderRadius: 999, position: 'relative',
                background: comparisonOn ? 'var(--indigo)' : 'var(--border)',
                transition: 'background var(--dur) var(--ease-out)',
              }}
            >
              <span
                style={{
                  position: 'absolute', width: 14, height: 14,
                  background: 'white', borderRadius: '50%',
                  top: 2, left: comparisonOn ? 2 : 'calc(100% - 16px)',
                  transition: 'left var(--dur) var(--ease-out)',
                }}
              />
            </span>
          </span>
        )}
      </div>
    </div>
  )
}
