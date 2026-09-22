-- ═══════════════════════════════════════════════════════════════════════════
-- 021_ad_daily_fetch_log.sql
--
-- רישום מה באמת נמשך, במקום להסיק את ההתקדמות מ-min(day) ב-ad_daily.
--
-- הבאג (נמצא 22.9.2026, דרך תלונת לקוח על אריקה כרמל / BCureLaser)
-- ──────────────────────────────────────────────────────────────────
-- "חודש נוכחי" בדשבורד מגיע מטבלת reports (משיכה חיה מהפלטפורמה, שלמה), וכל טווח
-- תאריכים מותאם מגיע מ-ad_daily. כשחסרים ב-ad_daily ימים, השניים מציגים שני
-- מספרים שונים לאותה תקופה. ב-BCureLaser בספטמבר: 64,679 ₪ מול 35,109 ₪.
--
-- איך נוצרים החורים — שרשרת של שלושה:
--   1. metaFetchAll עצר את הדפדוף אחרי 50 עמודים והחזיר את מה שהספיק *בלי שגיאה*.
--   2. syncOne מוחק את כל הטווח המבוקש ואז כותב את מה שחזר. משיכה חלקית =
--      מחיקה של ימים שלא נכתבו מחדש.
--   3. הסמן של ה-backfill היה min(day) ב-ad_daily. אחרי שהזנב נמחק, min(day) כבר
--      מצביע על יום מוקדם יותר — ולכן הריצה הבאה מדלגת מעל החור לנצח.
-- הריצה הלילית מכסה רק 7 ימים אחורה, אז גם היא לא חוזרת לשם.
--
-- הטבלה הזאת שוברת את החוליה השלישית: יום נרשם כאן כשהמשיכה שלו *הושלמה*, גם אם
-- לא חזרו ממנה שורות. כך "אין הוצאה ביום הזה" ו"היום הזה מעולם לא נמשך" מפסיקים
-- להיראות אותו דבר — וזה גם מה שעצר את ה-backfill של חשבון 805919712416404,
-- שביקש את אותו טווח ריק בכל שעה מחדש (B9 ב-docs/TASKS.md).
--
-- הזריעה למטה מסמנת כל יום שכבר קיים ב-ad_daily כ"נמשך", ולכן החורים — ורק הם —
-- נשארים לא רשומים ונמשכים מחדש מעצמם בריצות ה-backfill הבאות.
--
-- RLS דלוק בלי מדיניות: service_role בלבד. אין PII בטבלה.
-- הרצה חוזרת בטוחה (idempotent). rollback בתחתית הקובץ.
--
-- ⚠️ שני חלקים — מריצים בנפרד, לא הכל בהדבקה אחת.
--    חלק 1 (DDL) מיידי. חלק 2 (זריעה) סורק את ad_daily ולוקח כמה שניות.
--    אם חלק 2 נופל על timeout, יש בתחתיתו גרסה מחולקת לפי חודש.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- חלק 1 מתוך 2 — הטבלה. מיידי.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

create table if not exists public.ad_daily_fetch (
  source     text        not null,               -- 'facebook' | 'google'
  account    text        not null,               -- מזהה חשבון מודעות / customer id
  day        date        not null,
  fetched_at timestamptz not null default now(),
  rows       integer     not null default 0,     -- כמה שורות נכתבו ליום הזה (0 = נמשך, אין הוצאה)
  primary key (source, account, day)
);

create index if not exists ad_daily_fetch_acct_day_idx
  on public.ad_daily_fetch (source, account, day);

alter table public.ad_daily_fetch enable row level security;
-- אין policies בכוונה: רק service_role.

commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- חלק 2 מתוך 2 — זריעה: מה שכבר יש ב-ad_daily נחשב נמשך.
--
-- רק ימים שקיימים בפועל. חור נשאר לא רשום, וה-backfill ימשוך אותו מחדש.
--
-- עלות: זול. ad_daily_coverage_idx הוא על (source, account, day, fetched_at) ולכן
-- מכסה את השאילתה במלואה — Parallel Index Only Scan על אינדקס של 2.6MB, בלי לגעת
-- ב-heap של 157MB. נמדד ב-EXPLAIN: cost 7,322.
--
-- (להשוואה, ולתיעוד: שאילתת ביקורת עם `like '%שם-קמפיין%'` על אותה טבלה היא
--  Parallel Seq Scan בעלות 22,527 וקוראת את כל ה-heap. shared_buffers כאן הוא
--  224MB, ו-ad_daily לבדה 157MB — כמה סריקות כאלה ברצף מפנות את המטמון ומאטות
--  את כל הדשבורד. זה מה שקרה ב-22.9 בצהריים, ולא הזריעה הזאת.)
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.ad_daily_fetch (source, account, day, fetched_at, rows)
select source, account, day, max(fetched_at), count(*)::int
from public.ad_daily
group by source, account, day
on conflict (source, account, day) do nothing;


-- ── אם בכל זאת נופל על timeout: אותה זריעה, חודש בכל פעם ────────────────────
-- מריצים שוב ושוב ומשנים את החודש. idempotent — אפשר לחזור על חודש שכבר נזרע.
--
--   insert into public.ad_daily_fetch (source, account, day, fetched_at, rows)
--   select source, account, day, max(fetched_at), count(*)::int
--   from public.ad_daily
--   where day >= date '2026-09-01' and day < date '2026-10-01'
--   group by source, account, day
--   on conflict (source, account, day) do nothing;
--
-- בדיקה שהזריעה שלמה (שני המספרים אמורים להיות זהים):
--   select (select count(*) from public.ad_daily_fetch) as seeded,
--          (select count(*) from (select 1 from public.ad_daily
--                                 group by source, account, day) x) as expected;

-- ═══════════════════════════════════════════════════════════════════════════
-- rollback
-- ═══════════════════════════════════════════════════════════════════════════
-- begin;
--   drop table if exists public.ad_daily_fetch;
-- commit;
--
-- הערה: אחרי rollback הקוד ב-lib/ads/daily-sync.js נופל חזרה לסמן הישן
-- (min(day) ב-ad_daily) רק אם מחזירים גם את הקוד. אין תלות בכיוון השני —
-- הטבלה יכולה להתקיים גם בלי הקוד שמשתמש בה.
