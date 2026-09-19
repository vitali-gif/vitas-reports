-- ═══════════════════════════════════════════════════════════════════════════
-- 017_marketing_meetings.sql
--
-- שלב 1 של פיצ'ר "ישיבות שיווק ומכירות" (design/handoff-meetings, docs/meetings-plan.md).
-- המסלול שנבנה כאן הוא הידני מקצה לקצה: יצירת ישיבה → העלאת תמלול → סיכום → אישור →
-- משימות ומעקב. אין כאן שום דבר שקשור ליומנים, ל-OAuth או לתמלול אוטומטי; אלה שלבים 2–5.
--
-- ═══ שתי החלטות שכדאי להכיר לפני שקוראים את הסכימה ═══
--
-- 1. התמלול נשמר כאן ב-Postgres ולא באחסון קבצים. המאגר כבר מטפל בשגרה בשורות של
--    5MB (crm_compact) ועד 25MB (reports.data); תמלול של ישיבה חודשית קטן מזה בסדר גודל.
--    הקמת שכבת אחסון חדשה, עם מערכת הרשאות משלה שאינה ה-RLS של הטבלאות, היא עלות בלי
--    החזר בשלב הזה. קובצי אודיו לתמלול (שלב 5) כן ידרשו אחסון — לא כאן.
--
-- 2. משימות מישיבה מקבלות טבלה משלהן ולא מתווספות ל-vitas_tasks. הטבלה ההיא היא ישות של
--    המלצה שננעלה: app/api/tasks/create/route.js דוחה בקשה בלי recommendation_key,
--    metric_type ו-baseline_value, ה-role שלה הוא אחד מארבעה תפקידי שיווק ולא אדם,
--    ו-meeting_date שם הוא תאריך הנעילה שממנו סופרים 28 יום למדידת השפעה. שימוש חוזר היה
--    דורש להמציא ערכים לשלושה שדות חובה ולשבור את מדידת ההשפעה של ההמלצות הקיימות.
--
-- ═══ אבטחה ═══
-- RLS דלוק בלי אף policy בכל הטבלאות — service_role בלבד, הדפוס של 001_rls_lockdown.sql
-- לטבלאות שהדפדפן לא קורא ישירות. תמלול של ישיבת הנהלה הוא המידע הרגיש ביותר שייכנס
-- למערכת, ולכן הגישה אליו עוברת רק דרך routes שמפעילים requireProjectAccess.
-- כל טבלה שה-route ניגש אליה לפי מזהה שלה נושאת project_id, כדי שאפשר יהיה לאמת הרשאה
-- בלי join (הדפוס של app/api/tasks/update/route.js: קודם שולפים את הפרויקט, ואז בודקים).
--
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── טריגר משותף ל-updated_at (הדפוס של 003_reports_updated_at.sql) ──────────
-- search_path מקובע לפי 004_function_hardening.sql.
create or replace function public.meetings_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── 1. הישיבה ───────────────────────────────────────────────────────────────
-- status: draft → scheduled → ended, וגם cancelled. "המועד חלף" אינו הוכחה שהישיבה
-- התקיימה, ולכן ended נקבע במפורש ולא לפי השעון.
create table if not exists public.marketing_meetings (
  id              uuid        primary key default gen_random_uuid(),
  project_id      uuid        not null references public.projects(id) on delete cascade,
  title           text        not null,
  start_at        timestamptz,
  end_at          timestamptz,
  timezone        text        not null default 'Asia/Jerusalem',
  organizer_email text        not null,
  status          text        not null default 'draft',
  agenda          text,
  join_url        text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint marketing_meetings_status_chk
    check (status in ('draft', 'scheduled', 'ended', 'cancelled')),
  constraint marketing_meetings_time_chk
    check (start_at is null or end_at is null or start_at < end_at)
);

create index if not exists marketing_meetings_project_start_idx
  on public.marketing_meetings (project_id, start_at desc nulls last);

drop trigger if exists trg_marketing_meetings_updated_at on public.marketing_meetings;
create trigger trg_marketing_meetings_updated_at
  before update on public.marketing_meetings
  for each row execute function public.meetings_set_updated_at();

