-- ═══════════════════════════════════════════════════════════════════════════
-- 002_rate_limits.sql
--
-- טבלת מונים להגבלת קצב (lib/rate-limit.js). נדרשת ל-/api/client-auth, שהוא
-- ציבורי בכוונה ושולח מיילים — כלומר נקודת קצה שאפשר לנצל גם להצפת תיבות
-- וגם למיפוי אילו כתובות מייל קיימות במערכת.
--
-- עד שהמיגרציה הזאת תרוץ, lib/rate-limit.js עובר במצב fail-open ורושם אזהרה
-- ללוג. שום דבר לא נשבר בלעדיה — פשוט אין הגבלה.
--
-- הרצה חוזרת בטוחה (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.rate_limits (
  id                text primary key,          -- '<bucket>:<key>', למשל 'client-auth:foo@bar.com'
  hits              integer not null default 0,
  window_started_at timestamptz not null default now()
);

-- לגיזום תקופתי של שורות ישנות
create index if not exists rate_limits_window_idx
  on public.rate_limits (window_started_at);

alter table public.rate_limits enable row level security;
-- אין policies בכוונה: רק service_role כותב וקורא כאן.

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- גיזום — כדאי להריץ מדי פעם, או להוסיף לקרון הקיים:
--   delete from public.rate_limits where window_started_at < now() - interval '1 day';
--
-- ROLLBACK:
--   drop table if exists public.rate_limits;
-- ═══════════════════════════════════════════════════════════════════════════
