'use client'

// VITAS v2 Tabs — top-level navigation between הכל / CRM / Facebook / Google / המלצות.
// Extracted from design_handoff_vitas_hitech_refresh/screen-2-hakol-v2.html
// Underlined active indicator + indigo badge for המלצות count.
//
// Drop-in usage from admin/page.js:
//   <Tabs
//     active={activeTab}
//     onChange={setActiveTab}
//     recommendationsCount={5}
//   />

const TABS = [
  { id: 'all',             label: 'הכל' },
  { id: 'crm',             label: 'CRM',      ltr: true },
  { id: 'facebook',        label: 'Facebook', ltr: true },
  { id: 'google',          label: 'Google',   ltr: true },
  { id: 'recommendations', label: '💡 המלצות חכמות' },
];

export default function Tabs({
  active = 'all',
  onChange,
  recommendationsCount = 0,
}) {
  return (
    <div className="client-tabs">
      {TABS.map(({ id, label, ltr }) => {
        const isActive = active === id;
        const isRecs = id === 'recommendations';
        return (
          <button
            key={id}
            className={`client-tab ${isActive ? 'active' : ''}`}
            onClick={() => onChange?.(id)}
          >
            {ltr ? <span dir="ltr">{label}</span> : label}
            {isRecs && recommendationsCount > 0 && (
              <span className="subtab-badge">{recommendationsCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
