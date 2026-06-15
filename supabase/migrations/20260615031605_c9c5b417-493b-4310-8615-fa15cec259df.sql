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
  IF cat NOT IN ('revisao', 'manutencao') THEN
    RETURN NEW;
  END IF;

  desc_norm := lower(unaccent(coalesce(NEW.descricao, '')));

  IF desc_norm ~ '\[oleo\]' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_oleo = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_oleo IS NULL OR NEW.km_registro >= km_ultima_troca_oleo);
  END IF;

  IF desc_norm ~ '\[filtro\]' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_filtros = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_filtros IS NULL OR NEW.km_registro >= km_ultima_troca_filtros);
  END IF;

  IF desc_norm ~ '\[pastilha\]' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_pastilhas = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_pastilhas IS NULL OR NEW.km_registro >= km_ultima_troca_pastilhas);
  END IF;

  IF desc_norm ~ '\[arrefecimento\]' THEN
    UPDATE public.veiculos
       SET km_ultima_troca_arrefecimento = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_arrefecimento IS NULL OR NEW.km_registro >= km_ultima_troca_arrefecimento);
  END IF;

  RETURN NEW;
END;
$function$;