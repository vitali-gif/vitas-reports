'use client'

// Sparkline SVG component — used inside v2 KPI cards.
// Mockup reference: design_handoff_vitas_hitech_refresh/screen-2-hakol-v2.html
// "Sparkline SVG: 100×28 viewBox, area fill rgba(255,255,255,0.22), line stroke white 1.6px round, terminal dot r=2 white."
//
// Usage:
//   <Sparkline values={[3, 5, 4, 7, 6, 8, 10]} />
//
// All sparklines on a KPI card use white-on-gradient (the card's gradient bg
// shows through), so no color prop is needed — the SVG hard-codes white.

export default function Sparkline({ values = [], width = 100, height = 28 }) {
  if (!Array.isArray(values) || values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y];
  });

  const pathLine = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(' ');

  const pathArea = `${pathLine} L${width},${height} L0,${height} Z`;

  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      className="kpi-spark"
      aria-hidden="true"
      style={{ marginTop: 'auto', width: '100%', height: 28, display: 'block' }}
    >
      <path d={pathArea} fill="rgba(255,255,255,0.22)" />
      <path
        d={pathLine}
        fill="none"
        stroke="rgba(255,255,255,1)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2" fill="white" />
    </svg>
  );
}
