CREATE OR REPLACE FUNCTION public.validar_cupom_indicacao(_codigo text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.profiles
   WHERE codigo_indicacao ILIKE trim(_codigo)
   LIMIT 1
$function$;

REVOKE EXECUTE ON FUNCTION public.solicitar_saque_indicacao(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validar_cupom_indicacao(text) FROM PUBLIC;
