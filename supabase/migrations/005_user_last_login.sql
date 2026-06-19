-- Expose auth.users.last_sign_in_at to admins via a SECURITY DEFINER function,
-- since auth.users is not directly queryable from the client.
CREATE OR REPLACE FUNCTION public.get_user_last_logins()
RETURNS TABLE (id uuid, last_sign_in_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u
  WHERE public.is_admin();
$$;

REVOKE ALL ON FUNCTION public.get_user_last_logins() FROM public;
GRANT EXECUTE ON FUNCTION public.get_user_last_logins() TO authenticated;
