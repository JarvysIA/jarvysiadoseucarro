
CREATE OR REPLACE FUNCTION public.atualizar_revisao_veiculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cat text;
  desc_norm text;
BEGIN
  IF NEW.km_registro IS NULL OR NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  cat := lower(unaccent(coalesce(NEW.categoria, '')));
  -- Só age para categorias de manutenção/revisão
  IF cat NOT IN ('revisao', 'manutencao') THEN
    RETURN NEW;
  END IF;

  desc_norm := lower(unaccent(coalesce(NEW.descricao, '')));

  -- Óleo
  IF desc_norm ~ '(oleo|lubrificante|5w30|5w40|10w40|15w40|0w20)' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_oleo = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_oleo IS NULL OR NEW.km_registro >= km_ultima_troca_oleo);
  END IF;

  -- Filtros
  IF desc_norm ~ '(filtro ar|filtros|filtro cabine|filtro combustivel|filtro de ar|filtro de cabine|filtro de combustivel|filtro de oleo)' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_filtros = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_filtros IS NULL OR NEW.km_registro >= km_ultima_troca_filtros);
  END IF;

  -- Pastilhas / freios
  IF desc_norm ~ '(pastilha|freio|disco)' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_pastilhas = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_pastilhas IS NULL OR NEW.km_registro >= km_ultima_troca_pastilhas);
  END IF;

  -- Arrefecimento
  IF desc_norm ~ '(arrefecimento|fluido|agua|aditivo|radiador)' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_arrefecimento = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_arrefecimento IS NULL OR NEW.km_registro >= km_ultima_troca_arrefecimento);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_atualizar_revisao_veiculo ON public.despesas;
CREATE TRIGGER trg_atualizar_revisao_veiculo
AFTER INSERT ON public.despesas
FOR EACH ROW
EXECUTE FUNCTION public.atualizar_revisao_veiculo();
