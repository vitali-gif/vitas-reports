'use client'
import DatePicker from './DatePicker'

// VITAS v2 TitleBar - breadcrumb + H1 + date picker + comparison toggle
//
// Usage from admin/page.js:
//   <TitleBar
//     crumb={['סקירה', 'HI PARK', '']}
//     client={'ש.ברוך'}
//     project={'HI PARK'}
//     activePreset={'lastMonth'}
//     since={''}
//     until={''}
//     onApplyPreset={(key) => applyPreset(key)}
//     onApplyRange={(s, u) => applyCustomRange(s, u)}
//     comparisonOn={compareEnabled}
//     onToggleComparison={() => onComparisonToggle(!compareEnabled)}
//   />

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
          <DatePicker
            activePreset={activePreset}
            since={since}
            until={until}
            onApplyPreset={onApplyPreset}
            onApplyRange={onApplyRange}
          />
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
