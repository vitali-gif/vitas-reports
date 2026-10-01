-- ═══════════════════════════════════════════════════════════════════════════
-- 023_ad_daily_aggregate_all.sql
--
-- סכימת המודעות לטווח, במעבר אחד — במקום 10 מעברים מלאים על ad_daily.
--
-- הרקע (1.10.2026, אריקה כרמל): ויטלי בחר "רבעון 3" ב-BCureLaser וקיבל "אין נתוני CRM
-- לתקופה זו", למרות שנתוני זוהו היו שמורים ומעודכנים. הסיבה לא הייתה ב-CRM:
-- /api/reports/range מחשב את ה-CRM ואת המודעות במקביל ומחזיר אותם בתשובה אחת, וחלק
-- המודעות לקח יותר מ-60 שניות — תקרת הפונקציה ב-Vercel. התשובה כולה נפלה, וה-CRM
-- שכבר חושב הלך איתה.
--
-- למה המודעות איטיות: ad_daily_aggregate (מיגרציה 007) מחזירה טבלה, ו-PostgREST מחזיר
-- עד 1000 שורות לבקשה. לרבעון יש ~9,200 שורות מסוכמות בפייסבוק, כלומר 10 עמודים —
-- וכל עמוד (offset) מריץ מחדש את כל הסכימה על ~115 אלף שורות יומיות, ~13.7 שניות
-- כל אחת, עם שפיכה לדיסק (array_agg ממוין על טקסט המודעה). נמדד בלוגים: 10 עמודים
-- ב-45 שניות ל-ISMOOTH, בזמן שהקרונים כותבים לאותה טבלה.
--
-- הפונקציה כאן:
--   • מחזירה jsonb אחד — בקשה אחת, סכימה אחת, בלי עמודים.
--   • מקבצת לפי (account, row_key) ולא לפי 9 עמודות טקסט. row_key הוא md5 של אותם
--     9 שדות זהות (lib/ads/daily-store.js), כך שהקיבוץ זהה — רק על מפתח קצר.
--   • את השדות "מהיום האחרון" (טקסט, סטטוסים, השמות עצמם) לוקחת בקריאה אחת במפתח
--     הראשי (source, account, day, row_key) לכל קבוצה, במקום array_agg ממוין.
-- נמדד על רבעון 3, פייסבוק: 3.5–7 שניות (תלוי בעומס) במקום 10 × 13.7.
--
-- הקוד (lib/ads/daily-store.js) קורא לפונקציה הזאת, ואם היא עוד לא קיימת — חוזר
-- לדרך הישנה (העמודים). כלומר אפשר להריץ את המיגרציה לפני או אחרי הפריסה.
-- הרצה חוזרת בטוחה. rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.ad_daily_aggregate_all(p_source text, p_since date, p_until date)
returns jsonb
language sql stable
set search_path = ''
set work_mem = '64MB'
as $$
  with g as (
    select d.account, d.row_key,
      sum(d.spend)::numeric        as spend,
      sum(d.impressions)::bigint   as impressions,
      sum(d.reach)::bigint         as reach,
      sum(d.clicks)::bigint        as clicks,
      sum(d.leads)::numeric        as leads,
      count(distinct d.day)::int   as days,
      max(d.day)                   as last_day
    from public.ad_daily d
    where d.source = p_source and d.day between p_since and p_until
    group by d.account, d.row_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'account', g.account,
    'campaign_id', x.campaign_id, 'campaign', x.campaign,
    'adset_id', x.adset_id, 'adset', x.adset,
    'ad_id', x.ad_id, 'ad', x.ad, 'age', x.age, 'gender', x.gender,
    'spend', g.spend, 'impressions', g.impressions, 'reach', g.reach, 'clicks', g.clicks, 'leads', g.leads,
    'days', g.days, 'last_day', g.last_day,
    'ad_text', x.ad_text, 'campaign_status', x.campaign_status, 'adset_status', x.adset_status, 'ad_status', x.ad_status
  )), '[]'::jsonb)
  from g
  cross join lateral (
    select y.campaign_id, y.campaign, y.adset_id, y.adset, y.ad_id, y.ad, y.age, y.gender,
           y.ad_text, y.campaign_status, y.adset_status, y.ad_status
    from public.ad_daily y
    where y.source = p_source and y.account = g.account and y.day = g.last_day and y.row_key = g.row_key
    limit 1
  ) x
$$;

revoke execute on function public.ad_daily_aggregate_all(text, date, date) from public, anon, authenticated;
grant  execute on function public.ad_daily_aggregate_all(text, date, date) to service_role;

commit;

-- בדיקה (אמורה לחזור תוך שניות, עם ~9,000 שורות לרבעון 3):
--   select jsonb_array_length(public.ad_daily_aggregate_all('facebook', '2026-07-01', '2026-09-30'));
--
-- השוואה מול הפונקציה הישנה (אותם סכומים בדיוק):
--   select (select round(sum(spend)) from public.ad_daily_aggregate('facebook', '2026-07-01', '2026-09-30')) as old_spend,
--          (select round(sum((e->>'spend')::numeric)) from jsonb_array_elements(
--             public.ad_daily_aggregate_all('facebook', '2026-07-01', '2026-09-30')) e) as new_spend;


-- ═══════════════════════════════════════════════════════════════════════════
-- rollback
-- ═══════════════════════════════════════════════════════════════════════════
--   drop function if exists public.ad_daily_aggregate_all(text, date, date);
--
-- אחרי rollback הקוד חוזר לבד לפונקציה הישנה (העמודים) — איטי, אבל עובד.
