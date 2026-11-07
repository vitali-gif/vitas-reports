-- 033 — קבצים בשאלון הקליטה (ויטלי, 7.11): לוגו, צילומים, קטלוג / מחירון — במקום "קישור לתיקייה"
-- דלי פרטי ב-Supabase Storage. הלקוח מעלה רק דרך קישור העלאה חתום שהשרת מנפיק (/api/public/onboarding-form/upload,
-- לפי הטוקן של השאלון), לתיקייה של הפרויקט שלו. אין policies: הדפדפן לא יכול לקרוא, לרשום או למחוק בדלי.
-- האדמין מקבל קישורי הורדה חתומים לזמן קצר (/api/onboarding/form).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('onboarding-files', 'onboarding-files', false, 26214400,
  array['image/jpeg','image/png','image/webp','image/gif','image/svg+xml','application/pdf','video/mp4','video/quicktime',
        'application/zip','application/x-zip-compressed','application/postscript','image/vnd.adobe.photoshop','application/octet-stream'])
on conflict (id) do nothing;

-- בדיקה
select id, public, file_size_limit from storage.buckets where id = 'onboarding-files';

-- ROLLBACK (רק כשהדלי ריק; קבצים קיימים מוחקים קודם מ-Storage):
-- delete from storage.buckets where id = 'onboarding-files';
