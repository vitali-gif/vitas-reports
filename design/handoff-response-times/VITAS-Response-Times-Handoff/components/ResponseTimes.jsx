'use client';
import { RefreshCw, Info } from 'lucide-react';
import { VitasPresentation, DataState, MetricGrid, ReportSection, ReportTable } from './VitasPresentation';

export const REP_COLUMNS = [
  { key:'name', label:'איש מכירות' },
  { key:'answered', label:'לידים עם שיחה', numeric:true },
  { key:'mean', label:'זמן ממוצע', numeric:true },
  { key:'median', label:'זמן חציוני', numeric:true },
  { key:'pending', label:'טרם התקיימה שיחה', numeric:true },
].map(column => ({...column, sortable:true}));
export const SOURCE_COLUMNS = REP_COLUMNS.filter(c => c.key !== 'median').map(c => c.key === 'name' ? {...c,label:'מקור'} : c);
export const PANEL_TITLES = {
  distribution:'התפלגות זמני תגובה', weekday:'זמן מענה לפי יום בשבוע',
  meetingDay:'יום מבוקש לפגישה', activityHours:'שעות תיאום פגישות ולידים', unansweredHours:'שעות ללא מענה',
};

function ChartPanel({ id, panel, chart }) {
  return <ReportSection title={PANEL_TITLES[id]} description={panel?.scope}>
    <div className="vrt-panel"><DataState state={panel?.state || 'missing'} message={panel?.message}>
      {chart || <p className="vr-caption">התרשים אינו זמין</p>}
    </DataState></div>
  </ReportSection>;
}
function DetailTable({ title, table, defaultColumns, sort, onSort }) {
  return <ReportSection title={title} description={table?.scope}>
    <DataState state={table?.state || 'missing'} message={table?.message}>
      {table?.state === 'ready' && <ReportTable caption={title} columns={table.columns || defaultColumns} rows={table.rows} sort={sort} onSort={onSort} />}
    </DataState>
  </ReportSection>;
}
// Data and formulas belong to the existing project adapter. No new main/shell.
export default function ResponseTimes({ model, state='ready', charts={}, onRetry, onRefresh, refreshing=false, repSort, onRepSort, sourceSort, onSourceSort, additionalContent }) {
  if(state !== 'ready') return <VitasPresentation className="vrt-root"><DataState state={state} onRetry={onRetry}/></VitasPresentation>;
  return <VitasPresentation className="vrt-root">
    <ReportSection title="זמני תגובה" description="כמה זמן עובר מכניסת ליד ועד לשיחה שהתקיימה" actions={onRefresh && <button type="button" className="vr-button" onClick={onRefresh} disabled={refreshing}><RefreshCw size={16} aria-hidden="true"/>{refreshing ? 'מרענן נתונים…' : 'רענון נתונים'}</button>}>
      <p className="vrt-explanation"><Info size={18} aria-hidden="true"/>{model.definition}</p>
      <p className="vr-caption">{model.scope}</p>
      <MetricGrid metrics={model.metrics}/>
    </ReportSection>
    <ReportSection title="מהירות המענה"><div className="vrt-speed">{['distribution','weekday'].map(id => <ChartPanel key={id} id={id} panel={model.panels[id]} chart={charts[id]}/>)}</div></ReportSection>
    <ReportSection title="דפוסי פגישות ומענה"><div className="vrt-patterns">{['meetingDay','activityHours','unansweredHours'].map(id => <ChartPanel key={id} id={id} panel={model.panels[id]} chart={charts[id]}/>)}</div></ReportSection>
    <DetailTable title="זמן מענה לפי איש מכירות" table={model.reps} defaultColumns={REP_COLUMNS} sort={repSort} onSort={onRepSort}/>
    <DetailTable title="מקורות עם זמן המענה הארוך ביותר" table={model.sources} defaultColumns={SOURCE_COLUMNS} sort={sourceSort} onSort={onSourceSort}/>
    {additionalContent}
  </VitasPresentation>;
}
