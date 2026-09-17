-- ═══════════════════════════════════════════════════════════════════════════
-- 012_ad_daily_coverage_index.sql
--
-- הבעיה (17.9): ad_daily_coverage() (חיישן הבריאות, /api/v1/health, daily-sync) עוברת על כל
-- הטבלה — 114k שורות / 60MB — ולוקחת 1.7–6.5 שניות. עם ה-backfill לינואר היא תכפיל את עצמה,
-- וכבר נפלה פעם אחת על statement timeout (צהוב "חיישן לא זמין" בדוח היומי).
--
-- הפתרון: אינדקס שמכיל בדיוק את העמודות שהפונקציה צריכה (source, account, day, fetched_at),
-- כך שהיא רצה כ-index-only scan על ~5MB במקום לקרוא את כל ה-heap. אותה חתימה, אותן תוצאות.
-- הרצה חוזרת בטוחה. rollback בתחתית.
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists ad_daily_coverage_idx
  on public.ad_daily (source, account, day, fetched_at);

analyze public.ad_daily;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop index if exists public.ad_daily_coverage_idx;
-- ═══════════════════════════════════════════════════════════════════════════
