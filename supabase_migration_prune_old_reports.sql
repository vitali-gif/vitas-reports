-- ============================================================================
--  prune_old_reports()  —  הפונקציה החסרה שגורמת לטבלת reports לתפוח בלי סוף
-- ============================================================================
--  הרקע: app/api/cron/health/route.js כבר קורא ל-RPC הזה פעם ביום
--  (`sb.rpc('prune_old_reports', { retain_days: ... })`), אבל הפונקציה מעולם
--  לא נוצרה במסד — ולכן הקריאה נכשלת בשקט וה-pruning לא קרה מעולם.
--  (אפשר לראות את זה בתשובת /api/cron/health: השדה "pruned" תמיד null.)
--
--  נמדד ב-2026-09-08 על HI PARK בפרודקשן: 230 שורות, 13.0MB.
--  אחרי הפונקציה הזו עם retain_days=3:  72 שורות, 4.5MB.
--
--  למה זה קורה: prefetch-crm/prefetch-ads כותבים כל יום מפתחות טווח מתגלגלים
--  (today / yesterday / currentMonth / last7 / last14 / last30) שהערך שלהם
--  משתנה בכל יום, ולכן אף פעם לא נדרסים. ~6 מפתחות × 3-4 מקורות = עשרות
--  שורות חדשות ביום לכל פרויקט, לנצח.
--
--  🔴 החתך הוא לפי created_at ולא לפי תאריך הסיום של הטווח.
--  זו לא קוסמטיקה: המפתח `last30` של אתמול הוא `t-31_t-2` — תאריך סיום *טרי*
--  אבל שורה מתה לחלוטין, כי היום נכתב `t-30_t-1` תחת מפתח אחר. סינון לפי
--  תאריך הסיום לא היה מוחק כמעט כלום (נבדק: 0 שורות מתוך 230).
--  הקרון דורס את המפתחות החיים כל שעתיים, אז שורת-טווח שלא נגעו בה כמה ימים
--  היא בהגדרה מפתח נטוש.
--
--  מה תמיד נשמר:
--    • מפתחות חודש רגילים (2026-09) — הפילטר בכלל לא נוגע בהם
--    • טווח שהוא חודש קלנדרי שלם   (2026-09-01_2026-09-30)
--    • טווח שהוא רבעון קלנדרי שלם  (2026-07-01_2026-09-30)
--    • כל שורת טווח שנכתבה ב-retain_days הימים האחרונים
--
--  הרצה: Supabase → SQL Editor → הדבק והרץ. פעם אחת.
--  אחרי זה health cron מריץ אותה אוטומטית פעם ביום.
-- ============================================================================

create or replace function public.prune_old_reports(retain_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
  cutoff timestamptz := now() - (retain_days || ' days')::interval;
begin
  with candidates as (
    select id,
           created_at,
           split_part(month, '_', 1)::date as d_start,
           split_part(month, '_', 2)::date as d_end
    from public.reports
    -- רק מפתחות בצורת טווח. מפתח חודש (YYYY-MM) לא נכנס לכאן כלל.
    where month ~ '^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$'
  ),
  doomed as (
    select id from candidates
    where created_at < cutoff
      -- לשמור חודש קלנדרי שלם
      and not (d_start = date_trunc('month', d_start)::date
               and d_end = (date_trunc('month', d_start) + interval '1 month - 1 day')::date)
      -- לשמור רבעון קלנדרי שלם
      and not (d_start = date_trunc('quarter', d_start)::date
               and d_end = (date_trunc('quarter', d_start) + interval '3 months - 1 day')::date)
  )
  delete from public.reports r using doomed d where r.id = d.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- רק ה-service_role (הקרון) רשאי להריץ. לא anon ולא משתמשים מחוברים.
revoke all on function public.prune_old_reports(integer) from public, anon, authenticated;
grant execute on function public.prune_old_reports(integer) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
--  תצוגה מקדימה — להריץ קודם, לא מוחק כלום.
--  מראה כמה שורות יימחקו וכמה מקום זה חוסך, פר פרויקט.
-- ════════════════════════════════════════════════════════════════════════════
-- with c as (
--   select id, project_id, month, created_at,
--          split_part(month,'_',1)::date as d_start,
--          split_part(month,'_',2)::date as d_end
--   from public.reports
--   where month ~ '^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$'
-- )
-- select project_id,
--        count(*) filter (where created_at < now() - interval '3 days'
--          and not (d_start = date_trunc('month', d_start)::date
--                   and d_end = (date_trunc('month', d_start) + interval '1 month - 1 day')::date)
--          and not (d_start = date_trunc('quarter', d_start)::date
--                   and d_end = (date_trunc('quarter', d_start) + interval '3 months - 1 day')::date)
--        ) as will_delete,
--        count(*) as range_rows_total
-- from c group by project_id order by will_delete desc;
