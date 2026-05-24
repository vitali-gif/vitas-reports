'use client'

// VITAS v2 Header — extracted from design_handoff_vitas_hitech_refresh/screen-2-hakol-v2.html
// 60px sticky, white with blur backdrop, logo + eyebrow + action buttons.
//
// Drop-in usage from admin/page.js:
//   <Header onExport={handleExport} onLogout={handleLogout} />

export default function Header({ onExport, onLogout, extraActions = null }) {
  return (
    <header className="header">
      <div className="header-content">
        <div className="header-brand">
          <img
            className="logo-img"
            src="/brand/vitas-logo-black.png"
            alt="VITAS"
            style={{ height: 28, display: 'block' }}
          />
          <span
            className="eyebrow"
            style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '0.18em',
              color: 'var(--text-3)', paddingRight: 16, marginRight: 16,
              borderRight: '1px solid var(--border)', textTransform: 'uppercase',
            }}
          >
            Real Estate Analytics
          </span>
        </div>
        <div className="header-actions header-nav" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {extraActions}
          {onExport && (
            <button className="nav-btn" onClick={onExport}>
              📊 ייצוא דוח
            </button>
          )}
          {onLogout && (
            <button className="nav-btn danger" onClick={onLogout}>
              יציאה
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
