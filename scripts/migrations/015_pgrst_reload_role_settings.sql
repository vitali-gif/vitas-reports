-- 015 — ALTER ROLE ... SET לא מגיע ל-PostgREST בלי reload
--
-- ההמשך של 014 (statement_timeout=60s ל-service_role). נמצא 18.9.2026 בערב: גם אחרי שהמיגרציה
-- הוחלה (11:39 UTC) ה-rebuild של crm_compact ל-BMBY המשיך ליפול על "canceling statement due to
-- statement timeout" בכל ריצת קרון (12:38, 14:37–14:41, 16:37, 17:52 UTC — application_name=postgrest),
-- ו-crm_compact של HI PARK נשאר עם built_at של הבנייה הידנית בעוד crm_raw קיבל רשומות חדשות.
--
-- הסיבה: PostgREST קורא את הגדרות התפקידים המתחזים (pg_db_role_setting) בעלייה ובטעינת קונפיגורציה
-- מחדש בלבד, ומחיל אותן בעצמו בתחילת כל טרנזקציה. ALTER ROLE לבדו משנה את הקטלוג, אבל PostgREST
-- ממשיך עם הערכים שבזיכרון (ל-service_role: כלום → יורש 8s מ-authenticator) עד reload.
--
-- לכן אחרי כל ALTER ROLE ... SET/RESET על anon / authenticated / service_role חובה:

notify pgrst, 'reload config';

-- (הופעל ידנית ב-18.9.2026 18:55 UTC. אין נזק בהרצה חוזרת.)

-- בדיקה 1 — ההגדרה קיימת בקטלוג:
select rolname, rolconfig from pg_roles where rolname in ('authenticator', 'service_role');

-- בדיקה 2 — אחרי ריצת הקרון הבאה (prefetch-crm, כל שעתיים ב-:17/:37): built_at של פרויקטי BMBY
-- אמור להתקדם יחד עם source_fetched_at, ולא להישאר מאחור.
select p.name, c.crm_type, c.built_at, c.source_fetched_at, c.source_fetched_at - c.built_at as lag
from public.crm_compact c join public.projects p on p.id = c.project_id
order by c.crm_type, p.name;

-- בדיקה 3 — אין יותר statement timeouts מ-postgrest על rebuild_crm_compact (Logs → Postgres):
--   canceling statement due to statement timeout  (context: rebuild_crm_compact_bmby)
