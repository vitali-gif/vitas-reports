-- 027 — crm_compact של BMBY: תאריך העדכון של משימת LID
--
-- הבעיה (ONCE, 1.11.2026): הנציגה רושמת את סיכום השיחה בתוך משימת ה-LID עצמה, בלי משימה נוספת,
-- ולכן לידים שטופלו נספרו "לא קיבלו מענה". הקוד (lib/crm/bmby-summary.js, lidHasRepNote) כבר סופר
-- LID עם סיכום כ"נענה", וזמן המענה הוא update_date של ה-LID. crm_compact (הטווחים המיידיים) לא שמר
-- את update_date, ולכן שם הלידים האלה נספרים "נענו" בלי זמן מענה. כאן מוסיפים אותו — רק ל-LID,
-- כדי לא לנפח את ה-payload (ב-HI PARK יש ~15 אלף משימות).
--
-- הפונקציה זהה ל-013, חוץ משתי השורות המסומנות "027".

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
      'location', payload->'location', 'user_id', payload->'user_id', 'create_user_id', payload->'create_user_id',
      'update_date', case when lower(payload->>'type') = 'lid' then payload->'update_date' end,          -- 027
      'update_user_id', case when lower(payload->>'type') = 'lid' then payload->'update_user_id' end    -- 027
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

-- בנייה מחדש מיידית לכל פרויקטי BMBY (רץ כאן כ-postgres, בלי מגבלת הזמן של השרת)
select p.name, public.rebuild_crm_compact_bmby(c.project_id)
from public.crm_compact c join public.projects p on p.id = c.project_id
where c.crm_type = 'bmby';

-- בדיקה: מספר משימות LID עם update_date בכל פרויקט (אמור להיות גדול מ-0)
select p.name, count(*) filter (where t ? 'update_date') lids_with_update
from public.crm_compact c join public.projects p on p.id = c.project_id,
     jsonb_array_elements(c.payload->'tasks') t
where c.crm_type = 'bmby' and lower(t->>'type') = 'lid'
group by 1;

-- ROLLBACK: להריץ שוב את הגדרת הפונקציה מ-013_crm_raw_write_only_changes.sql (בלי שתי שורות ה-027),
-- ואז את שאילתת הבנייה מחדש למעלה. הקוד עובד גם בלי update_date (הלידים נספרים "נענו" בלי זמן).
