-- 014 — בניית crm_compact נופלת על statement timeout של 8 שניות
--
-- הבעיה (נמצאה 18.9.2026): הקרון קורא ל-rebuild_crm_compact_bmby דרך PostgREST (service_role).
-- ל-service_role אין הגדרת statement_timeout משלו, ולכן חל עליו ה-8s של authenticator.
-- ה-jsonb_agg על ~15k משימות של HI PARK (payload ~1.7MB) לוקח יותר מזה כשהמסד עמוס,
-- ולכן מאז 17.9 10:00 (שעון ישראל) אף בנייה של crm_compact ל-BMBY לא הצליחה —
-- הטווחים המיידיים (/api/reports/range) של HI PARK / ONCE / REHAVIA הוגשו מנתונים ישנים
-- בעוד source_fetched_at התעדכן (touchCompact) והציג אותם כטריים.
--
-- SET ברמת הפונקציה לא עוזר: statement_timeout נבדק ברמת ה-statement החיצוני, שכבר התחיל עם 8s.
-- הפתרון: timeout ייעודי ל-service_role (רק שרת: קרונים ו-routes; לא נגיש לדפדפן).
-- PostgREST מחיל הגדרות ALTER ROLE ... SET של התפקיד המתחזה בתחילת כל טרנזקציה.

alter role service_role set statement_timeout = '60s';

-- בנייה מיידית של ה-compact שהתיישן (רץ כאן כ-postgres, בלי מגבלת ה-8s).
-- rebuildCompactIfChanged בקרון בונה מחדש רק אחרי שינוי ב-crm_raw, אז לא מחכים לו.
select p.name, public.rebuild_crm_compact_bmby(p.id)
from public.projects p
where p.crm_type = 'bmby';

-- בדיקה: built_at אמור להיות עכשיו לכל פרויקטי BMBY
select p.name, c.crm_type, c.built_at, c.source_fetched_at
from public.crm_compact c join public.projects p on p.id = c.project_id
order by c.built_at desc;

-- ROLLBACK:
-- alter role service_role reset statement_timeout;
