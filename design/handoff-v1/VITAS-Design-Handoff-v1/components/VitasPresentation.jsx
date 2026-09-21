'use client';

import { useId } from 'react';
import { Info, ChevronDown, ChevronLeft, ImageOff } from 'lucide-react';

// Presentation only. All values, permissions, filters and business rules belong
// to existing VITAS adapters. No demo data or reports schema is assumed here.
const tones = new Set(['indigo', 'emerald', 'violet', 'sky', 'terra', 'amber', 'rose']);
const toneClass = (tone) => `vr-tone-${tones.has(tone) ? tone : 'indigo'}`;

export function VitasPresentation({ children, className = '' }) {
  return <div dir="rtl" className={`vr-ui ${className}`}>{children}</div>;
}

export function DataState({ state = 'ready', message, onRetry, children }) {
  if (state === 'ready') return children;
  return <div className="vr-state" role={state === 'error' ? 'alert' : 'status'} aria-busy={state === 'loading'}>
    <p>{message || ({ loading: 'טוען את נתוני הפרויקט…', error: 'לא ניתן לטעון את הנתונים', missing: 'מקור הנתונים אינו מחובר', empty: 'אין נתונים לתקופה שנבחרה' }[state] || 'אין נתונים')}</p>
    {state === 'error' && onRetry && <button type="button" className="vr-button" onClick={onRetry}>ניסיון נוסף</button>}
  </div>;
}

export function ReportSection({ title, description, actions, children }) {
  const id = useId();
  return <section className="vr-section" aria-labelledby={id}>
    <div className="vr-section-heading"><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="vr-actions">{actions}</div>}</div>
    {children}
  </section>;
}

export function MetricCard({ label, value, description, tone = 'indigo', icon: Icon, trend, details }) {
  const hintId = useId();
  return <article className={`vr-metric ${toneClass(tone)}`}>
    <div className="vr-metric-top">
      {Icon && <span className="vr-metric-icon"><Icon aria-hidden="true" size={22} strokeWidth={1.7} /></span>}
      <h3>{label}</h3>
    </div>
    <p className="vr-metric-value"><bdi>{value ?? 'אין נתון'}</bdi></p>
    {description && <p className="vr-metric-note">{description}</p>}
    {trend && <div className="vr-metric-trend">{trend}</div>}
    {details && <details className="vr-help"><summary aria-describedby={hintId}><Info size={16} aria-hidden="true" /><span>הסבר המדד</span></summary><p id={hintId}>{details}</p></details>}
  </article>;
}

export function MetricGrid({ metrics }) {
  return <div className="vr-metric-grid">{metrics.map(({ id, ...metric }) => <MetricCard key={id} {...metric} />)}</div>;
}

// Supply denominatorLabel with every rate. Never calculate cross-population
// ratios here. The screenshot is not a source of funnel values or formulas.
export function Funnel({ items, description }) {
  return <div className="vr-funnel-panel">
    {description && <p className="vr-caption">{description}</p>}
    <ol className="vr-funnel">{items.map(({ id, label, value, rate, denominatorLabel, tone, icon: Icon }) => <li key={id} className={`vr-funnel-step ${toneClass(tone)}`}>
      <div className="vr-funnel-label">{Icon && <Icon size={18} aria-hidden="true" />}<h3>{label}</h3></div>
      <p className="vr-funnel-value"><bdi>{value ?? 'אין נתון'}</bdi></p>
      {rate != null && <p className="vr-caption"><bdi>{rate}</bdi>{' '}{denominatorLabel}</p>}
    </li>)}</ol>
  </div>;
}

