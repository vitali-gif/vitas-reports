-- 028 — סיווג קריאייטיב של מודעות, לניתוח "מה עובד במודעות" (A/B) — ויטלי, 5.11
--
-- לכל מודעת פייסבוק: מה רואים בה (אנשים, הדמיית פנים/חוץ, סוג נכס, מחיר, צבע, זווית המסר).
-- הסיווג נעשה פעם אחת לכל מודעה (app/api/cron/ad-tags, מודל של Anthropic על התמונה והטקסט,
-- בערך 5 אגורות למודעה) ונשמר כאן. הדוחות מצרפים אותו לביצועים (lib/ad-tags.js).
-- אין כאן פרטי לידים; רק תיאור המודעה. גישה: שרת בלבד (service_role), כמו שאר הטבלאות הפנימיות.

create table if not exists public.ad_creative_tags (
  ad_id      text primary key,               -- מזהה המודעה במטא
  account    text not null,                  -- חשבון המודעות
  ad_name    text,
  image_url  text,                           -- התמונה שסווגה (או תמונת הפתיחה של סרטון)
  is_video   boolean not null default false,
  tags       jsonb not null,                 -- { people, visual, property, price, color, angle }
  model      text,
  tagged_at  timestamptz not null default now()
);
create index if not exists ad_creative_tags_account on public.ad_creative_tags (account);

alter table public.ad_creative_tags enable row level security;   -- בלי policies: רק service_role

-- בדיקה: הטבלה קיימת וריקה
select count(*) as tagged from public.ad_creative_tags;

-- ROLLBACK:
-- drop table if exists public.ad_creative_tags;
