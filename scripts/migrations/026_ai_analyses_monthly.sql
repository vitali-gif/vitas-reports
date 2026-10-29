-- ════════════════════════════════════════════════════════════════════════════
-- 026_ai_analyses_monthly.sql — ניתוח AI מהדוח החודשי נשמר כ-'monthly'
-- ════════════════════════════════════════════════════════════════════════════
--
-- למה
-- ───
-- ויטלי (29.10): דוח PDF אוטומטי ב-5 לכל חודש, עם סיכום מניתוח AI
-- (/api/cron/monthly-report, lib/monthly-report.js). כשאין עדיין ניתוח לחודש, הקרון מריץ אחד
-- ושומר אותו ב-ai_analyses. ה-CHECK של עמודת trigger מכיר רק 'manual' ו-'weekly'.
--
-- בלי המיגרציה הזו שום דבר לא נשבר: הקרון שומר את הניתוח כ-'manual' (created_by='cron-monthly').
-- אחריה — כ-'monthly', וברשימת הניתוחים רואים מאיפה הוא הגיע.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.ai_analyses drop constraint if exists ai_analyses_trigger_check;
alter table public.ai_analyses add constraint ai_analyses_trigger_check
  check (trigger in ('manual', 'weekly', 'monthly'));

commit;

-- בדיקה אחרי ההרצה:
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_analyses_trigger_check';
--   → CHECK ((trigger = ANY (ARRAY['manual'::text, 'weekly'::text, 'monthly'::text])))

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- ניתוחים חודשיים שכבר נשמרו הופכים קודם ל-'manual', אחרת ה-CHECK הישן נכשל עליהם.
--
-- begin;
--   update public.ai_analyses set trigger = 'manual' where trigger = 'monthly';
--   alter table public.ai_analyses drop constraint if exists ai_analyses_trigger_check;
--   alter table public.ai_analyses add constraint ai_analyses_trigger_check
--     check (trigger in ('manual', 'weekly'));
-- commit;
