-- ════════════════════════════════════════════════════════════════════════════
-- 019_salesforce_slice_or_split.sql — המשך של 018: פיצול שני ה-OR שנשארו
-- ════════════════════════════════════════════════════════════════════════════
--
-- מיגרציה 018 הועילה, אבל המספר שנמסר שם (717ms) נמדד בלילה כשהמסד היה פנוי, ואינו
-- מייצג. מדידה חוזרת ב-20.09 בשעות הפעילות, על אותו טווח ובאותה דקה:
--   הפונקציה של 018:  6,372ms
--   הפונקציה כאן:       959ms
--
-- מה שנשאר איטי ולמה:
--   שני ה-CTEs opps ו-hist מסננים ב-OR שצד אחד שלו הוא תת-שאילתה:
--     ... where (payload->>'CreatedDate') between … or (payload->>'LeadId') in (select …)
--   Postgres לא יודע לבנות BitmapOr כששני הצדדים אינם ביטויים קבועים, ולכן הוא נופל
--   לסריקה של כל הישות. ב-lead_history של KLOSS זה 26,805 שורות ו-7,969 בלוקים בכל
--   קריאה, שמהן 25,126 נזרקות במסנן. זה היה 938ms מתוך הזמן.
--
-- התיקון: כל OR כזה מפוצל לשתי שאילתות נפרדות שכל אחת יכולה לרוץ על אינדקס, מאוחדות
-- ב-UNION שמחזיר ext_id בלבד (זול), ורק אז נשלפות השורות לפי המפתח הראשי. אחרי הפיצול
-- שני האינדקסים crm_raw_sf_leadid_idx ו-crm_raw_sf_hist_created_idx באמת בשימוש.
--
-- ⚠️ ה-UNION מאחד לפי ext_id, שהוא ייחודי בתוך (project_id, crm_type, entity) לפי המפתח
--    הראשי של crm_raw. לכן שורה שעונה על שני התנאים מוחזרת פעם אחת בדיוק, כמו ב-OR.
--
-- נכונות: הפלט הושווה מול הפונקציה של 018 על הטווח 01–19.09, וכל ארבע הישויות זהות
--   בייט-בייט — leads 697, opportunities 340, line_items 915, lead_history 1,679.
--
-- אין שינוי סכימה, אין אינדקסים חדשים ואין נגיעה בנתונים — רק גוף הפונקציה.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- הערה למי שיערוך בהמשך: יש כאן שני דפוסים שקל לבטל בטעות ולאבד בגללם פי שבעה בזמן.
--   1. to_char(...) חוזר בכל תנאי במקום להישלף ל-CTE של גבולות. כשהוא ב-CTE, המתכנן
--      מפסיק להשתמש בו כתנאי אינדקס.
--   2. opps ו-hist מפוצלים ל-UNION של ext_id ולא כתובים כ-OR אחד. OR עם תת-שאילתה
--      מבטל את השימוש באינדקס.
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
  -- הזדמנויות: שנוצרו בטווח, או שהן ההזדמנות שאליה הומר ליד מהטווח.
  opp_ids as materialized (
    select c.ext_id from public.crm_raw c
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'opportunities'
      and (c.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
                                          and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
    union
    select c.ext_id from public.crm_raw c
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'opportunities'
      and (c.payload->>'Id') in (select id from cohort_opp_ids)
  ),
  opps as materialized (
    select c.payload from public.crm_raw c join opp_ids o on c.ext_id = o.ext_id
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'opportunities'
  ),
  items as materialized (
    select c.payload from public.crm_raw c
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'line_items'
      and (c.payload->>'OpportunityId') in (select o.payload->>'Id' from opps o)
  ),
  -- היסטוריה: של הלידים שבטווח, או שנרשמה בטווח עצמו.
  hist_ids as materialized (
    select c.ext_id from public.crm_raw c
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'lead_history'
      and (c.payload->>'LeadId') in (select l.payload->>'Id' from leads l)
    union
    select c.ext_id from public.crm_raw c
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'lead_history'
      and (c.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
                                          and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
  ),
  hist as materialized (
    select c.payload from public.crm_raw c join hist_ids h on c.ext_id = h.ext_id
    where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'lead_history'
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

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — חזרה לגוף הפונקציה של מיגרציה 018 (האינדקסים נשארים; הם נחוצים גם לה).
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--
-- create or replace function public.crm_slice_salesforce(p_project uuid, p_from timestamptz, p_to timestamptz)
-- returns jsonb language sql stable set search_path to '' as $old$
--   with
--   leads as materialized (
--     select c.payload from public.crm_raw c
--     where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'leads'
--       and ( (c.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
--                                             and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
--          or (c.payload->>'meetingDate__c') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
--                                                and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"') )
--   ),
--   cohort_opp_ids as materialized (
--     select l.payload->>'ConvertedOpportunityId' as id from leads l
--     where (l.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
--                                           and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
--       and nullif(l.payload->>'ConvertedOpportunityId','') is not null
--   ),
--   opps as materialized (
--     select c.payload from public.crm_raw c
--     where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'opportunities'
--       and ( (c.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
--                                             and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
--          or (c.payload->>'Id') in (select id from cohort_opp_ids) )
--   ),
--   items as materialized (
--     select c.payload from public.crm_raw c
--     where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'line_items'
--       and (c.payload->>'OpportunityId') in (select o.payload->>'Id' from opps o)
--   ),
--   hist as materialized (
--     select c.payload from public.crm_raw c
--     where c.project_id = p_project and c.crm_type = 'salesforce' and c.entity = 'lead_history'
--       and ( (c.payload->>'LeadId') in (select l.payload->>'Id' from leads l)
--          or (c.payload->>'CreatedDate') between to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"')
--                                             and to_char(p_to   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"+0000"') )
--   ),
--   agg as (
--     select coalesce((select jsonb_agg(payload) from leads), '[]'::jsonb) as l,
--            coalesce((select jsonb_agg(payload) from opps),  '[]'::jsonb) as o,
--            coalesce((select jsonb_agg(payload) from items), '[]'::jsonb) as i,
--            coalesce((select jsonb_agg(payload) from hist),  '[]'::jsonb) as h
--   )
--   select jsonb_build_object(
--     'leads', l, 'opportunities', o, 'line_items', i, 'lead_history', h,
--     'counts', jsonb_build_object(
--       'leads', jsonb_array_length(l), 'opportunities', jsonb_array_length(o),
--       'line_items', jsonb_array_length(i), 'lead_history', jsonb_array_length(h),
--       'raw_total', (select count(*) from public.crm_raw where project_id = p_project and crm_type = 'salesforce')),
--     'fetched_at', greatest(
--       (select max(fetched_at) from public.crm_raw where project_id = p_project and crm_type = 'salesforce'),
--       (select max(synced_at)  from public.crm_sync where project_id = p_project and crm_type = 'salesforce'))
--   ) from agg;
-- $old$;
--
-- commit;
