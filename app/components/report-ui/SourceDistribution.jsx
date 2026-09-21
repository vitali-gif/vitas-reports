'use client';

import { useEffect, useRef, useState } from 'react';

// Optional replacement for the existing canvas. No global Chart.defaults edits.
// items = [{id,label,value:number|null}]. Pass a stable array from the adapter.
// VITAS: האחוזים מצוירים על הפרוסות עצמן (plugin מקומי), לא רק ב-tooltip — כמו בסקיצה.
const PALETTE = ['#4559df', '#299be4', '#119e8c', '#e6a72f', '#9257d1', '#cb567c', '#586581'];

const sliceLabels = {
  id: 'vrSliceLabels',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    const ds = chart.data.datasets[0];
    if (!meta || !ds) return;
    const total = ds.data.reduce((s, v) => s + (Number(v) || 0), 0);
    if (!total) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = '700 13px Heebo, Arial, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    meta.data.forEach((arc, i) => {
      const v = Number(ds.data[i]) || 0;
      const pct = v / total * 100;
      if (pct < 4.5) return;                         // פרוסה דקה מדי לטקסט קריא
      const angle = (arc.startAngle + arc.endAngle) / 2;
      const r = (arc.innerRadius + arc.outerRadius) / 2;
      ctx.fillText(Math.round(pct) + '%', arc.x + Math.cos(angle) * r, arc.y + Math.sin(angle) * r);
    });
    ctx.restore();
  },
};

export default function SourceDistribution({ items }) {
  const canvas = useRef(null);
  const [failed, setFailed] = useState(false);
  const complete = items.every(item => typeof item.value === 'number' && Number.isFinite(item.value) && item.value >= 0);
  const total = complete ? items.reduce((sum, item) => sum + item.value, 0) : null;
  useEffect(() => {
    let disposed = false;
    let chart;
    setFailed(false);
    if (!complete || !total || !canvas.current) return;
    import('chart.js/auto').then(({ default: Chart }) => {
      if (disposed || !canvas.current) return;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      chart = new Chart(canvas.current, {
        type: 'doughnut',
        data: { labels: items.map(item => item.label), datasets: [{ data: items.map(item => item.value), backgroundColor: items.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: '#fff', borderWidth: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%', animation: reducedMotion ? false : { duration: 250 }, plugins: { legend: { display: false }, tooltip: { rtl: true, textDirection: 'rtl', titleFont: { family: 'Heebo' }, bodyFont: { family: 'Heebo' } } } },
        plugins: [sliceLabels],
      });
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; chart?.destroy(); };
  }, [items, complete, total]);
  if (!complete) return <p className="vr-caption">אין נתונים מלאים להצגת ההתפלגות</p>;
  if (!total) return <p className="vr-caption">אין לידים לתקופה שנבחרה</p>;
  return <div className="vcs-distribution">
    <div className="vcs-chart-wrap">{failed ? <p role="status">התרשים אינו זמין; הנתונים מופיעים ברשימה</p> : <><canvas ref={canvas} aria-hidden="true" /><div className="vcs-chart-center" aria-hidden="true"><strong>{total.toLocaleString('he-IL')}</strong><span>סה״כ לידים</span></div></>}</div>
    <ul className="vcs-legend" aria-label="התפלגות לידים לפי מקור">{items.map((item, i) => <li key={item.id}><span className={`vcs-dot vcs-color-${i % 7}`} aria-hidden="true" /><span className="vcs-legend-label">{item.label}</span><strong><bdi>{item.value.toLocaleString('he-IL')}</bdi> <em>({Math.round(item.value / total * 100)}%)</em></strong></li>)}</ul>
  </div>;
}