-- ── 2. מוזמנים ──────────────────────────────────────────────────────────────
-- role_label הוא תווית בלבד ("מנהל הקמפיינים"). לפי UX-SPEC אסור לשלוח הזמנה לתפקיד
-- בלי כתובת אמיתית, ולכן email נשאר null עד שמישהו משלים אותו — ואז ה-UI מסמן "להשלמה".
create table if not exists public.meeting_invitees (
  id           uuid        primary key default gen_random_uuid(),
  meeting_id   uuid        not null references public.marketing_meetings(id) on delete cascade,
  email        text,
  display_name text,
  role_label   text,
  created_at   timestamptz not null default now()
);

create index if not exists meeting_invitees_meeting_idx
  on public.meeting_invitees (meeting_id);

-- ── 3. חומרים (שלב 1: תמלול שהועלה, או קישור להקלטה לצפייה בלבד) ────────────
-- source_digest הוא ה-hash של התוכן המנורמל. הוא מונע שהעלאה כפולה של אותו קובץ תיצור
-- מקטעים כפולים ומשימות כפולות. external_url לצפייה בלבד — צירוף קישור אינו מעניק הרשאה
-- להוריד אותו, ואין כאן שום fetch אוטומטי של כתובות.
create table if not exists public.meeting_artifacts (
  id            uuid        primary key default gen_random_uuid(),
  meeting_id    uuid        not null references public.marketing_meetings(id) on delete cascade,
  kind          text        not null,
  source        text        not null,
  filename      text,
  external_url  text,
  language      text,
  source_digest text,
  segment_count integer,
  status        text        not null default 'available',
  created_by    text,
  created_at    timestamptz not null default now(),
  constraint meeting_artifacts_kind_chk   check (kind in ('transcript', 'recording_link')),
  constraint meeting_artifacts_source_chk check (source in ('upload', 'link')),
  constraint meeting_artifacts_status_chk check (status in ('available', 'processing', 'failed'))
);

create unique index if not exists meeting_artifacts_digest_uidx
  on public.meeting_artifacts (meeting_id, source_digest)
  where source_digest is not null;

create index if not exists meeting_artifacts_meeting_idx
  on public.meeting_artifacts (meeting_id);

-- ── 4. מקטעי התמלול ─────────────────────────────────────────────────────────
-- start_ms/end_ms קיימים רק כשהמקור סיפק אותם (VTT/SRT). ב-TXT הם null, ולפי
-- AI-SUMMARY-CONTRACT אסור להמציא timestamp — מפנים למקטע לפי seq במקום לפי זמן.
create table if not exists public.transcript_segments (
  artifact_id uuid    not null references public.meeting_artifacts(id) on delete cascade,
  seq         integer not null,
  start_ms    integer,
  end_ms      integer,
  speaker     text,
  text        text    not null,
  primary key (artifact_id, seq)
);

-- ── 5. גרסאות הסיכום ────────────────────────────────────────────────────────
-- generator: human בשלב 1 (המנהל כותב/עורך), ai משלב 2. חומר שמגיע מאוחר לא דורס סיכום
-- מאושר — נוצרת גרסה חדשה, ולכן המפתח הוא (meeting_id, version).
create table if not exists public.meeting_summaries (
  id                 uuid        primary key default gen_random_uuid(),
  meeting_id         uuid        not null references public.marketing_meetings(id) on delete cascade,
  version            integer     not null,
  status             text        not null default 'draft',
  source_artifact_id uuid        references public.meeting_artifacts(id) on delete set null,
  key_points         jsonb       not null default '[]'::jsonb,
  decisions          jsonb       not null default '[]'::jsonb,
  open_questions     jsonb       not null default '[]'::jsonb,
  generator          text        not null default 'human',
  model_version      text,
  prompt_version     text,
  approved_by        text,
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint meeting_summaries_status_chk    check (status in ('draft', 'approved')),
  constraint meeting_summaries_generator_chk check (generator in ('human', 'ai')),
  constraint meeting_summaries_version_chk   check (version >= 1),
  unique (meeting_id, version)
);

drop trigger if exists trg_meeting_summaries_updated_at on public.meeting_summaries;
create trigger trg_meeting_summaries_updated_at
  before update on public.meeting_summaries
  for each row execute function public.meetings_set_updated_at();

