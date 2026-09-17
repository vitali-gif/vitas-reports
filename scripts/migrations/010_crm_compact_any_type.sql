-- ═══════════════════════════════════════════════════════════════════════════
-- 010_crm_compact_any_type.sql
--
-- שלב 4 של docs/daily-ranges-plan.md: rebuild_crm_compact תומכת בכל סוג CRM.
--
-- ב-009 הפונקציה הכירה רק את BMBY (הקרנת ~30 שדות מתוך ~100). ל-Zoho ול-Salesforce
-- הרשומות קטנות (עשרות שדות שכולם בשימוש), ולכן הן נשמרות במלואן, לפי ישות —
-- בלי להניח מראש אילו ישויות קיימות (leads / deals / opportunities / ...).
--
-- BMBY ממשיך לקבל את ההקרנה המדויקת מ-009 (הפונקציה הפנימית rebuild_crm_compact_bmby).
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1. ההקרנה של BMBY עוברת לשם פנימי (אותו גוף כמו ב-009).
create or replace function public.rebuild_crm_compact_bmby(p_project uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_clients   jsonb;
  v_tasks     jsonb;
  v_prices    jsonb;
  v_contracts jsonb;
  v_fetched   timestamptz;
  v_counts    jsonb;
begin
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'client_id', payload->'client_id', 'relevant', payload->'relevant', 'status', payload->'status',
      'city', payload->'city', 'address', payload->'address', 'objection', payload->'objection',
      'remark', payload->'remark', 'living_status', payload->'living_status', '_cf', payload->'_cf',
      'phone_mobile', payload->'phone_mobile', 'phone_home', payload->'phone_home', 'phone_work', payload->'phone_work',
      'user_id', payload->'user_id', 'user_name', payload->'user_name',
      'client_fname', payload->'client_fname', 'client_lname', payload->'client_lname',
      'fname', payload->'fname', 'lname', payload->'lname',
      'media', payload->'media', 'media_title', payload->'media_title', 'client_stage', payload->'client_stage',
      'appartment_type', payload->'appartment_type', 'family_status', payload->'family_status', 'model_name', payload->'model_name',
      'min_rooms', payload->'min_rooms', 'max_rooms', payload->'max_rooms', 'min_size', payload->'min_size', 'max_size', payload->'max_size',
      'budget', payload->'budget', 'seriousness', payload->'seriousness', 'entitlement', payload->'entitlement',
      'property_city', payload->'property_city', 'property_neighborhood', payload->'property_neighborhood'
    ))), '[]'::jsonb)
    into v_clients
    from public.crm_raw where project_id = p_project and crm_type = 'bmby' and entity = 'clients';

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'client_id', payload->'client_id', 'type', payload->'type', 'media_title', payload->'media_title',
      'start_date', payload->'start_date', 'create_date', payload->'create_date', 'status', payload->'status',
      'client_name', payload->'client_name', 'message', payload->'message', 'subject', payload->'subject',
      'location', payload->'location', 'user_id', payload->'user_id', 'create_user_id', payload->'create_user_id'
    ))), '[]'::jsonb)
    into v_tasks
    from public.crm_raw where project_id = p_project and crm_type = 'bmby' and entity = 'tasks';

  select coalesce(jsonb_agg(payload), '[]'::jsonb) into v_prices
    from public.crm_raw where project_id = p_project and crm_type = 'bmby' and entity = 'price_offers';
  select coalesce(jsonb_agg(payload), '[]'::jsonb) into v_contracts
    from public.crm_raw where project_id = p_project and crm_type = 'bmby' and entity = 'contracts';
  select max(fetched_at) into v_fetched
    from public.crm_raw where project_id = p_project and crm_type = 'bmby';

  v_counts := jsonb_build_object(
    'clients', jsonb_array_length(v_clients), 'tasks', jsonb_array_length(v_tasks),
    'price_offers', jsonb_array_length(v_prices), 'contracts', jsonb_array_length(v_contracts));

  insert into public.crm_compact (project_id, crm_type, payload, counts, source_fetched_at, built_at)
  values (p_project, 'bmby',
          jsonb_build_object('clients', v_clients, 'tasks', v_tasks, 'price_offers', v_prices, 'contracts', v_contracts),
          v_counts, v_fetched, now())
  on conflict (project_id, crm_type) do update
    set payload = excluded.payload, counts = excluded.counts, source_fetched_at = excluded.source_fetched_at, built_at = now();

  return v_counts;
end;
$$;

-- 2. הפונקציה הכללית: BMBY → הקרנה; כל סוג אחר → כל הישויות במלואן, לפי שם הישות.
create or replace function public.rebuild_crm_compact(p_project uuid, p_crm text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_counts  jsonb;
  v_fetched timestamptz;
begin
  if p_crm = 'bmby' then
    return public.rebuild_crm_compact_bmby(p_project);
  end if;

  select coalesce(jsonb_object_agg(e.entity, e.rows), '{}'::jsonb),
         coalesce(jsonb_object_agg(e.entity, e.n), '{}'::jsonb)
    into v_payload, v_counts
    from (
      select entity, jsonb_agg(payload) as rows, count(*) as n
      from public.crm_raw
      where project_id = p_project and crm_type = p_crm
      group by entity
    ) e;

  select max(fetched_at) into v_fetched
    from public.crm_raw where project_id = p_project and crm_type = p_crm;

  insert into public.crm_compact (project_id, crm_type, payload, counts, source_fetched_at, built_at)
  values (p_project, p_crm, v_payload, v_counts, v_fetched, now())
  on conflict (project_id, crm_type) do update
    set payload = excluded.payload, counts = excluded.counts, source_fetched_at = excluded.source_fetched_at, built_at = now();

  return v_counts;
end;
$$;

revoke execute on function public.rebuild_crm_compact_bmby(uuid) from public, anon, authenticated;
revoke execute on function public.rebuild_crm_compact(uuid, text) from public, anon, authenticated;
grant  execute on function public.rebuild_crm_compact_bmby(uuid) to service_role;
grant  execute on function public.rebuild_crm_compact(uuid, text) to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: להריץ מחדש את 009 (הגרסה של BMBY בלבד) ו-
--   drop function if exists public.rebuild_crm_compact_bmby(uuid);
-- ═══════════════════════════════════════════════════════════════════════════
