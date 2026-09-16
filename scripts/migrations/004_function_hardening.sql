-- ═══════════════════════════════════════════════════════════════════════════
-- 004_function_hardening.sql
--
-- שלוש הערות מבודק האבטחה של Supabase (16.9.2026), כולן קטנות:
--
-- 1. שתי פונקציות טריגר בלי search_path קבוע. פונקציה כזאת מחפשת אובייקטים
--    לפי ה-search_path של מי שמפעיל אותה, ותוקף עם הרשאת יצירת סכמה יכול
--    "להחליף" לה פונקציה. אצלנו הגופים משתמשים רק ב-now(), אז זה תיאורטי,
--    אבל התיקון הוא שורה אחת לכל פונקציה.
-- 2. is_admin() ניתנת להפעלה גם ל-anon (מי שלא מחובר). היא מחזירה false
--    בלי JWT, אז אין דליפה — אבל אין גם סיבה שתהיה חשופה. authenticated נשאר,
--    כי מדיניות ה-RLS מופעלות בהרשאת המשתמש המחובר וקוראות לה.
--
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter function public.reports_set_updated_at()     set search_path = '';
alter function public.vitas_tasks_set_updated_at() set search_path = '';

-- ברירת המחדל של Postgres מעניקה EXECUTE ל-PUBLIC, שכולל את anon — לכן revoke
-- מ-anon לבד לא משנה כלום. מסירים מ-PUBLIC ומעניקים במפורש למי שצריך.
-- כל המדיניות שקוראות ל-is_admin() הן `to authenticated`, אז anon לא נפגע.
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated, service_role;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   alter function public.reports_set_updated_at()     reset search_path;
--   alter function public.vitas_tasks_set_updated_at() reset search_path;
--   grant execute on function public.is_admin() to public;
-- ═══════════════════════════════════════════════════════════════════════════
