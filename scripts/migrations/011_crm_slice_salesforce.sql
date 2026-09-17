-- ═══════════════════════════════════════════════════════════════════════════
-- 011_crm_slice_salesforce.sql
--
-- Salesforce (KLOSS): פרוסה לטווח במקום תמונה דחוסה. שלב 4ב/5 של docs/daily-ranges-plan.md.
--
-- הבעיה (17.9): ל-KLOSS יש ~60,000 רשומות גולמיות מתחילת השנה (12k לידים, 27k היסטוריה,
-- 14k פריטים, 5.5k הזדמנויות). בניית crm_compact לפרויקט לקחה 27 שניות בתוך הקרון, נכשלה
-- בריצות מקבילות, והשאירה תמונה ישנה (11:17) לצד רשומות טריות (11:42). גם אם הייתה מצליחה,
-- טעינת ~10MB לכל בקשה הייתה איטית.
--
-- הפתרון: החישוב של Salesforce צריך לטווח רק את הרשומות של הטווח (בדיוק כמו השאילתות
-- המקוריות: לידים שנוצרו בחלון או שהפגישה שלהם בחלון, ההיסטוריה שלהם או היסטוריה שנרשמה
-- בחלון, הזדמנויות שנוצרו בחלון או שהומרו מלידי החלון, והפריטים שלהן). הפונקציה כאן חותכת
-- את זה בתוך Postgres ומחזירה מאות רשומות במקום עשרות אלפים.
--
-- p_from / p_to מגיעים מהקוד עם היסט ישראל קבוע לפי תאריך ההתחלה — בדיוק כמו FROM/TO ב-route.
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.crm_slice_salesforce(p_project uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  raw as (
    select entity, payload, fetched_at
    from public.crm_raw
    where project_id = p_project and crm_type = 'salesforce'
  ),
  leads as (
    select payload
    from raw
    where entity = 'leads'
      and (
        ((payload->>'CreatedDate')::timestamptz between p_from and p_to)
        or (nullif(payload->>'meetingDate__c','') is not null
            and (payload->>'meetingDate__c')::timestamptz between p_from and p_to)
      )
  ),
  window_leads as (
    select payload from leads where (payload->>'CreatedDate')::timestamptz between p_from and p_to
  ),
  lead_ids as (select payload->>'Id' as id from leads),
  cohort_opp_ids as (
    select payload->>'ConvertedOpportunityId' as id from window_leads
    where nullif(payload->>'ConvertedOpportunityId','') is not null
  ),
  opps as (
    select payload
    from raw
    where entity = 'opportunities'
      and (
        ((payload->>'CreatedDate')::timestamptz between p_from and p_to)
        or (payload->>'Id') in (select id from cohort_opp_ids)
      )
  ),
  opp_ids as (select payload->>'Id' as id from opps),
  items as (
    select payload from raw
    where entity = 'line_items' and (payload->>'OpportunityId') in (select id from opp_ids)
  ),
  hist as (
    select payload from raw
    where entity = 'lead_history'
      and (
        (payload->>'LeadId') in (select id from lead_ids)
        or ((payload->>'CreatedDate')::timestamptz between p_from and p_to)
      )
  )
  select jsonb_build_object(
    'leads',         coalesce((select jsonb_agg(payload) from leads), '[]'::jsonb),
    'opportunities', coalesce((select jsonb_agg(payload) from opps),  '[]'::jsonb),
    'line_items',    coalesce((select jsonb_agg(payload) from items), '[]'::jsonb),
    'lead_history',  coalesce((select jsonb_agg(payload) from hist),  '[]'::jsonb),
    'counts', jsonb_build_object(
      'leads', (select count(*) from leads), 'opportunities', (select count(*) from opps),
      'line_items', (select count(*) from items), 'lead_history', (select count(*) from hist),
      'raw_total', (select count(*) from raw)),
    'fetched_at', (select max(fetched_at) from raw)
  );
$$;

revoke execute on function public.crm_slice_salesforce(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.crm_slice_salesforce(uuid, timestamptz, timestamptz) to service_role;

-- אינדקסים לחיתוך: תאריכי היצירה/פגישה כביטויים, ומזהי קישור.
create index if not exists crm_raw_sf_created_idx
  on public.crm_raw (project_id, entity, ((payload->>'CreatedDate')::timestamptz))
  where crm_type = 'salesforce';
create index if not exists crm_raw_sf_leadid_idx
  on public.crm_raw (project_id, (payload->>'LeadId'))
  where crm_type = 'salesforce' and entity = 'lead_history';
create index if not exists crm_raw_sf_oppid_idx
  on public.crm_raw (project_id, (payload->>'OpportunityId'))
  where crm_type = 'salesforce' and entity = 'line_items';

-- התמונה הדחוסה של Salesforce לא בשימוש יותר (ישנה ומטעה) — מוחקים.
delete from public.crm_compact where crm_type = 'salesforce';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop function if exists public.crm_slice_salesforce(uuid, timestamptz, timestamptz);
--   drop index if exists public.crm_raw_sf_created_idx;
--   drop index if exists public.crm_raw_sf_leadid_idx;
--   drop index if exists public.crm_raw_sf_oppid_idx;
-- ═══════════════════════════════════════════════════════════════════════════
