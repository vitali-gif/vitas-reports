-- שיוך פרויקט לחשבון מודעות מטא ספציפי.
--
-- עד כה קמפיין שויך לפרויקט לפי הכלה של שם הפרויקט בשם הקמפיין. זה עובד כשיש
-- מוסכמת שמות (HI PARK / ONCE / REHAVIA), ונשבר אצל לקוח שמריץ קמפיין נפרד לכל
-- בניין בשם שונה. כשחשבון המודעות כולו שייך ללקוח אחד, עדיף לנתב לפי החשבון.
--
-- NULL = ההתנהגות הישנה בדיוק. אף פרויקט קיים לא מושפע.

alter table public.projects
  add column if not exists meta_account_id text;

comment on column public.projects.meta_account_id is
  'מזהה חשבון מודעות מטא (ללא act_). כשמוגדר, כל שורות החשבון משויכות לפרויקט הזה ושם הקמפיין לא נבדק.';

-- אימות:
-- select id, name, meta_account_id from public.projects order by name;
