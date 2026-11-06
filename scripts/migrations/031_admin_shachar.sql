-- 031 — שחר (השותף של ויטלי) מקבל גישת אדמין לדשבורד (ויטלי, 6.11)
-- בשביל "קליטת לקוחות" ו"שימוש לקוחות". ⚠️ אדמין רואה הכל: כל הלקוחות, כל הפרויקטים, כל הגדרות.
-- ההרשאה נבדקת ב-lib/auth.js (isAdminEmail) מול הטבלה הזו. הפעולות שלו לא נספרות ב"שימוש לקוחות".

insert into public.admins (email) values ('agasish@gmail.com')
on conflict do nothing;

-- בדיקה
select email from public.admins order by email;

-- ROLLBACK:
-- delete from public.admins where email = 'agasish@gmail.com';
