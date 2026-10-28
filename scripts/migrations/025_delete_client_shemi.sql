-- ════════════════════════════════════════════════════════════════════════════
-- 025_delete_client_shemi.sql — מחיקת הלקוח "שמי נדל"ן" והפרויקט "כלל הפרויקטים"
-- ════════════════════════════════════════════════════════════════════════════
--
-- למה
-- ───
-- ויטלי (28.10): "סיימתי עבודה איתו ולכן אפשר למחוק אותו מהדשבורד".
--
-- מה יורד (נספר ב-28.10)
-- ──────────────────────
--   clients        1   שמי נדל"ן                 73514955-a180-45a1-b4b9-2f237d2a84ac
--   projects       1   כלל הפרויקטים            a6f5a791-16a8-436f-8aeb-8e82f7306875
--   reports       48   (מודעות בלבד — לפרויקט לא היה CRM מחובר)
--   client_access  2
--   crm_raw / crm_compact / crm_sync / vitas_tasks / marketing_meetings / meeting_tasks / ai_analyses — 0
-- ה-FK מ-clients ל-projects, ומ-projects לכל הטבלאות האלה, הוא ON DELETE CASCADE — לכן מוחקים
-- רק את הלקוח, והשאר יורד איתו.
--
-- מה לא נמחק
-- ──────────
--   client_sessions — לוג כניסות (project_ids הוא מערך, בלי FK). נשאר כהיסטוריה.
--   ad_daily        — העובדות היומיות לפי חשבון מודעות, לא לפי פרויקט. כל עוד החשבונות
--                     (מטא 395927933298639, גוגל 2713605466) ברשימות ב-Vercel, הקרון ימשיך
--                     למשוך אותם. להסרה: META_AD_ACCOUNT_IDS ו-GOOGLE_ADS_CUSTOMER_IDS.
--
-- גיבוי
-- ─────
-- לפני המחיקה הכל מועתק לסכמה archive (לא חשופה ל-API: PostgREST מגיש רק את public).
-- כך ה-rollback מחזיר את הלקוח בדיוק כמו שהיה, כולל הדוחות. את הגיבוי אפשר למחוק
-- אחרי חודש (פקודה בסוף).
--
-- להריץ פעם אחת, את כל הקובץ (עד ROLLBACK), ב-SQL Editor של Supabase.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create schema if not exists archive;

create table archive.shemi_clients        as select * from public.clients       where id = '73514955-a180-45a1-b4b9-2f237d2a84ac';
create table archive.shemi_projects       as select * from public.projects      where client_id = '73514955-a180-45a1-b4b9-2f237d2a84ac';
create table archive.shemi_reports        as select * from public.reports       where project_id in (select id from archive.shemi_projects);
create table archive.shemi_client_access  as select * from public.client_access where project_id in (select id from archive.shemi_projects);

-- בדיקת שפיות: אם הספירות לא תואמות את מה שנספר ב-28.10 — עוצרים, ולא מוחקים כלום.
do $$
begin
  if (select count(*) from archive.shemi_clients) <> 1
     or (select count(*) from archive.shemi_projects) <> 1
     or (select count(*) from archive.shemi_reports) < 1 then
    raise exception 'unexpected backup counts — nothing deleted';
  end if;
end $$;

delete from public.clients where id = '73514955-a180-45a1-b4b9-2f237d2a84ac';

commit;

-- בדיקה אחרי ההרצה (צריך: 0, 0, 0, ו-48 בגיבוי):
-- select (select count(*) from public.clients  where id = '73514955-a180-45a1-b4b9-2f237d2a84ac') clients,
--        (select count(*) from public.projects where id = 'a6f5a791-16a8-436f-8aeb-8e82f7306875') projects,
--        (select count(*) from public.reports  where project_id = 'a6f5a791-16a8-436f-8aeb-8e82f7306875') reports,
--        (select count(*) from archive.shemi_reports) backed_up;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — מחזיר את הלקוח, הפרויקט, הדוחות וההרשאות מהגיבוי
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--   insert into public.clients       select * from archive.shemi_clients;
--   insert into public.projects      select * from archive.shemi_projects;
--   insert into public.reports       select * from archive.shemi_reports;
--   insert into public.client_access select * from archive.shemi_client_access;
-- commit;
-- (אחרי rollback צריך גם להחזיר את השורה 'כלל הפרויקטים' ל-GOOGLE_PROJECT_SOURCES ב-lib/ads/routing.js.)

-- ════════════════════════════════════════════════════════════════════════════
-- ניקוי הגיבוי — אחרי חודש, כשבטוח שלא צריך לחזור
-- ════════════════════════════════════════════════════════════════════════════
-- drop table archive.shemi_clients, archive.shemi_projects, archive.shemi_reports, archive.shemi_client_access;
