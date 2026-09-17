-- ═══════════════════════════════════════════════════════════════════════════
-- 013_crm_raw_write_only_changes.sql
--
-- הבעיה (17.9): קרון ה-CRM כתב מחדש את *כל* הרשומות הגולמיות בכל ריצה — ~60k של Salesforce
-- ו-~37k של BMBY כל שעתיים — גם כשלא השתנה בהן דבר. ב-DB הקטן זה הביא לנעילות שורות,
-- statement timeouts (17 ב-15:37, 32 ב-17:37), כתיבות שנכשלו ודוחות רבעון שלא נכתבו.
--
-- הפתרון: כותבים רק מה שהשתנה. לכל רשומה נשמר payload_hash (md5 של ה-JSON, מחושב בקוד),
-- והפונקציה crm_raw_upsert מעדכנת שורה קיימת רק אם ה-hash שונה. רשומה שלא השתנתה — לא נכתבת,
-- לא ננעלת לזמן ארוך, לא מייצרת WAL. הריצה הראשונה אחרי המיגרציה עדיין כותבת הכל (ה-hash ריק);
-- מהריצה השנייה נכתבים רק השינויים (בד"כ עשרות–מאות רשומות).
--
-- "טריות": fetched_at של הרשומה עכשיו אומר "מתי הרשומה השתנתה", לא "מתי נמשכה לאחרונה".
-- לכן נוסף crm_sync — שורה אחת לכל (פרויקט, CRM, ישות) עם synced_at = מתי המשיכה האחרונה
-- ראתה את הישות. ממנה נגזרת הטריות ב-health ובחיתוך של Salesforce. לתמונה הדחוסה (crm_compact)
-- source_fetched_at = now() בזמן הבנייה (הבנייה רצה מיד אחרי משיכה מוצלחת).
--
-- הרצה חוזרת בטוחה. rollback בתחתית.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.crm_raw add column if not exists payload_hash text;

create table if not exists public.crm_sync (
  project_id uuid not null,
  crm_type   text not null,
  entity     text not null,
  synced_at  timestamptz not null default now(),
  seen       integer not null default 0,     -- כמה רשומות המשיכה החזירה
  written    integer not null default 0,     -- כמה מהן נכתבו (חדשות או שהשתנו)
  primary key (project_id, crm_type, entity)
);
alter table public.crm_sync enable row level security;   -- service_role בלבד, כמו crm_raw

-- upsert שכותב רק שינויים. p_rows: מערך של {project_id, crm_type, entity, ext_id, payload, payload_hash, fetched_at}.
create or replace function public.crm_raw_upsert(p_rows jsonb)
returns jsonb
language sql
set search_path = ''
as $$
  with src as (
    select (r->>'project_id')::uuid as project_id, r->>'crm_type' as crm_type, r->>'entity' as entity,
           r->>'ext_id' as ext_id, r->'payload' as payload, r->>'payload_hash' as payload_hash,
           coalesce((r->>'fetched_at')::timestamptz, now()) as fetched_at
    from jsonb_array_elements(p_rows) r
  ),
  ins as (
    insert into public.crm_raw (project_id, crm_type, entity, ext_id, payload, payload_hash, fetched_at)
    select project_id, crm_type, entity, ext_id, payload, payload_hash, fetched_at from src
    order by ext_id                                   -- סדר נעילה קבוע בין קריאות מקבילות
    on conflict (project_id, crm_type, entity, ext_id) do update
      set payload = excluded.payload, payload_hash = excluded.payload_hash, fetched_at = excluded.fetched_at
      where public.crm_raw.payload_hash is distinct from excluded.payload_hash
    returning 1
  )
  select jsonb_build_object('seen', (select count(*) from src), 'written', (select count(*) from ins));
$$;
revoke execute on function public.crm_raw_upsert(jsonb) from public, anon, authenticated;
grant  execute on function public.crm_raw_upsert(jsonb) to service_role;

-- crm_compact: source_fetched_at = זמן הבנייה (רצה מיד אחרי משיכה מוצלחת), לא max(fetched_at) של
-- הרשומות — שמעכשיו מתעדכן רק כשרשומה משתנה. שאר הפונקציה זהה ל-010.
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

  v_counts := jsonb_build_object(
    'clients', jsonb_array_length(v_clients), 'tasks', jsonb_array_length(v_tasks),
    'price_offers', jsonb_array_length(v_prices), 'contracts', jsonb_array_length(v_contracts));

  insert into public.crm_compact (project_id, crm_type, payload, counts, source_fetched_at, built_at)
  values (p_project, 'bmby',
          jsonb_build_object('clients', v_clients, 'tasks', v_tasks, 'price_offers', v_prices, 'contracts', v_contracts),
          v_counts, now(), now())
  on conflict (project_id, crm_type) do update
    set payload = excluded.payload, counts = excluded.counts, source_fetched_at = now(), built_at = now();

  return v_counts;
end;
$$;

create or replace function public.rebuild_crm_compact(p_project uuid, p_crm text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_counts  jsonb;
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

  insert into public.crm_compact (project_id, crm_type, payload, counts, source_fetched_at, built_at)
  values (p_project, p_crm, v_payload, v_counts, now(), now())
  on conflict (project_id, crm_type) do update
    set payload = excluded.payload, counts = excluded.counts, source_fetched_at = now(), built_at = now();

  return v_counts;
end;
$$;

-- Salesforce: 'fetched_at' של הפרוסה = המשיכה האחרונה (crm_sync), לא השינוי האחרון ברשומה. שאר הפונקציה כמו 011.
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
    'fetched_at', greatest(
      (select max(fetched_at) from raw),
      (select max(synced_at) from public.crm_sync where project_id = p_project and crm_type = 'salesforce'))
  );
$$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop function if exists public.crm_raw_upsert(jsonb);
--   drop table if exists public.crm_sync;
--   alter table public.crm_raw drop column if exists payload_hash;
--   להריץ מחדש את 010 (rebuild_crm_compact*) ואת 011 (crm_slice_salesforce).
--   הקוד (lib/crm/raw-store.js) נופל חזרה ל-upsert הרגיל כשהפונקציה לא קיימת.
-- ═══════════════════════════════════════════════════════════════════════════
