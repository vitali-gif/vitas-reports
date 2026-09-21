'use client';
import {VitasPresentation,DataState,ReportSection,MetricGrid,Funnel,ReportTable,AdGrid} from './VitasPresentation';
function TableBlock({title,model,expandedIds,onToggle,sort,onSort}){
 return <ReportSection title={title} description={model?.scope}><DataState state={model?.state || 'missing'} message={model?.message}>{model?.state==='ready'&&<><ReportTable caption={title} columns={model.columns} rows={model.rows} expandedIds={expandedIds} onToggle={onToggle} sort={sort} onSort={onSort}/>{model.summaryNote&&<p className="vr-caption">{model.summaryNote}</p>}</>}</DataState></ReportSection>;
}
// Presentation only. Source attribution and calculations stay in existing adapters.
export default function FacebookView({model,state='ready',onRetry,expandedCampaigns,onCampaignToggle,campaignSort,onCampaignSort,genderSort,onGenderSort,ageSort,onAgeSort,additionalContent}){
 if(state!=='ready')return <VitasPresentation className="vfb-root"><DataState state={state} onRetry={onRetry}/></VitasPresentation>;
 return <VitasPresentation className="vfb-root">
  <ReportSection title="Facebook" description={model.scope}>
   <ReportSection title="פעילות בתקופה" description={model.activity.scope}><DataState state={model.activity.state} message={model.activity.message}>{model.activity.state==='ready'&&<MetricGrid metrics={model.activity.metrics}/>}</DataState></ReportSection>
  </ReportSection>
  <ReportSection title="מה קרה ללידים שנכנסו בתקופה" description={model.cohort.scope}>
   <div className="vfb-ad-summary"><h3>נתוני הפרסום בתקופה</h3><DataState state={model.advertising.state} message={model.advertising.message}>{model.advertising.state==='ready'&&<dl>{model.advertising.items.map(item=><div key={item.id}><dt>{item.label}</dt><dd><bdi>{item.value??'אין נתון'}</bdi></dd></div>)}</dl>}</DataState><p className="vr-caption">חשיפות וקליקים הם נתוני פרסום מצטברים.</p></div>
   <DataState state={model.cohort.state} message={model.cohort.message}>{model.cohort.state==='ready'&&<Funnel items={model.cohort.stages} description={model.cohort.note}/>}</DataState>
  </ReportSection>
  <TableBlock title="קמפיינים, קבוצות מודעות ומודעות" model={model.campaigns} expandedIds={expandedCampaigns} onToggle={onCampaignToggle} sort={campaignSort} onSort={onCampaignSort}/>
  <TableBlock title="פילוח מגדר" model={model.gender} sort={genderSort} onSort={onGenderSort}/>
  <TableBlock title="פילוח גילאים" model={model.age} sort={ageSort} onSort={onAgeSort}/>
  <ReportSection title="המודעות המובילות ב־Facebook" description={model.ads.scope}><DataState state={model.ads.state} message={model.ads.message}>{model.ads.state==='ready'&&<AdGrid ads={model.ads.items}/>}</DataState></ReportSection>
  {additionalContent}
 </VitasPresentation>;
}
