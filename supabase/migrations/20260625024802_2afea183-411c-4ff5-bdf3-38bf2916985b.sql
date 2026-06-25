CREATE OR REPLACE FUNCTION public.normalizar_status_veiculo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS NULL OR NEW.status = 'active' THEN
    NEW.status := 'ativo';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_normalizar_status_veiculo ON public.veiculos;

CREATE TRIGGER trg_normalizar_status_veiculo
BEFORE INSERT OR UPDATE OF status ON public.veiculos
FOR EACH ROW
EXECUTE FUNCTION public.normalizar_status_veiculo();

UPDATE public.veiculos SET status = 'ativo' WHERE status = 'active';

ALTER TABLE public.veiculos ALTER COLUMN status SET DEFAULT 'ativo';