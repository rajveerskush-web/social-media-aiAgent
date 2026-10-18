-- Requires ownership of public.users. The linked project's migration runner
-- uses project_admin, while this existing table is owned by postgres.
-- This migration is additive and assumes public.users remains empty, as
-- verified before it was prepared. The NOT NULL/FK constraints also prevent
-- profiles from existing without a corresponding InsForge Auth user.

ALTER TABLE public.users
  ADD COLUMN auth_user_id uuid NOT NULL;

ALTER TABLE public.users
  ADD CONSTRAINT users_auth_user_id_fkey
    FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_profile
  ON public.users
  FOR SELECT
  TO authenticated
  USING (auth_user_id = (SELECT auth.uid()));

CREATE POLICY users_insert_own_profile
  ON public.users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth_user_id = (SELECT auth.uid()));

CREATE POLICY users_update_own_profile
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (auth_user_id = (SELECT auth.uid()))
  WITH CHECK (auth_user_id = (SELECT auth.uid()));

-- Restrict this legacy table to the exact operations required for profile
-- creation and maintenance. No anonymous access or profile deletion is needed.
REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.users TO authenticated;
GRANT UPDATE (auth_user_id, name, email) ON TABLE public.users TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.users_id_seq TO authenticated;
