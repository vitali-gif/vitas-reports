-- ═══════════════════════════════════════════════════════════════════════════
-- 006_crm_raw.sql
--
-- שלב 1 של docs/daily-ranges-plan.md: תמונת מצב גולמית של ה-CRM.
--
-- הרשומות שה-route של BMBY מושך (clients / tasks / price_offers / contracts)
-- נשמרות כאן רשומה-רשומה, במקום להיזרק אחרי החישוב. כל ריצת קרון מרעננת את
-- הרשומות שבחלון שלה (upsert לפי מזהה), ולכן הטבלה מצטברת עם הזמן וגם
-- מתעדכנת: ליד שסומן "לא רלוונטי" בדיעבד, פגישה שבוטלה — כולם נדרסים.
--
-- על התמונה הזאת רצה אותה פונקציית חישוב (lib/crm/bmby-summary.js) לכל טווח
-- תאריכים, בלי לפנות ל-BMBY. זה מה שמאפשר טווח מותאם מיידי.
--
-- הרשומות מכילות PII (שמות, טלפונים). RLS דלוק בלי מדיניות = service_role בלבד,
-- כמו admins / api_tokens. אף route לא חושף אותן ישירות; רק אגרגטים.
--
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.crm_raw (
  project_id  uuid        not null references public.projects(id) on delete cascade,
  crm_type    text        not null,              -- 'bmby' (בהמשך 'zoho', 'salesforce')
  entity      text        not null,              -- 'clients' | 'tasks' | 'price_offers' | 'contracts'
  ext_id      text        not null,              -- המזהה במערכת המקור (או גיבוב יציב כשאין)
  payload     jsonb       not null,              -- הרשומה כפי שהתקבלה
  fetched_at  timestamptz not null default now(),
  primary key (project_id, crm_type, entity, ext_id)
);

create index if not exists crm_raw_project_entity_idx
  on public.crm_raw (project_id, crm_type, entity);

alter table public.crm_raw enable row level security;
-- אין policies בכוונה: רק service_role קורא וכותב.

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop table if exists public.crm_raw;
-- ═══════════════════════════════════════════════════════════════════════════
