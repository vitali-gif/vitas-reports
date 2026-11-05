-- 030 — קליטת לקוח חדש: באיזה שלב כל פרויקט (ויטלי, 6.11)
-- "שאוכל לדעת באיזה שלב כל לקוח שמתחיל, וגם לתת לשחר השותף שלי יותר הבנה ושהוא יעזור לי".
--
-- השלבים עצמם מוגדרים בקוד (lib/onboarding-steps.js) — כאן רק המצב של כל שלב בכל פרויקט:
-- סטטוס, מי אחראי, הערה, ומי עדכן אחרון. שורה שאין לה רשומה = "לא התחיל".
-- גישה: שרת בלבד (app/api/onboarding, requireAdmin), כמו שאר הטבלאות הפנימיות.

create table if not exists public.project_onboarding (
  project_id  uuid not null references public.projects(id) on delete cascade,
  step        text not null,                      -- המפתח מ-lib/onboarding-steps.js
  status      text not null default 'todo',
  owner       text,                               -- vitali / shachar / claude / client
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (project_id, step),
  constraint project_onboarding_status_chk check (status in ('todo', 'doing', 'done', 'na')),
  constraint project_onboarding_owner_chk check (owner is null or owner in ('vitali', 'shachar', 'claude', 'client'))
);

alter table public.project_onboarding enable row level security;   -- בלי policies: רק service_role

-- בדיקה
select count(*) as rows from public.project_onboarding;

-- ROLLBACK:
-- drop table if exists public.project_onboarding;
