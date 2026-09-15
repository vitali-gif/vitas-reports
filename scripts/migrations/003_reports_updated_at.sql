-- ═══════════════════════════════════════════════════════════════════════════
-- 003_reports_updated_at.sql
--
-- עמודת "עודכן לאחרונה" לטבלת הדוחות.
--
-- הרקע: הקרונים כותבים ל-reports ב-upsert על המפתח (project_id, source, month),
-- כלומר שורת החודש נוצרת פעם אחת ב-1 לחודש ומאז רק מתעדכנת במקום. created_at
-- נשאר קפוא על היום הראשון, ולכן התווית "עודכן לפני X" בדשבורד הראתה
-- "לפני 14 ימים" גם כשהמשיכה האחרונה הייתה הבוקר. גם lib/health.js נאלץ
-- לעקוף את זה ולהסיק את הרעננות משורות הטווח במקום משורת החודש.
--
-- הפתרון: updated_at שמתעדכן אוטומטית בטריגר בכל UPDATE. הקוד ב-
-- app/api/reports/by-project וב-PeriodState.jsx נופל ל-created_at כל עוד
-- העמודה לא קיימת, אז אפשר לפרוס את הקוד לפני או אחרי המיגרציה.
--
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.reports
  add column if not exists updated_at timestamptz not null default now();

-- שורות קיימות: הערך הטוב ביותר שיש לנו הוא created_at (ולא "עכשיו", שהיה
-- מציג "עודכן ממש עכשיו" על דוחות ישנים ומתים).
update public.reports
   set updated_at = created_at
 where updated_at > created_at + interval '1 minute'
   and updated_at > now() - interval '1 minute';

create or replace function public.reports_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_reports_updated_at on public.reports;
create trigger trg_reports_updated_at
  before update on public.reports
  for each row execute function public.reports_set_updated_at();

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop trigger if exists trg_reports_updated_at on public.reports;
--   drop function if exists public.reports_set_updated_at();
--   alter table public.reports drop column if exists updated_at;
-- ═══════════════════════════════════════════════════════════════════════════
