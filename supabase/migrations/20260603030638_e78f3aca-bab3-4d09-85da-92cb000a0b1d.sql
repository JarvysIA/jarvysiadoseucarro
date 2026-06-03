-- Grant execute on has_role so RLS policies referencing it don't fail with "permission denied for function has_role"
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon, service_role;

-- Reset veiculos policies to simple auth.uid() = user_id rules (no has_role dependency)
DROP POLICY IF EXISTS "Admins can view all veiculos" ON public.veiculos;
DROP POLICY IF EXISTS "Users can view own veiculos" ON public.veiculos;
DROP POLICY IF EXISTS "Users can insert own veiculos" ON public.veiculos;
DROP POLICY IF EXISTS "Users can update own veiculos" ON public.veiculos;
DROP POLICY IF EXISTS "Users can delete own veiculos" ON public.veiculos;

CREATE POLICY "Users can select their own vehicles"
ON public.veiculos FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own vehicles"
ON public.veiculos FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vehicles"
ON public.veiculos FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own vehicles"
ON public.veiculos FOR DELETE TO authenticated
USING (auth.uid() = user_id);
