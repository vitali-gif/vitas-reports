-- ═══════════════════════════════════════════════════════════════════════════
-- 008_job_log.sql
--
-- לוג ריצות של עבודות רקע (daily-sync, prefetch-daily, ...). עד עכשיו התוצאה של
-- ריצת קרון חיה רק בתשובת ה-HTTP שחוזרת ל-cron-job.org — ואי אפשר לראות אחרי
-- המעשה למה משהו לא רץ (למשל: ad_daily נשארה ריקה אחרי הריצה הראשונה של 16.9).
--
-- שורה לכל ריצה: הצלחה/כישלון, משך, ופירוט קצר (jsonb, בלי PII). נגזם ל-30 יום.
-- RLS דלוק בלי מדיניות: service_role בלבד. נחשף החוצה רק דרך /api/v1/health (אגרגטים).
--
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.job_log (
  id      bigserial   primary key,
  job     text        not null,
  ran_at  timestamptz not null default now(),
  ok      boolean     not null,
  ms      integer,
  detail  jsonb
);

create index if not exists job_log_job_ran_idx on public.job_log (job, ran_at desc);

alter table public.job_log enable row level security;
-- אין policies בכוונה: רק service_role.

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop table if exists public.job_log;
-- ═══════════════════════════════════════════════════════════════════════════
