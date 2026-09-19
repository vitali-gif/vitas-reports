'use client';

import { useId } from 'react';
import { Ban, Download, RefreshCw, Eye, MousePointerClick, ArrowLeft } from 'lucide-react';
import { VitasPresentation, MetricGrid, DataState, ReportSection } from './VitasPresentation';

export const SOURCE_COLUMNS = [
  ['source', 'מקור'], ['leads', 'סה״כ לידים'], ['relevant', 'רלוונטיים'],
  ['irrelevant', 'לא רלוונטיים'], ['scheduled', 'תואמו'], ['scheduleRate', '% תיאום'],
  ['attended', 'בוצעו'], ['attendRate', '% ביצוע'], ['cancelled', 'בוטלו'],
  ['registrations', 'הרשמות'], ['registrationValue', 'שווי הרשמות'],
  ['contracts', 'חוזים'], ['contractValue', 'שווי חוזים'],
].map(([key, label]) => ({ key, label }));

// Parent owns sorting, source attribution, filters, refresh and exports.
// Display strings are preformatted by the project's existing adapter.
export function SourceTable({ rows, total, sort, onSort, onOpenSource }) {
  const id = useId();
  const cells = (row, isTotal = false) => SOURCE_COLUMNS.map(({ key }) => {
    const value = row.cells[key] ?? 'אין נתון';
    return key === 'source'
      ? <th key={key} scope="row">{!isTotal && onOpenSource ? <button className="vcs-source-link" type="button" onClick={() => onOpenSource(row.id)}>{value}</button> : value}</th>
      : <td key={key}><bdi>{value}</bdi></td>;
  });
  return <div className="vcs-table-scroll" role="region" tabIndex={0} aria-labelledby={id}>
    <table className="vcs-table"><caption id={id} className="vr-sr-only">נתונים לפי מקור הגעה</caption>
      <thead><tr>{SOURCE_COLUMNS.map(({ key, label }) => <th scope="col" key={key} aria-sort={sort?.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
        {onSort ? <button className="vcs-sort" type="button" onClick={() => onSort(key)}>{label}<span aria-hidden="true">{sort?.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span></button> : label}
      </th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(row => <tr key={row.id}>{cells(row)}</tr>) : <tr><td colSpan={SOURCE_COLUMNS.length} className="vcs-empty">אין לידים לתקופה שנבחרה</td></tr>}</tbody>
      {total && <tfoot><tr>{cells(total, true)}</tr></tfoot>}
    </table>
  </div>;
}

// VITAS: פריסה לפי הסקיצה — כרטיסי נתוני פרסום (קליקים, חשיפות) בצד ההתחלה, בורר פלטפורמה במרכז,
// שלבים ככרטיסים לבנים עם אייקון ופס צד צבעוני, חץ עם אחוז המעבר בין השלבים, ענף ביטולים מתחת
// ל"פגישה נקבעה". stage: {id,label,value,rate,denominatorLabel,smallSample,icon,tone}.
const AD_ICONS = { impressions: Eye, impr: Eye, clicks: MousePointerClick, click: MousePointerClick };
export function CohortFunnel({ model, platforms, selectedPlatform, onPlatformChange, state = 'ready' }) {
  const labelId = useId();
  return <div className="vcs-panel">
    <div className="vcs-funnel-toolbar">
      {state === 'ready' && model && <div className="vcs-adcards">{model.advertising.map(item => { const Icon = AD_ICONS[item.id]; return <div key={item.id} className="vcs-adcard">{Icon && <span className="vcs-adcard-icon"><Icon size={18} aria-hidden="true" /></span>}<div><span className="vcs-adcard-label">{item.label}</span><strong><bdi>{item.value ?? 'אין נתון'}</bdi></strong></div></div>; })}</div>}
      {/* VITAS: בטאב Facebook/Google המשפך כבר מסונן לערוץ — אין בורר ואין הערת סינון */}
      {platforms.length > 0 && <div role="group" aria-labelledby={labelId} className="vcs-segmented">
        <span id={labelId} className="vr-sr-only">סינון המשפך לפי פלטפורמה</span>
        {platforms.map(platform => <button key={platform.id} type="button" aria-pressed={platform.id === selectedPlatform} disabled={!onPlatformChange} onClick={() => onPlatformChange(platform.id)}>{platform.label}</button>)}
      </div>}
      {platforms.length > 0 && <p className="vr-caption vcs-filter-note">הסינון חל על המשפך בלבד</p>}
    </div>
    <DataState state={state}>
      {state === 'ready' && model && <>
        <div className="vcs-funnel-scroll" role="region" aria-label="שלבי התקדמות הלידים" tabIndex={0}>
          <ol className="vcs-funnel">{model.stages.map((stage, i) => { const Icon = stage.icon; return <li key={stage.id} className="vcs-stage-column">
            <div className="vcs-stage-row">
              {i > 0 && <div className="vcs-arrow" aria-hidden="true"><ArrowLeft size={18} /><b>{stage.rate != null ? <bdi>{stage.smallSample ? '~' : ''}{stage.rate}</bdi> : '—'}</b></div>}
              <div className={`vcs-stage ${stage.tone ? 'vcs-tone-' + stage.tone : ''}`} title={stage.rate != null ? `${stage.rate} ${stage.denominatorLabel}` : undefined}>
                <div className="vcs-stage-head"><h3>{stage.label}</h3>{Icon && <span className="vcs-stage-icon"><Icon size={20} aria-hidden="true" /></span>}</div>
                <p className="vcs-stage-value"><bdi>{stage.value ?? 'אין נתון'}</bdi></p>
                {stage.rate != null && <p className="vcs-rate vr-sr-only">{stage.rate} {stage.denominatorLabel}</p>}
              </div>
            </div>
            {stage.id === model.cancellation?.parentStageId && <div className="vcs-cancellation"><Ban size={17} aria-hidden="true" /><span>בוטלו <strong><bdi>{model.cancellation.value ?? 'אין נתון'}</bdi></strong></span><small>{model.cancellation.denominatorLabel}</small></div>}
          </li>; })}</ol>
        </div>
        <p className="vr-caption vcs-transition-note">אחוזי המעבר מוצגים מהשלב הקודם; הרשמות וחוזים נמדדים מהפגישות שהתקיימו, וביטולים מהפגישות שנקבעו.</p>
        <p className="vr-caption">{model.scopeNote}</p>
        {model.stages.some(stage => stage.smallSample) && <p className="vr-caption">~ אחוז המבוסס על מדגם קטן; יש לפרש בזהירות.</p>}
      </>}
    </DataState>
  </div>;
}

// Render inside existing main. Existing shell/subtabs remain outside this view.
// chart is a slot: preserve the existing Chart.js lifecycle or use the optional
// SourceDistribution component supplied alongside this file.
export function CrmSources({ model, state = 'ready', onRetry, onRefresh, refreshing = false, platforms = [], selectedPlatform, onPlatformChange, funnelState = 'ready', sort, onSort, onExport, onOpenSource, chart, additionalContent }) {
  if (state !== 'ready') return <VitasPresentation className="vcs-root"><DataState state={state} onRetry={onRetry} /></VitasPresentation>;
  return <VitasPresentation className="vcs-root">
    <ReportSection title="מקורות הגעה" description="מהיכן מגיעים הלידים ואיך הם מתקדמים למכירה" actions={onRefresh && <button type="button" className="vr-button" disabled={refreshing} onClick={onRefresh}><RefreshCw size={16} aria-hidden="true" />{refreshing ? 'מרענן נתונים…' : 'רענון נתונים'}</button>}>
      <p className="vcs-metric-scope">{model.metricsScope}</p><MetricGrid metrics={model.metrics} />
    </ReportSection>
    <ReportSection title="משפך לידים"><CohortFunnel model={model.funnel} platforms={platforms} selectedPlatform={selectedPlatform} onPlatformChange={onPlatformChange} state={funnelState} /></ReportSection>
    <ReportSection title="נתונים לפי מקור הגעה" description={model.table.scopeNote} actions={onExport && <button type="button" className="vr-button" onClick={onExport}><Download size={16} aria-hidden="true" />ייצוא</button>}>
      <SourceTable {...model.table} sort={sort} onSort={onSort} onOpenSource={onOpenSource} /><p className="vcs-table-note">{model.table.rateNote}</p>
    </ReportSection>
    <ReportSection title="התפלגות לידים לפי מקור" description={model.distributionScope}><div className="vcs-panel">{chart || <p className="vr-caption">תרשים ההתפלגות אינו זמין</p>}</div></ReportSection>
    {additionalContent}
  </VitasPresentation>;
}
