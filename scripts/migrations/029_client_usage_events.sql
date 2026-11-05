-- 029 — מה לקוחות עושים בדשבורד (ויטלי, 6.11): "לקבל יותר מידע על השימוש של הלקוחות ... להבין איך לשפר עבורם"
--
-- client_sessions כבר רושם כניסה, יציאה ופרויקט. כאן נוספים:
--   1. client_events — פעולות בתוך הכניסה: טאב, תקופה, השוואה, סעיפים שנצפו (3 שניות ומעלה על המסך),
--      "איך זה עוזר לך?", ניתוח דוח, חלונות לידים. בלי פרטי לידים: רק שם הפעולה ושם הסעיף/הטאב.
--   2. בטבלת הכניסות: active_sec (זמן שבו המסך פתוח והלקוח באמת פעל — לא לשונית שנשכחה פתוחה)
--      ו-device (טלפון / טאבלט / מחשב).
-- נכתב ונקרא רק מהשרת (app/api/client-log, service_role), כמו client_sessions.

create table if not exists public.client_events (
  id           bigint generated always as identity primary key,
  session_id   uuid not null references public.client_sessions(id) on delete cascade,
  email        text not null,
  project_name text,
  name         text not null,                    -- tab / period / compare / section / help / ai_open / modal
  detail       jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);
create index if not exists client_events_email_at on public.client_events (email, at desc);
create index if not exists client_events_at on public.client_events (at desc);
create index if not exists client_events_session on public.client_events (session_id);

alter table public.client_events enable row level security;   -- בלי policies: רק service_role

alter table public.client_sessions add column if not exists active_sec integer;
alter table public.client_sessions add column if not exists device text;

-- בדיקה
select (select count(*) from public.client_events) as events,
       (select count(*) from information_schema.columns where table_name = 'client_sessions' and column_name in ('active_sec', 'device')) as new_cols;

-- ROLLBACK:
-- drop table if exists public.client_events;
-- alter table public.client_sessions drop column if exists active_sec;
-- alter table public.client_sessions drop column if exists device;
