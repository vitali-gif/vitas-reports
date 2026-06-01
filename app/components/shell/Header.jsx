'use client'

// VITAS v2 Header — design-v2-playbook classes (h-brand / h-actions / btn)
// Mobile: hamburger ☰ (right, RTL) · VITAS logo (center) · kebab ⋮ + logout (left)
// Desktop: logo + pipe + eyebrow · spacer · export · client-access · logout
//
// Props:
//   onMenuOpen       — opens the mobile sidebar drawer
//   onExport         — Export button handler
//   onClientAccess   — Client-Access button handler
//   onLogout         — Logout button handler
//   loadingIndicator — optional JSX (spinner while fetching)

export default function Header({ onMenuOpen, onExport, onClientAccess, onSessionLogs, onLogout, loadingIndicator = null }) {
  return (
    <header className="header">

      {/* MOBILE ONLY: hamburger — opens the drawer.
          CSS (.h-hamburger) is display:none on desktop, display:inline-flex on ≤768px */}
      <button
        type="button"
        className="h-hamburger"
        onClick={onMenuOpen}
        aria-label="פתח תפריט"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <line x1="2" y1="4.5" x2="16" y2="4.5"/>
          <line x1="2" y1="9"   x2="16" y2="9"/>
          <line x1="2" y1="13.5" x2="16" y2="13.5"/>
        </svg>
      </button>

      {/* Brand: logo · pipe · eyebrow */}
      <div className="h-brand">
        <img src="/brand/vitas-logo-black.png" alt="VITAS" />
        <div className="pipe" />
        <span className="eyebrow">REPORTS</span>
      </div>

      <div className="h-spacer" />

      {/* Loading spinner (optional) */}
      {loadingIndicator}

      <div className="h-actions">
        {/* Export — hidden on mobile, surfaces in drawer */}
        {onExport && (
          <button className="btn btn-export" onClick={onExport} title="ייצוא לאקסל">
            📤 ייצוא לאקסל
          </button>
        )}

        {/* Client Access — hidden on mobile, surfaces in drawer */}
        {onClientAccess && (
          <button className="btn btn-client-access" onClick={onClientAccess} title="ניהול גישת לקוחות">
            🔗 גישת לקוחות
          </button>
        )}

        {/* Session Logs */}
        {onSessionLogs && (
          <button className="btn btn-outline" onClick={onSessionLogs} title="לוג כניסות לקוחות">
            👁 לוג לקוחות
          </button>
        )}

        {/* MOBILE ONLY: kebab — placeholder for future overflow menu */}
        <button
          type="button"
          className="btn h-kebab btn-kebab"
          onClick={() => {}}
          aria-label="עוד פעולות"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5"  r="1.5"/>
            <circle cx="12" cy="12" r="1.5"/>
            <circle cx="12" cy="19" r="1.5"/>
          </svg>
        </button>

        {/* Logout — visible on both desktop and mobile */}
        {onLogout && (
          <button className="btn btn-logout danger" onClick={onLogout} aria-label="התנתק">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>התנתק</span>
          </button>
        )}
      </div>
    </header>
  );
}
