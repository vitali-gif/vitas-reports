'use client';
import { useEffect, useRef, useState } from 'react';
// Optional Chart.js adapter. Parent supplies stable raw arrays. Null stays null.
// datasets: [{id,label,values:(number|null)[],colorKey?:'indigo'|'sky'|'violet'|'amber'|'emerald'}]
const colors={indigo:'#5B5EF4',sky:'#299BE4',violet:'#9257D1',amber:'#D99919',emerald:'#129989'};
export default function ResponseChart({ label, labels, datasets, unit, type='bar', horizontal=false }) {
  const canvas=useRef(null);
  const [failed,setFailed]=useState(false);
  const valid=labels.length>0 && datasets.length>0 && datasets.every(d=>d.values.length===labels.length && d.values.every(v=>v===null || (typeof v==='number' && Number.isFinite(v) && v>=0)));
  const hasValues=valid && datasets.some(d=>d.values.some(v=>v!==null));
  useEffect(()=>{
    let disposed=false, chart;
    setFailed(false);
    if(!hasValues || !canvas.current) return;
    import('chart.js/auto').then(({default:Chart})=>{
      if(disposed || !canvas.current) return;
      chart=new Chart(canvas.current,{
        type,
        data:{labels,datasets:datasets.map(d=>({label:d.label,data:d.values,backgroundColor:colors[d.colorKey] || colors.indigo,borderColor:colors[d.colorKey] || colors.indigo,borderWidth:2,tension:0.2,spanGaps:false}))},
        options:{responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',animation:window.matchMedia('(prefers-reduced-motion: reduce)').matches?false:undefined,
          plugins:{legend:{display:datasets.length>1,rtl:true,labels:{font:{family:'Heebo'}}},tooltip:{rtl:true,titleFont:{family:'Heebo'},bodyFont:{family:'Heebo'}}},
          scales:{x:{beginAtZero:!horizontal?undefined:true,ticks:{font:{family:'Heebo'}}},y:{beginAtZero:!horizontal,ticks:{font:{family:'Heebo'}}}}}
      });
    }).catch(()=>{if(!disposed)setFailed(true);});
    return ()=>{disposed=true;chart?.destroy();};
  },[labels,datasets,hasValues,type,horizontal]);
  if(!valid) return <p className="vr-caption">אין נתונים תקינים להצגת התרשים</p>;
  return <div className="vrt-chart">
    {!hasValues ? <p className="vr-caption">אין נתון לתקופה שנבחרה</p> : <>
      <p className="vrt-unit">{unit}</p><div className="vrt-canvas"><canvas ref={canvas} role="img" aria-label={`${label} — הערכים זמינים בטבלה שמתחת`} /></div>
      {failed && <p role="status">התרשים אינו זמין; הנתונים מוצגים בטבלה.</p>}
    </>}
    <details className="vrt-chart-data"><summary>הצגת הנתונים בטבלה</summary><div className="vr-table-wrap"><table className="vr-table"><caption>{label} · {unit}</caption><thead><tr><th scope="col">פילוח</th>{datasets.map(d=><th scope="col" key={d.id}>{d.label}</th>)}</tr></thead><tbody>{labels.map((text,i)=><tr key={`${i}-${text}`}><th scope="row">{text}</th>{datasets.map(d=><td key={d.id}><bdi>{d.values[i] ?? 'אין נתון'}</bdi></td>)}</tr>)}</tbody></table></div></details>
  </div>;
}
