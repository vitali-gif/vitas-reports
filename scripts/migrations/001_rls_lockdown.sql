-- ═══════════════════════════════════════════════════════════════════════════
-- 001_rls_lockdown.sql
--
-- מצב: הורץ ידנית על הפרודקשן ב-8.9.2026. הקובץ הזה מתעד אותו בריפו כדי
-- שיהיה אפשר לשחזר את המצב, ולהריץ אותו על כל סביבה חדשה.
-- הרצה חוזרת בטוחה (idempotent).
--
-- הרקע: RLS היה דלוק על כל הטבלאות, אבל המדיניות עצמן היו פתוחות לרווחה:
--   clients      · "Public read clients by token"   → USING (true)
--   projects     · "Public read projects by client" → USING (true)
--   vitas_tasks  · "vitas_tasks_anon_read"          → USING (true)
--   reports      · "Admin full access to reports"   → FOR ALL, USING (auth.role() = 'authenticated')
--
-- שלוש הראשונות אפשרו קריאה לכל מי שמחזיק את מפתח ה-anon — שמוטמע בבאנדל
-- ולכן ציבורי — בלי להתחבר בכלל. הרביעית אפשרה לכל משתמש מחובר, כלומר לכל
-- לקוח, לקרוא *ולמחוק* את הדוחות של כל שאר הלקוחות.
--
-- rollback בתחתית הקובץ.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── רשימת האדמינים ──────────────────────────────────────────────────────────
-- Postgres לא מכיר את ADMIN_EMAILS של Vercel, ולכן צריך מקור אמת משלו.
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz default now()
);
alter table public.admins enable row level security;
-- אין policies בכוונה: רק service_role ו-is_admin() (security definer) ניגשים.

insert into public.admins (email) values
  ('vitali@vitas.co.il'),
  ('vitalidisel@gmail.com')
on conflict (email) do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_admin() to authenticated, anon;

-- ── clients ─────────────────────────────────────────────────────────────────
drop policy if exists "Public read clients by token" on public.clients;
drop policy if exists "Admin full access to clients" on public.clients;
create policy "admins manage clients" on public.clients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── projects ────────────────────────────────────────────────────────────────
drop policy if exists "Public read projects by client" on public.projects;
drop policy if exists "Admin full access to projects" on public.projects;
create policy "admins manage projects" on public.projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── reports ─────────────────────────────────────────────────────────────────
-- הדפדפן לא קורא את הטבלה הזו ישירות: הכל עובר דרך /api/reports/by-project
-- שרץ עם service_role ועוקף RLS (ומאמת בעצמו גישה לפרויקט). המדיניות כאן
-- נועדה לאדמין בלבד.
drop policy if exists "Authenticated read reports" on public.reports;
drop policy if exists "Admin full access to reports" on public.reports;
create policy "admins manage reports" on public.reports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── vitas_tasks ─────────────────────────────────────────────────────────────
-- כאן הדפדפן כן קורא ישירות (loadProjectTasks), גם בתצוגת לקוח — ולכן
-- המדיניות מתירה קריאה למי שיש לו client_access לפרויקט של המשימה.
drop policy if exists "vitas_tasks_anon_read" on public.vitas_tasks;
create policy "tasks for admins and project members" on public.vitas_tasks
  for select to authenticated using (
    public.is_admin()
    or exists (
      select 1 from public.client_access ca
      where ca.project_id = vitas_tasks.project_id
        and lower(ca.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- אימות אחרי ההרצה — אמור להחזיר את המדיניות החדשות בלבד:
--
--   select tablename, policyname, array_to_string(roles, ',') as roles, cmd,
--          coalesce(qual, '—') as using_expression
--   from pg_policies where schemaname = 'public' order by tablename;
--
-- שום שורה עם anon לא אמורה להופיע עם using_expression = true.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — רק אם משהו נשבר. מחזיר את המצב הפתוח הקודם.
--
--   begin;
--   drop policy if exists "admins manage clients" on public.clients;
--   drop policy if exists "admins manage projects" on public.projects;
--   drop policy if exists "admins manage reports" on public.reports;
--   drop policy if exists "tasks for admins and project members" on public.vitas_tasks;
--   create policy "Admin full access to clients" on public.clients
--     for all to public using (auth.role() = 'authenticated');
--   create policy "Public read clients by token" on public.clients
--     for select to public using (true);
--   create policy "Admin full access to projects" on public.projects
--     for all to public using (auth.role() = 'authenticated');
--   create policy "Public read projects by client" on public.projects
--     for select to public using (true);
--   create policy "Admin full access to reports" on public.reports
--     for all to public using (auth.role() = 'authenticated');
--   create policy "vitas_tasks_anon_read" on public.vitas_tasks
--     for select to anon, authenticated using (true);
--   commit;
-- ═══════════════════════════════════════════════════════════════════════════
