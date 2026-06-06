
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'free';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_plan_tier_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_tier_check CHECK (plan_tier IN ('free','vip','super_vip'));

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND is_super_admin = true);
$$;

DROP POLICY IF EXISTS "Super admins can view all profiles" ON public.profiles;
CREATE POLICY "Super admins can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins can update all profiles" ON public.profiles;
CREATE POLICY "Super admins can update all profiles"
ON public.profiles FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Super admins can view all vehicles" ON public.veiculos;
CREATE POLICY "Super admins can view all vehicles"
ON public.veiculos FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));
