-- ═══════════════════════════════════════════════════════════════════════════
-- 007_ad_daily.sql
--
-- שלב 2 של docs/daily-ranges-plan.md: עובדות יומיות של מודעות (Meta, Google).
--
-- שורה לכל יום × חשבון × מודעה × גיל × מגדר (Google: בלי גיל/מגדר). מכאן כל טווח
-- תאריכים הוא סכום של ימים שכבר שמורים — בלי לפנות ל-Meta/Google בזמן הבקשה.
-- הנתונים נשמרים לפי *חשבון מודעות*, לא לפי פרויקט: הניתוב לפרויקט (לפי חשבון,
-- לפי שם קמפיין, לפי סוכנות ב-KLOSS) נעשה בזמן החישוב, כמו היום ב-meta/fetch,
-- כדי ששינוי בהגדרת פרויקט ישתקף מיד גם על ההיסטוריה.
--
-- reach הוא לא ניתן לחיבור בין ימים (משתמשים ייחודיים). הוא נשמר כאן לשקיפות,
-- אבל לטווח מותאם הוא נשלף בקריאה קלה ל-Meta או מסומן כהערכה. ראה lib/ads/range-rows.js.
--
-- הסטטוסים (campaign_status וכו׳) הם תמונת מצב חיה — נדרסים בכל upsert, ובחישוב
-- לוקחים את הערך מהיום האחרון.
--
-- RLS דלוק בלי מדיניות: service_role בלבד. אין PII בטבלה.
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.ad_daily (
  source          text        not null,          -- 'facebook' | 'google'
  account         text        not null,          -- מזהה חשבון מודעות / customer id
  day             date        not null,
  row_key         text        not null,          -- md5 של שדות הזהות (ראה lib/ads/daily-store.js)
  campaign_id     text        not null default '',
  campaign        text        not null default '',
  adset_id        text        not null default '',
  adset           text        not null default '',
  ad_id           text        not null default '',
  ad              text        not null default '',
  age             text        not null default '',
  gender          text        not null default '',
  ad_text         text        not null default '',
  spend           numeric     not null default 0,
  impressions     bigint      not null default 0,
  reach           bigint      not null default 0,
  clicks          bigint      not null default 0,
  leads           numeric     not null default 0, -- Google: conversions יכולות להיות שבריות
  campaign_status text        not null default '',
  adset_status    text        not null default '',
  ad_status       text        not null default '',
  fetched_at      timestamptz not null default now(),
  primary key (source, account, day, row_key)
);

create index if not exists ad_daily_source_day_idx on public.ad_daily (source, day);

alter table public.ad_daily enable row level security;
-- אין policies בכוונה: רק service_role.

-- ── סכימה לטווח ─────────────────────────────────────────────────────────────
-- מחזירה שורה לכל (חשבון, קמפיין, סדרה, מודעה, גיל, מגדר) עם סכומים לטווח,
-- והסטטוסים/טקסט מהיום האחרון בטווח. הניתוב לפרויקט נעשה בקוד על התוצאה.
create or replace function public.ad_daily_aggregate(p_source text, p_since date, p_until date)
returns table (
  account text, campaign_id text, campaign text, adset_id text, adset text,
  ad_id text, ad text, age text, gender text,
  spend numeric, impressions bigint, reach bigint, clicks bigint, leads numeric,
  days integer, last_day date,
  ad_text text, campaign_status text, adset_status text, ad_status text
)
language sql stable
set search_path = ''
as $$
  select
    d.account, d.campaign_id, d.campaign, d.adset_id, d.adset,
    d.ad_id, d.ad, d.age, d.gender,
    sum(d.spend)::numeric, sum(d.impressions)::bigint, sum(d.reach)::bigint, sum(d.clicks)::bigint, sum(d.leads)::numeric,
    count(distinct d.day)::integer, max(d.day),
    (array_agg(d.ad_text         order by d.day desc))[1],
    (array_agg(d.campaign_status order by d.day desc))[1],
    (array_agg(d.adset_status    order by d.day desc))[1],
    (array_agg(d.ad_status       order by d.day desc))[1]
  from public.ad_daily d
  where d.source = p_source and d.day between p_since and p_until
  group by d.account, d.campaign_id, d.campaign, d.adset_id, d.adset, d.ad_id, d.ad, d.age, d.gender
$$;

-- ── כיסוי ──────────────────────────────────────────────────────────────────
-- איזה ימים כבר שמורים לכל מקור וחשבון. משמש את המילוי ההיסטורי ההדרגתי ואת חיישן ה-health.
create or replace function public.ad_daily_coverage()
returns table (source text, account text, min_day date, max_day date, days integer, rows bigint, last_fetched timestamptz)
language sql stable
set search_path = ''
as $$
  select d.source, d.account, min(d.day), max(d.day), count(distinct d.day)::integer, count(*)::bigint, max(d.fetched_at)
  from public.ad_daily d
  group by d.source, d.account
$$;

-- שתי הפונקציות רצות רק דרך service_role מהשרת.
revoke execute on function public.ad_daily_aggregate(text, date, date) from public, anon, authenticated;
revoke execute on function public.ad_daily_coverage() from public, anon, authenticated;
grant  execute on function public.ad_daily_aggregate(text, date, date) to service_role;
grant  execute on function public.ad_daily_coverage() to service_role;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop function if exists public.ad_daily_aggregate(text, date, date);
--   drop function if exists public.ad_daily_coverage();
--   drop table if exists public.ad_daily;
-- ═══════════════════════════════════════════════════════════════════════════
