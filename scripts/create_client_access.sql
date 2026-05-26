-- Run this in your Supabase SQL editor
-- Creates client_access table for magic-link client dashboard

CREATE TABLE IF NOT EXISTS client_access (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email       text NOT NULL,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label       text,           -- friendly display name e.g. "ש.ברוך - HI PARK"
  created_at  timestamptz DEFAULT now()
);

-- One email can only access one project (if you need multi-project, drop this)
CREATE UNIQUE INDEX IF NOT EXISTS client_access_email_idx ON client_access(email);

-- RLS: allow reading own row when authenticated via magic link
ALTER TABLE client_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client can read own access"
  ON client_access FOR SELECT
  USING (email = auth.jwt() ->> 'email');

-- Admin (service role / anon with elevated) can do anything — managed via API route with service key