-- ── 6. משימות ───────────────────────────────────────────────────────────────
-- שני צירים נפרדים בכוונה: status הוא מצב ביצוע, ו-review_at הוא מועד בדיקה. "נבדוק
-- בחודש הבא" אינו אומר שהפעולה בוצעה, ולכן אסור לדחוס את שניהם לשדה אחד.
-- due_at ו-review_at הם date ולא timestamptz: מועד יעד הוא יום, לא רגע.
-- completed_at הוא רגע אמיתי. implemented_at הוא היום שבו השינוי העסקי הוחל בפועל,
-- והוא יכול להיות שונה מ-completed_at.
create table if not exists public.meeting_tasks (
  id                 uuid        primary key default gen_random_uuid(),
  meeting_id         uuid        not null references public.marketing_meetings(id) on delete cascade,
  project_id         uuid        not null references public.projects(id) on delete cascade,
  summary_version    integer,
  title              text        not null,
  description        text,
  assignee_email     text,
  assignee_label     text,
  due_at             date,
  review_at          date,
  status             text        not null default 'proposed',
  completed_at       timestamptz,
  implemented_at     date,
  source_segment_ids jsonb,
  human_added        boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint meeting_tasks_status_chk
    check (status in ('proposed', 'open', 'in_progress', 'done', 'blocked', 'cancelled', 'needs_details'))
);

create index if not exists meeting_tasks_project_status_idx
  on public.meeting_tasks (project_id, status);

create index if not exists meeting_tasks_meeting_idx
  on public.meeting_tasks (meeting_id);

-- תזכורות הדשבורד נגזרות מהאינדקס הזה: משימות פתוחות שהגיע מועד הבדיקה שלהן.
create index if not exists meeting_tasks_review_idx
  on public.meeting_tasks (project_id, review_at)
  where status not in ('done', 'cancelled');

drop trigger if exists trg_meeting_tasks_updated_at on public.meeting_tasks;
create trigger trg_meeting_tasks_updated_at
  before update on public.meeting_tasks
  for each row execute function public.meetings_set_updated_at();

-- ── 7. שיתוף הסיכום ─────────────────────────────────────────────────────────
-- שורה לכל נמען בכל שליחה. כשל בשליחה אינו מבטל את האישור, ו-retry שולח שוב בלי לאשר
-- מחדש ובלי ליצור משימות מחדש — לכן השיתוף הוא טבלה נפרדת ולא שדה על הסיכום.
create table if not exists public.meeting_shares (
  id              uuid        primary key default gen_random_uuid(),
  meeting_id      uuid        not null references public.marketing_meetings(id) on delete cascade,
  summary_version integer     not null,
  recipient_email text        not null,
  delivery_status text        not null default 'queued',
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  constraint meeting_shares_status_chk check (delivery_status in ('queued', 'sent', 'failed'))
);

create index if not exists meeting_shares_meeting_idx
  on public.meeting_shares (meeting_id, summary_version);

-- ── RLS: דלוק, בלי policies. service_role בלבד. ─────────────────────────────
alter table public.marketing_meetings  enable row level security;
alter table public.meeting_invitees    enable row level security;
alter table public.meeting_artifacts   enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.meeting_summaries   enable row level security;
alter table public.meeting_tasks       enable row level security;
alter table public.meeting_shares      enable row level security;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- אימות אחרי ההרצה — אמור להחזיר 7 שורות, כולן rls_enabled=true ו-policies=0:
--
--   select c.relname as table, c.relrowsecurity as rls_enabled,
--          (select count(*) from pg_policies p
--             where p.schemaname='public' and p.tablename=c.relname) as policies
--     from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public'
--      and c.relname in ('marketing_meetings','meeting_invitees','meeting_artifacts',
--                        'transcript_segments','meeting_summaries','meeting_tasks','meeting_shares')
--    order by 1;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (בסדר הפוך לתלויות):
--   drop table if exists public.meeting_shares;
--   drop table if exists public.meeting_tasks;
--   drop table if exists public.meeting_summaries;
--   drop table if exists public.transcript_segments;
--   drop table if exists public.meeting_artifacts;
--   drop table if exists public.meeting_invitees;
--   drop table if exists public.marketing_meetings;
--   drop function if exists public.meetings_set_updated_at();
-- ═══════════════════════════════════════════════════════════════════════════
