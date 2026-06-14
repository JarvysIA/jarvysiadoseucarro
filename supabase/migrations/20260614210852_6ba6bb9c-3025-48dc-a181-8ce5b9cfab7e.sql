-- 1) Add columns to veiculos
ALTER TABLE public.veiculos
  ADD COLUMN IF NOT EXISTS km_ultima_troca_oleo integer,
  ADD COLUMN IF NOT EXISTS km_ultima_troca_filtros integer,
  ADD COLUMN IF NOT EXISTS km_ultima_troca_pastilhas integer,
  ADD COLUMN IF NOT EXISTS km_ultima_troca_arrefecimento integer;

-- 2) Trigger function
CREATE OR REPLACE FUNCTION public.atualizar_revisao_veiculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cat text;
BEGIN
  IF NEW.km_registro IS NULL OR NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  cat := lower(unaccent(coalesce(NEW.categoria, '')));

  IF cat = 'oleo' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_oleo = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_oleo IS NULL OR NEW.km_registro >= km_ultima_troca_oleo);
  ELSIF cat = 'filtros' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_filtros = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_filtros IS NULL OR NEW.km_registro >= km_ultima_troca_filtros);
  ELSIF cat = 'pastilhas' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_pastilhas = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_pastilhas IS NULL OR NEW.km_registro >= km_ultima_troca_pastilhas);
  ELSIF cat = 'arrefecimento' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_arrefecimento = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_arrefecimento IS NULL OR NEW.km_registro >= km_ultima_troca_arrefecimento);
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Trigger
DROP TRIGGER IF EXISTS trg_atualizar_revisao_veiculo ON public.despesas;
CREATE TRIGGER trg_atualizar_revisao_veiculo
AFTER INSERT ON public.despesas
FOR EACH ROW
EXECUTE FUNCTION public.atualizar_revisao_veiculo();

-- 4) Backfill existing rows
UPDATE public.veiculos v SET km_ultima_troca_oleo = sub.km FROM (
  SELECT DISTINCT ON (vehicle_id) vehicle_id, km_registro AS km
  FROM public.despesas
  WHERE km_registro IS NOT NULL AND lower(unaccent(categoria)) = 'oleo'
  ORDER BY vehicle_id, km_registro DESC
) sub WHERE v.id = sub.vehicle_id;

UPDATE public.veiculos v SET km_ultima_troca_filtros = sub.km FROM (
  SELECT DISTINCT ON (vehicle_id) vehicle_id, km_registro AS km
  FROM public.despesas
  WHERE km_registro IS NOT NULL AND lower(unaccent(categoria)) = 'filtros'
  ORDER BY vehicle_id, km_registro DESC
) sub WHERE v.id = sub.vehicle_id;

UPDATE public.veiculos v SET km_ultima_troca_pastilhas = sub.km FROM (
  SELECT DISTINCT ON (vehicle_id) vehicle_id, km_registro AS km
  FROM public.despesas
  WHERE km_registro IS NOT NULL AND lower(unaccent(categoria)) = 'pastilhas'
  ORDER BY vehicle_id, km_registro DESC
) sub WHERE v.id = sub.vehicle_id;

UPDATE public.veiculos v SET km_ultima_troca_arrefecimento = sub.km FROM (
  SELECT DISTINCT ON (vehicle_id) vehicle_id, km_registro AS km
  FROM public.despesas
  WHERE km_registro IS NOT NULL AND lower(unaccent(categoria)) = 'arrefecimento'
  ORDER BY vehicle_id, km_registro DESC
) sub WHERE v.id = sub.vehicle_id;