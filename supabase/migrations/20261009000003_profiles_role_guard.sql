-- A role used to approve/apply corrections must be assigned by a trusted actor.
-- User-controlled signup metadata must never assign staff privileges.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'usuario'::public.user_role
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- Policies on profiles call this helper. Reading profiles as the invoker would
-- recursively re-enter the same RLS policy; resolve only the verified Auth id.
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.current_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated, service_role;

-- Invoker context is intentional: a normal browser request cannot gain the
-- function owner's privileges. Keep normal profile edits and admin role edits.
CREATE OR REPLACE FUNCTION public.guard_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.role = 'usuario'::public.user_role)
     OR (TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role) THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('postgres', 'supabase_admin', 'service_role')
     OR public.current_role() = 'admin'::public.user_role THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Somente administradores podem alterar o papel de acesso.'
    USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_profile_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_profile_role() TO authenticated, service_role;

DROP TRIGGER IF EXISTS profiles_role_guard ON public.profiles;
CREATE TRIGGER profiles_role_guard
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role();
