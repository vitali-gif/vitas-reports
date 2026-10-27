-- ════════════════════════════════════════════════════════════════════════════
-- 024_ai_analyses.sql — שמירת ניתוחי ה-AI לפי פרויקט
-- ════════════════════════════════════════════════════════════════════════════
--
-- למה
-- ───
-- ויטלי (27.10): "סוכן AI שינתח לפי פרויקט/לקוח את השינויים בעצמו" — באדמין בלבד, בלחיצה
-- ופעם בשבוע. כל ניתוח עולה כסף (קריאה ל-Claude), ולכן הוא נשמר: חוזרים אליו בלי לשלם שוב,
-- ורואים איך התמונה השתנתה משבוע לשבוע. הקוד: lib/ai-analysis.js, /api/ai/*, /api/cron/ai-weekly.
--
-- מה נשמר
-- ───────
--   period_key / compare_key — אותם מפתחות כמו בדשבורד ('2026-10', '2026-10-19_2026-10-25').
--   trigger                  — 'manual' (כפתור) או 'weekly' (קרון).
--   input                    — מה שנשלח ל-Claude (lib/ai-analysis.js › analysisInput): סכומים
--                              ושמות קמפיינים/מקורות/נציגים בלבד. בלי שמות או טלפונים של לידים.
--   result                   — התשובה (כותרת, שינויים, הסברים, פעולות, מה לבדוק).
--   usage                    — טוקנים ועלות משוערת בדולרים, למעקב הוצאות.
--
-- RLS
-- ───
-- מופעל, בלי אף מדיניות: רק ה-service role (השרת) קורא וכותב. הטבלה לא נגישה מהדפדפן עם
-- המפתח הציבורי, ולקוח לא רואה אותה גם אם ינסה. ה-routes בודקים requireAdmin.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.ai_analyses (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  period_key   text not null,
  compare_key  text,
  trigger      text not null default 'manual' check (trigger in ('manual', 'weekly')),
  model        text,
  input        jsonb not null,
  result       jsonb not null,
  usage        jsonb,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists ai_analyses_project_created_idx
  on public.ai_analyses (project_id, created_at desc);

alter table public.ai_analyses enable row level security;

comment on table public.ai_analyses is
  'ניתוחי AI לפי פרויקט (אדמין בלבד). נכתב ונקרא רק מהשרת (service role). lib/ai-analysis.js';

commit;

-- בדיקה אחרי ההרצה:
-- select count(*) from public.ai_analyses;   -- 0
--
-- כמה עלו הניתוחים החודש:
-- select count(*), round(sum((usage->>'costUsd')::numeric), 2) as usd
--   from public.ai_analyses where created_at >= date_trunc('month', now());

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ מוחק את כל הניתוחים השמורים.
--
-- begin;
--   drop table if exists public.ai_analyses;
-- commit;
--
-- אחרי rollback: הכפתור "ניתוח AI" מחזיר שגיאה ברורה (הטבלה חסרה), שאר הדשבורד לא מושפע.
