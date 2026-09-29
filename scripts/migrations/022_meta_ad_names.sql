-- ═══════════════════════════════════════════════════════════════════════════
-- 022_meta_ad_names.sql
--
-- שם מודעה לפי מזהה, בשאילתה אחת ובאינדקס — במקום 600 סריקות של ad_daily.
--
-- הרקע (29.9.2026): התיקון של ש.ברוך (PR #62) משלים שם מודעה ללידים שהגיעו מ-BMBY
-- עם מזהה בלבד. הוא עשה זאת בשאילתה נפרדת לכל מזהה על ad_daily (~415 אלף שורות,
-- 316MB), וזה בלי אינדקס על ad_id. כל שאילתה כזאת לקחה 10–52 שניות, והיא רצה בכל
-- פתיחה של טווח תאריכים בפרויקט של ש.ברוך. ב-12:17 UTC זה הציף את בסיס הנתונים:
-- עדכון של שורה אחת ב-auth.users לקח 97 שניות, ובין 12:18 ל-12:22 הבסיס הפסיק לקבל
-- חיבורים — כניסות נכשלו, ובדיקת ה-E2E נפלה.
--
-- הקוד כבר לא מריץ את הסריקה (lib/crm/meta-ad-names.js): הוא קורא לפונקציה למטה, ואם
-- היא עוד לא קיימת — מוותר על ההשלמה (הלידים מוצגים לפי המזהה, בלי שם). כלומר עד
-- שהמיגרציה הזאת רצה אין עומס וגם אין שמות; אחריה — שמות, בכמה אלפיות שנייה.
--
-- שני חלקים — מריצים בנפרד, לא הכל בהדבקה אחת:
--   חלק 1: האינדקס. CONCURRENTLY כדי לא לחסום את הקרונים שכותבים ל-ad_daily, ולכן
--          אסור שיהיה בתוך טרנזקציה. כמה שניות.
--   חלק 2: הפונקציה. מיידי.
-- הרצה חוזרת בטוחה. rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- חלק 1 מתוך 2 — האינדקס (להריץ לבד)
-- ═══════════════════════════════════════════════════════════════════════════
create index concurrently if not exists ad_daily_fb_ad_id_idx
  on public.ad_daily (ad_id, day desc)
  where source = 'facebook';


-- ═══════════════════════════════════════════════════════════════════════════
-- חלק 2 מתוך 2 — הפונקציה
-- ═══════════════════════════════════════════════════════════════════════════
-- לכל מזהה: השורה מהיום האחרון שבו המודעה הופיעה (שם, סדרה, קמפיין). LATERAL עם
-- limit 1 = בדיקה אחת באינדקס לכל מזהה, בלי לקרוא את כל השורות של המודעה.
begin;

create or replace function public.meta_ad_names(ids text[])
returns table (ad_id text, ad text, adset text, campaign text)
language sql stable
set search_path = ''
as $$
  select i.id, x.ad, x.adset, x.campaign
  from unnest(ids) as i(id)
  cross join lateral (
    select d.ad, d.adset, d.campaign
    from public.ad_daily d
    where d.source = 'facebook' and d.ad_id = i.id
    order by d.day desc
    limit 1
  ) x
$$;

revoke execute on function public.meta_ad_names(text[]) from public, anon, authenticated;
grant  execute on function public.meta_ad_names(text[]) to service_role;

commit;

-- בדיקה (אמורה לחזור בפחות משנייה, עם שם מודעה):
--   explain analyze select * from public.meta_ad_names(array(
--     select distinct ad_id from public.ad_daily where source = 'facebook' and day = current_date - 1 limit 50));


-- ═══════════════════════════════════════════════════════════════════════════
-- rollback
-- ═══════════════════════════════════════════════════════════════════════════
--   drop function if exists public.meta_ad_names(text[]);
--   drop index concurrently if exists public.ad_daily_fb_ad_id_idx;
--
-- אחרי rollback הקוד פשוט מפסיק להשלים שמות (אין חזרה לסריקה האיטית).
