-- 034 — מאפשר דוחות TikTok בטבלת reports (ויטלי, 10.11: קמפיין אקספו חיפה בטיקטוק)
-- עד עכשיו reports_source_check קיבל רק facebook / google / google_pmax / google_search / crm / ga4,
-- ולכן כתיבה של source = 'tiktok' נדחתה. הקרון prefetch-daily כותב שורת tiktok לכל חודש וטווח
-- מוכן (lib/ads/tiktok-reports.js). שינוי בתנאי בלבד — שום שורה קיימת לא משתנה.

alter table public.reports drop constraint if exists reports_source_check;
alter table public.reports add constraint reports_source_check
  check (source = any (array['facebook','google','google_pmax','google_search','crm','ga4','tiktok']));

-- בדיקה
select pg_get_constraintdef(oid) from pg_constraint where conname = 'reports_source_check';

-- ROLLBACK:
-- delete from public.reports where source = 'tiktok';
-- alter table public.reports drop constraint if exists reports_source_check;
-- alter table public.reports add constraint reports_source_check
--   check (source = any (array['facebook','google','google_pmax','google_search','crm','ga4']));
