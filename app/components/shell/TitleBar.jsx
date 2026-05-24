'use client'

// VITAS v2 TitleBar — extracted from design_handoff_vitas_hitech_refresh/screen-2-hakol-v2.html
// Shows breadcrumb above H1, with period pill + comparison toggle on the right.
//
// Drop-in usage from admin/page.js:
//   <TitleBar
//     crumb={['סקירה חודשית', 'HI PARK', '5 חודשים']}
//     client={'ש.ברוך'}
//     project={'HI PARK'}
//     dateRange={'19.05.26 – 19.10.26'}
//     comparisonOn={true}
//     onToggleComparison={() => setCompare(c => !c)}
//     onClickDateRange={() => setDatePickerOpen(true)}
//   />

export default function TitleBar({
  crumb = [],
  client,
  project,
  dateRange,
  comparisonOn = false,
  onToggleComparison,
  onClickDateRange,
}) {
  return (
    <div
      className="title-bar"
      style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 24, marginBottom: 28,
      }}
    >
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

      <div className="controls" style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        {dateRange && (
          <button
            className="pill-dd"
            onClick={onClickDateRange}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '9px 14px', background: 'var(--card)',
              border: '1px solid var(--border)', borderRadius: 999,
              fontSize: 13, fontWeight: 700, color: 'var(--text)',
              fontFamily: 'var(--font)', cursor: 'pointer',
              transition: 'all var(--dur) var(--ease-out)',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--text-3)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              תקופה
            </span>
            <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{dateRange}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 10 }}>▾</span>
          </button>
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
  );
}