// rows: { id, cells: { [columnKey]: ReactNode }, children?: sameRow[] }
// Sorting is controlled by the parent. Only visible children are rendered.
// Row expansion is a keyboard-accessible button, not a clickable table row.
export function ReportTable({ caption, columns, rows, expandedIds = [], onToggle, sort, onSort, emptyText = 'אין נתונים לתקופה שנבחרה' }) {
  const expanded = new Set(expandedIds);
  const renderRows = (items, level = 0) => items.flatMap(row => {
    const canExpand = !!row.children?.length && !!onToggle;
    const open = expanded.has(row.id);
    return [<tr key={row.id} className={level ? 'vr-table-child' : ''}>
      {columns.map((column, i) => <td key={column.key} className={column.numeric ? 'vr-numeric' : ''}>
        {i === 0 ? <span className={`vr-row-name vr-level-${Math.min(level, 2)}`}>
          {canExpand && <button type="button" className="vr-icon-button" aria-expanded={open} aria-label={`${open ? 'סגור' : 'פתח'} פירוט ${row.accessibleLabel || ''}`} onClick={() => onToggle(row.id)}>{open ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}</button>}
          {row.cells[column.key] ?? '—'}
        </span> : <bdi>{row.cells[column.key] ?? '—'}</bdi>}
      </td>)}
    </tr>, ...(open && canExpand ? renderRows(row.children, level + 1) : [])];
  });
  return <div className="vr-table-wrap" role="region" aria-label={caption} tabIndex={0}>
    <table className="vr-table"><caption className="vr-sr-only">{caption}</caption>
      <thead><tr>{columns.map(column => <th key={column.key} scope="col" className={column.numeric ? 'vr-numeric' : ''} aria-sort={sort?.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
        {column.sortable && onSort ? <button type="button" className="vr-sort" onClick={() => onSort(column.key)}>{column.label}<span aria-hidden="true">{sort?.key === column.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span></button> : column.label}
      </th>)}</tr></thead>
      <tbody>{rows.length ? renderRows(rows) : <tr><td colSpan={columns.length} className="vr-table-empty">{emptyText}</td></tr>}</tbody>
    </table>
  </div>;
}

// Use original assets. Ratio comes from source width/height, not guessed from
// screenshot. Unknown ratios use native dimensions. No cropping, no stretching.
export function AdCard({ title, src, alt, ratio, metrics = [], destinationUrl, onOpen }) {
  const format = ratio === '1:1' ? 'square' : ratio === '16:9' ? 'wide' : 'native';
  return <article className="vr-ad">
    <div className={`vr-ad-media vr-ad-media-${format}`}>
      {src ? <img src={src} alt={alt || title} loading="lazy" /> : <div className="vr-ad-missing"><ImageOff aria-hidden="true" /><span>התצוגה המקדימה אינה זמינה</span></div>}
    </div>
    <div className="vr-ad-body"><h3>{title}</h3><dl className="vr-ad-metrics">{metrics.map(metric => <div key={metric.id}><dt>{metric.label}</dt><dd><bdi>{metric.value ?? 'אין נתון'}</bdi></dd></div>)}</dl>
      {onOpen ? <button type="button" className="vr-button" onClick={onOpen}>פרטי המודעה</button> : destinationUrl ? <a className="vr-button" href={destinationUrl} target="_blank" rel="noopener noreferrer">פתיחת המודעה</a> : null}
    </div>
  </article>;
}

export function AdGrid({ ads }) {
  return <div className="vr-ad-grid">{ads.map(({ id, ...ad }) => <AdCard key={id} {...ad} />)}</div>;
}

// Existing shell elements are slots: avoids copying permission/date logic.
// model is a new PRESENTATION contract, not a claim about current reports keys.
export function OverviewPresentation({ shell, model, state = 'ready', onRetry, onCampaignToggle, expandedCampaigns, onCampaignSort, campaignSort }) {
  if (state !== 'ready') return <VitasPresentation>{shell}<main className="vr-content"><DataState state={state} onRetry={onRetry} /></main></VitasPresentation>;
  return <VitasPresentation>
    {shell}
    <main className="vr-content">
      <DataState state={state} onRetry={onRetry}>
        <div className="vr-metrics-section"><p className="vr-caption">פעילות בתקופה · כולל פעילות מלידים שנכנסו לפני התקופה</p><MetricGrid metrics={model.metrics} /></div>
        <ReportSection title="משפך שיווקי" description={model.funnelSubtitle}><Funnel items={model.funnel} description={model.funnelScope} /></ReportSection>
        <ReportSection title="קמפיינים, קבוצות מודעות ומודעות" description="לחצו על כפתור הפירוט ליד קמפיין כדי לראות קבוצות ומודעות">
          <ReportTable {...model.campaigns} expandedIds={expandedCampaigns} onToggle={onCampaignToggle} sort={campaignSort} onSort={onCampaignSort} />
        </ReportSection>
        <ReportSection title="פילוח דמוגרפי"><ReportTable {...model.gender} /></ReportSection>
        <ReportSection title="פילוח גילאים"><ReportTable {...model.age} /></ReportSection>
        <ReportSection title="המודעות המובילות בפייסבוק"><AdGrid ads={model.facebookAds} /></ReportSection>
        <ReportSection title="המודעות המובילות בגוגל"><AdGrid ads={model.googleAds} /></ReportSection>
      </DataState>
    </main>
  </VitasPresentation>;
}
