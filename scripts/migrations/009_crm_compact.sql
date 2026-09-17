-- ═══════════════════════════════════════════════════════════════════════════
-- 009_crm_compact.sql
--
-- תמונת מצב CRM דחוסה לחישוב מהיר. שלב 3 של docs/daily-ranges-plan.md (תיקון ביצועים).
--
-- הבעיה: /api/reports/range טען את crm_raw של פרויקט רשומה-רשומה — HI PARK: 18,700
-- שורות, 17MB, ב-19 עמודים של 1,000 — ולקח 20 שניות. הרשומות הגולמיות נשארות
-- (מקור האמת, לכל שימוש עתידי), אבל החישוב צריך רק כ-30 שדות מתוך ~100.
--
-- הפתרון: אחרי כל עדכון של crm_raw, פונקציה ב-DB בונה שורה אחת לפרויקט עם רק
-- השדות ש-lib/crm/bmby-summary.js קורא — בתוך Postgres, בלי להעביר כלום לשרת.
-- נקודת הקצה טוענת שורה אחת (~5MB, דחוסה בתעבורה) במקום 19 עמודים.
--
-- contracts ו-price_offers נשמרים במלואם (עשרות שורות; החישוב מדפיס מהם allFields לדיאגנוסטיקה).
-- RLS דלוק בלי מדיניות: service_role בלבד (יש PII).
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.crm_compact (
  project_id        uuid        not null references public.projects(id) on delete cascade,
  crm_type          text        not null,
  payload           jsonb       not null,   -- { clients:[...], tasks:[...], price_offers:[...], contracts:[...] } מוקרנים
  counts            jsonb       not null,
  source_fetched_at timestamptz,            -- max(fetched_at) של crm_raw בזמן הבנייה
  built_at          timestamptz not null default now(),
  primary key (project_id, crm_type)
);

alter table public.crm_compact enable row level security;
-- אין policies בכוונה: רק service_role.

-- ── בנייה מחדש לפרויקט ──────────────────────────────────────────────────────
-- רשימת השדות = בדיוק מה ש-computeBmbySummary קורא (lib/crm/bmby-summary.js).
-- הוספת שדה לחישוב = הוספתו כאן. jsonb_strip_nulls משמיט שדות שחסרים ברשומה.
create or replace function public.rebuild_crm_compact(p_project uuid, p_crm text)
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
    from public.crm_raw where project_id = p_project and crm_type = p_crm and entity = 'clients';

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'client_id', payload->'client_id', 'type', payload->'type', 'media_title', payload->'media_title',
      'start_date', payload->'start_date', 'create_date', payload->'create_date', 'status', payload->'status',
      'client_name', payload->'client_name', 'message', payload->'message', 'subject', payload->'subject',
      'location', payload->'location', 'user_id', payload->'user_id', 'create_user_id', payload->'create_user_id'
    ))), '[]'::jsonb)
    into v_tasks
    from public.crm_raw where project_id = p_project and crm_type = p_crm and entity = 'tasks';

  select coalesce(jsonb_agg(payload), '[]'::jsonb) into v_prices
    from public.crm_raw where project_id = p_project and crm_type = p_crm and entity = 'price_offers';
  select coalesce(jsonb_agg(payload), '[]'::jsonb) into v_contracts
    from public.crm_raw where project_id = p_project and crm_type = p_crm and entity = 'contracts';
  select max(fetched_at) into v_fetched
    from public.crm_raw where project_id = p_project and crm_type = p_crm;

  v_counts := jsonb_build_object(
    'clients', jsonb_array_length(v_clients), 'tasks', jsonb_array_length(v_tasks),
    'price_offers', jsonb_array_length(v_prices), 'contracts', jsonb_array_length(v_contracts));

  insert into public.crm_compact (project_id, crm_type, payload, counts, source_fetched_at, built_at)
  values (p_project, p_crm,
          jsonb_build_object('clients', v_clients, 'tasks', v_tasks, 'price_offers', v_prices, 'contracts', v_contracts),
          v_counts, v_fetched, now())
  on conflict (project_id, crm_type) do update
    set payload = excluded.payload, counts = excluded.counts, source_fetched_at = excluded.source_fetched_at, built_at = now();

  return v_counts;
end;
$$;

revoke execute on function public.rebuild_crm_compact(uuid, text) from public, anon, authenticated;
grant  execute on function public.rebuild_crm_compact(uuid, text) to service_role;

commit;

-- בנייה ראשונית לכל הפרויקטים שכבר יש להם תמונה גולמית (חד-פעמי; הקרון ממשיך מכאן).
select p.name, public.rebuild_crm_compact(p.id, 'bmby')
from public.projects p
where exists (select 1 from public.crm_raw r where r.project_id = p.id and r.crm_type = 'bmby');

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop function if exists public.rebuild_crm_compact(uuid, text);
--   drop table if exists public.crm_compact;
-- ═══════════════════════════════════════════════════════════════════════════
