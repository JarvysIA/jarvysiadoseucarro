CREATE OR REPLACE FUNCTION public.validar_cupom_indicacao(_codigo text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles
   WHERE codigo_indicacao ILIKE trim(_codigo)
   LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.validar_cupom_indicacao(text) TO anon, authenticated;