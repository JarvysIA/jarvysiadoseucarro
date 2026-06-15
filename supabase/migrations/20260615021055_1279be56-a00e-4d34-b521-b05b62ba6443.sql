CREATE OR REPLACE FUNCTION public.atualizar_revisao_veiculo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cat text;
  desc_norm text;
  has_oleo_tag boolean;
  has_filtro_tag boolean;
  has_oleo_word boolean;
  has_lubrificante_word boolean;
  has_filtro_explicit boolean;
  has_filtro_word boolean;
BEGIN
  IF NEW.km_registro IS NULL OR NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  cat := lower(unaccent(coalesce(NEW.categoria, '')));
  IF cat NOT IN ('revisao', 'manutencao') THEN
    RETURN NEW;
  END IF;

  desc_norm := lower(unaccent(coalesce(NEW.descricao, '')));

  has_oleo_tag := desc_norm ~ '\[oleo\]';
  has_filtro_tag := desc_norm ~ '\[filtro\]';
  has_oleo_word := desc_norm ~ '\moleo\M';
  has_lubrificante_word := desc_norm ~ '\mlubrificante\M';
  has_filtro_explicit := desc_norm ~ '(filtro\s+(de\s+|do\s+)?ar(\s+condicionado)?|filtro\s+(de\s+|do\s+)?cabine|filtro\s+(de\s+)?combustivel)';
  has_filtro_word := desc_norm ~ '\mfiltro\M';

  -- Card Óleo e Filtro do Motor
  IF has_oleo_tag OR has_oleo_word OR has_lubrificante_word THEN
    UPDATE public.veiculos
       SET km_ultima_troca_oleo = NEW.km_registro
     WHERE id = NEW.vehicle_id
       AND (km_ultima_troca_oleo IS NULL OR NEW.km_registro >= km_ultima_troca_oleo);
  END IF;

  -- Card Filtros (Ar/Cabine/Combustível)
  IF has_filtro_tag
     OR has_filtro_explicit
     OR (has_filtro_word AND NOT has_oleo_word AND NOT has_lubrificante_word) THEN
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