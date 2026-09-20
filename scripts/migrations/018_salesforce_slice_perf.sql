-- ════════════════════════════════════════════════════════════════════════════
-- 018_salesforce_slice_perf.sql — האצת crm_slice_salesforce (הדשבורד של KLOSS)
-- ════════════════════════════════════════════════════════════════════════════
--
-- הבעיה, כפי שנמדדה על הפרודקשן ב-19.09.2026:
--   כל טווח תאריכים ב-KLOSS קורא ל-crm_slice_salesforce דרך /api/reports/range.
--   הקריאה לטווח 01–19.09 לקחה 13,761ms, עם 120MB של קבצי temp. זה מה שגרם
--   לדשבורד להציג שלד טעינה במשך שניות ארוכות.
--
-- שני שורשים:
--   1. ה-CTE בשם raw שלף את כל רשומות ה-Salesforce של הפרויקט (67 אלף שורות,
--      22MB של payload) והוחזק בזיכרון/דיסק, וכל שאר ה-CTEs קראו ממנו. לכן שני
--      האינדקסים החלקיים שכבר קיימים (crm_raw_sf_leadid_idx, crm_raw_sf_oppid_idx)
--      לא נוצלו כלל — הם על crm_raw, וה-CTEs לא ניגשו ל-crm_raw אלא ל-raw.
--   2. בלוק ה-counts קרא שוב מכל ארבעת ה-CTEs, כלומר כל אחד מהם חושב פעמיים.
--
-- התיקון:
--   א. כל ישות נשלפת ישירות מ-crm_raw עם התנאי entity שלה, כך שהאינדקסים נוצלים.
--   ב. ה-counts מחושבים מאורך המערכים שכבר נבנו (jsonb_array_length).
--   ג. אינדקסי ביטוי על שדות התאריך. אי אפשר לאנדקס (payload->>'CreatedDate')::timestamptz
--      כי ההמרה אינה IMMUTABLE, אבל Salesforce מחזיר תמיד את אותו פורמט UTC באורך
--      קבוע — "2026-09-01T07:12:03.000+0000" — ולכן השוואת מחרוזות שקולה בדיוק
--      להשוואת זמנים. נבדק: 0 שורות חריגות מתוך 47,498 בשלוש הישויות.
--      סעיף הבטיחות למטה מוודא את זה שוב לפני שמחליפים משהו, ונכשל אם הפורמט השתנה.
--
-- התוצאה שנמדדה: 13,761ms → 717ms (פי 19).
-- נכונות: הפלט הושווה מול הפונקציה הישנה על שני טווחים (19 יום ו-3 חודשים).
--   כל ארבע הישויות זהות בייט-בייט — leads 694/5,008, opportunities 339/1,826,
--   line_items 911/4,512, lead_history 1,672/10,772.
--
-- ⚠️ בניית האינדקסים נועלת כתיבה ל-crm_raw לכמה שניות. הטבלה נכתבת רק על ידי קרון
--    ה-CRM, ולכן עדיף להריץ כשהוא אינו רץ. אין שינוי סכימה ואין נגיעה בנתונים.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── בטיחות: התיקון נשען על פורמט תאריך אחיד. אם הוא השתנה — לעצור ──────────
do $guard$
declare bad bigint;
begin
  select count(*) into bad
  from public.crm_raw
  where crm_type = 'salesforce'
    and entity in ('leads', 'opportunities', 'lead_history')
    and ( (payload->>'CreatedDate') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+0000$'
       or (nullif(payload->>'meetingDate__c','') is not null
           and (payload->>'meetingDate__c') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+0000$') );
  if bad > 0 then
    raise exception 'מיגרציה 018 נעצרה: % רשומות Salesforce עם פורמט תאריך שאינו ISO-UTC אחיד. השוואת המחרוזות במיגרציה הזאת אינה תקפה עליהן.', bad;
  end if;
end
$guard$;

-- ── אינדקסים ────────────────────────────────────────────────────────────────
create index if not exists crm_raw_sf_leads_created_idx
  on public.crm_raw (project_id, ((payload->>'CreatedDate')))
  where crm_type = 'salesforce' and entity = 'leads';

create index if not exists crm_raw_sf_leads_meeting_idx
  on public.crm_raw (project_id, ((payload->>'meetingDate__c')))
  where crm_type = 'salesforce' and entity = 'leads';

create index if not exists crm_raw_sf_opps_created_idx
  on public.crm_raw (project_id, ((payload->>'CreatedDate')))
  where crm_type = 'salesforce' and entity = 'opportunities';

-- לאיתור ההזדמנויות של ה-cohort לפי ConvertedOpportunityId של הלידים.
create index if not exists crm_raw_sf_opps_id_idx
  on public.crm_raw (project_id, ((payload->>'Id')))
  where crm_type = 'salesforce' and entity = 'opportunities';

create index if not exists crm_raw_sf_hist_created_idx
  on public.crm_raw (project_id, ((payload->>'CreatedDate')))
  where crm_type = 'salesforce' and entity = 'lead_history';

-- max(fetched_at) לפרויקט, בלי לסרוק את כל השורות.
create index if not exists crm_raw_fetched_idx
  on public.crm_raw (project_id, crm_type, fetched_at desc);

-- ── הפונקציה ────────────────────────────────────────────────────────────────
-- הערה למי שיערוך בהמשך: הביטוי to_char(...) חוזר בכל תנאי בכוונה. כשהוא נשלף
-- ל-CTE של גבולות, המתכנן מאבד את היכולת להשתמש בו כתנאי אינדקס והזמן חוזר ל-10 שניות.
create or replace function public.crm_slice_salesforce(p_project uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path to ''
as $fn$
  with
  leads as materialized (
    select c.payload from public.crm_raw c
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'leads'
      and ( (c.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
                                            and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
         or (c.payload->>'meetingDate__c') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
                                               and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"') )
  ),
  cohort_opp_ids as materialized (
    select l.payload->>'ConvertedOpportunityId' as id from leads l
    where (l.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
                                          and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
      and nullif(l.payload->>'ConvertedOpportunityId','') is not null
  ),
  opps as materialized (
    select c.payload from public.crm_raw c
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'opportunities'
      and ( (c.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
                                            and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
         or (c.payload->>'Id') in (select id from cohort_opp_ids) )
  ),
  items as materialized (
    select c.payload from public.crm_raw c
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'line_items'
      and (c.payload->>'OpportunityId') in (select o.payload->>'Id' from opps o)
  ),
  hist as materialized (
    select c.payload from public.crm_raw c
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'lead_history'
      and ( (c.payload->>'LeadId') in (select l.payload->>'Id' from leads l)
         or (c.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
                                            and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"') )
  ),
  agg as (
    select coalesce((select jsonb_agg(payload) from leads), '[]'::jsonb) as l,
           coalesce((select jsonb_agg(payload) from opps),  '[]'::jsonb) as o,
           coalesce((select jsonb_agg(payload) from items), '[]'::jsonb) as i,
           coalesce((select jsonb_agg(payload) from hist),  '[]'::jsonb) as h
  )
  select jsonb_build_object(
    'leads',         l,
    'opportunities', o,
    'line_items',    i,
    'lead_history',  h,
    'counts', jsonb_build_object(
      'leads',         jsonb_array_length(l),
      'opportunities', jsonb_array_length(o),
      'line_items',    jsonb_array_length(i),
      'lead_history',  jsonb_array_length(h),
      'raw_total',     (select count(*) from public.crm_raw where project_id = p_project and crm_type = 'salesforce')),
    'fetched_at', greatest(
      (select max(fetched_at) from public.crm_raw where project_id = p_project and crm_type = 'salesforce'),
      (select max(synced_at)  from public.crm_sync where project_id = p_project and crm_type = 'salesforce'))
  ) from agg;
$fn$;

analyze public.crm_raw;

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — מחזיר את הפונקציה הקודמת ומוחק את האינדקסים.
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--
-- create or replace function public.crm_slice_salesforce(p_project uuid, p_from timestamptz, p_to timestamptz)
-- returns jsonb language sql stable set search_path to '' as $old$
--   with
--   raw as (
--     select entity, payload, fetched_at
--     from public.crm_raw
--     where project_id = p_project and crm_type = 'salesforce'
--   ),
--   leads as (
--     select payload from raw
--     where entity = 'leads'
--       and ( ((payload->>'CreatedDate')::timestamptz between p_from and p_to)
--          or (nullif(payload->>'meetingDate__c','') is not null
--              and (payload->>'meetingDate__c')::timestamptz between p_from and p_to) )
--   ),
--   window_leads as (
--     select payload from leads where (payload->>'CreatedDate')::timestamptz between p_from and p_to
--   ),
--   lead_ids as (select payload->>'Id' as id from leads),
--   cohort_opp_ids as (
--     select payload->>'ConvertedOpportunityId' as id from window_leads
--     where nullif(payload->>'ConvertedOpportunityId','') is not null
--   ),
--   opps as (
--     select payload from raw
--     where entity = 'opportunities'
--       and ( ((payload->>'CreatedDate')::timestamptz between p_from and p_to)
--          or (payload->>'Id') in (select id from cohort_opp_ids) )
--   ),
--   opp_ids as (select payload->>'Id' as id from opps),
--   items as (
--     select payload from raw
--     where entity = 'line_items' and (payload->>'OpportunityId') in (select id from opp_ids)
--   ),
--   hist as (
--     select payload from raw
--     where entity = 'lead_history'
--       and ( (payload->>'LeadId') in (select id from lead_ids)
--          or ((payload->>'CreatedDate')::timestamptz between p_from and p_to) )
--   )
--   select jsonb_build_object(
--     'leads',         coalesce((select jsonb_agg(payload) from leads), '[]'::jsonb),
--     'opportunities', coalesce((select jsonb_agg(payload) from opps),  '[]'::jsonb),
--     'line_items',    coalesce((select jsonb_agg(payload) from items), '[]'::jsonb),
--     'lead_history',  coalesce((select jsonb_agg(payload) from hist),  '[]'::jsonb),
--     'counts', jsonb_build_object(
--       'leads', (select count(*) from leads), 'opportunities', (select count(*) from opps),
--       'line_items', (select count(*) from items), 'lead_history', (select count(*) from hist),
--       'raw_total', (select count(*) from raw)),
--     'fetched_at', greatest(
--       (select max(fetched_at) from raw),
--       (select max(synced_at) from public.crm_sync where project_id = p_project and crm_type = 'salesforce'))
--   );
-- $old$;
--
-- drop index if exists public.crm_raw_sf_leads_created_idx;
-- drop index if exists public.crm_raw_sf_leads_meeting_idx;
-- drop index if exists public.crm_raw_sf_opps_created_idx;
-- drop index if exists public.crm_raw_sf_opps_id_idx;
-- drop index if exists public.crm_raw_sf_hist_created_idx;
-- drop index if exists public.crm_raw_fetched_idx;
--
-- commit;
