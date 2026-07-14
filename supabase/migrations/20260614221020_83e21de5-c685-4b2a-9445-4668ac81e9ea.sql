CREATE OR REPLACE FUNCTION public.update_vehicle_images_blob_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atualizar_revisao_veiculo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_vehicle_images_blob_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_codigo_indicacao() FROM PUBLIC, anon, authenticated;
