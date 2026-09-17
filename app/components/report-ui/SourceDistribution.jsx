'use client';

import { useEffect, useRef, useState } from 'react';

// Optional replacement for the existing canvas. No global Chart.defaults edits.
// items = [{id,label,value:number|null}]. Pass a stable array from the adapter.
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
        data: { labels: items.map(item => item.label), datasets: [{ data: items.map(item => item.value), backgroundColor: ['#4559df', '#299be4', '#119e8c', '#e6a72f', '#9257d1', '#cb567c', '#586581'], borderColor: '#fff', borderWidth: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', animation: reducedMotion ? false : { duration: 250 }, plugins: { legend: { display: false }, tooltip: { rtl: true, textDirection: 'rtl', titleFont: { family: 'Heebo' }, bodyFont: { family: 'Heebo' } } } },
      });
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; chart?.destroy(); };
  }, [items, complete, total]);
  if (!complete) return <p className="vr-caption">אין נתונים מלאים להצגת ההתפלגות</p>;
  if (!total) return <p className="vr-caption">אין לידים לתקופה שנבחרה</p>;
  return <div className="vcs-distribution">
    <div className="vcs-chart-wrap">{failed ? <p role="status">התרשים אינו זמין; הנתונים מופיעים ברשימה</p> : <><canvas ref={canvas} aria-hidden="true" /><div className="vcs-chart-center" aria-hidden="true"><strong>{total.toLocaleString('he-IL')}</strong><span>סה״כ לידים</span></div></>}</div>
    <ul className="vcs-legend" aria-label="התפלגות לידים לפי מקור">{items.map((item, i) => <li key={item.id}><span className={`vcs-dot vcs-color-${i % 7}`} aria-hidden="true" /><span>{item.label}</span><strong><bdi>{item.value.toLocaleString('he-IL')} ({Math.round(item.value / total * 100)}%)</bdi></strong></li>)}</ul>
  </div>;
}
