// Skeleton placeholder component used while dashboard data is loading.
// Mimics the structure: KPI grid + section title + chart pair + table.
// Pure CSS shimmer via .skel class in globals.css.
import React from 'react'

function KpiCardSkel() {
  return (
    <div className="kpi-card" aria-hidden="true">
      <div className="kpi-accent"></div>
      <span className="skel skel-kpi-icon"></span>
      <span className="skel skel-line skel-kpi-label"></span>
      <span className="skel skel-line skel-kpi-value"></span>
    </div>
  )
}

export default function SkeletonDashboard({ kpiCount = 8, withCharts = true, withTable = true }) {
  return (
    <div aria-busy="true" aria-label="טוען נתונים">
      {/* KPI grid */}
      <div className="kpi-grid">
        {Array.from({ length: kpiCount }).map((_, i) => <KpiCardSkel key={i} />)}
      </div>

      {/* Section title */}
      <div style={{ marginTop: 24 }}>
        <span className="skel skel-line skel-title"></span>
      </div>

      {/* Two chart placeholders */}
      {withCharts && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div className="kpi-card" aria-hidden="true">
            <span className="skel skel-block skel-chart"></span>
          </div>
          <div className="kpi-card" aria-hidden="true">
            <span className="skel skel-block skel-chart"></span>
          </div>
        </div>
      )}

      {/* Table placeholder */}
      {withTable && (
        <div className="kpi-card" aria-hidden="true" style={{ padding: 20 }}>
          <span className="skel skel-line skel-title"></span>
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="skel skel-block skel-table-row" style={{ marginBottom: 8 }}></span>
          ))}
        </div>
      )}
    </div>
  )
}
