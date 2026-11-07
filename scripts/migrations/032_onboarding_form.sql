-- 032 — שאלון קליטה ללקוח (ויטלי, 7.11)
-- הלקוח מקבל קישור אישי לפרויקט (/onboard/<token>) וממלא: אנשי קשר, ערוצים, CRM, תהליך מכירה, הפרויקט ויעדים.
-- התשובות נשמרות כאן, ומשם מסמנות את השלבים ב-project_onboarding (lib/onboarding-form.js). שלב שסומן ידנית לא נדרס.
-- השאלות עצמן בקוד (lib/onboarding-form.js); כאן רק התשובות.
-- גישה: שרת בלבד. האדמין דרך /api/onboarding/form (requireAdmin); הלקוח דרך /api/public/onboarding-form — רק עם הטוקן.

create table if not exists public.onboarding_forms (
  project_id    uuid primary key references public.projects(id) on delete cascade,
  token         text not null unique,               -- 32 תווים אקראיים; מי שיש לו את הקישור יכול למלא
  answers       jsonb not null default '{}'::jsonb,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  submitted_at  timestamptz,                        -- הלקוח לחץ "סיימתי"
  revoked       boolean not null default false      -- קישור שבוטל — לא נפתח יותר
);

alter table public.onboarding_forms enable row level security;   -- בלי policies: רק service_role

-- בדיקה
select count(*) as forms from public.onboarding_forms;

-- ROLLBACK:
-- drop table if exists public.onboarding_forms;
