UPDATE public.veiculos SET status = 'ativo' WHERE status = 'active';

ALTER TABLE public.veiculos ALTER COLUMN status SET DEFAULT 'ativo';

CREATE OR REPLACE FUNCTION public.proteger_cadastro_veiculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status   text;
  v_ativos   int;
  v_ativados int;
BEGIN
  -- Normalização defensiva: 'active' (legado) ou NULL → 'ativo'.
  -- Aplica também para webhooks/service_role (antes do bypass).
  IF NEW.status IS NULL OR NEW.status = 'active' THEN
    NEW.status := 'ativo';
  END IF;

  -- Bypass para service_role / contextos sem auth (webhook, jobs).
  IF auth.uid() IS NULL OR auth.uid() <> NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT status_usuario INTO v_status
    FROM public.profiles
   WHERE id = NEW.user_id;

  -- Veículos atualmente na garagem ativa (archived NUNCA conta).
  SELECT COUNT(*) INTO v_ativos
    FROM public.veiculos
   WHERE user_id = NEW.user_id
     AND status = 'ativo';

  -- VIP / Enterprise → ilimitado.
  IF v_status IN ('vip', 'enterprise') THEN
    RETURN NEW;
  END IF;

  -- TRIAL → no máximo 1 veículo ativo (proteção final, não só frontend).
  IF v_status = 'trial' THEN
    IF v_ativos >= 1 THEN
      RAISE EXCEPTION
        'CADASTRO_BLOQUEADO: usuário trial permite apenas um veículo gratuito'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- ATIVO → conta ativações reais via pagamentos_pix (mesma fonte do frontend).
  IF v_status = 'ativo' THEN
    SELECT COUNT(DISTINCT pp.veiculo_id) INTO v_ativados
      FROM public.pagamentos_pix pp
      JOIN public.veiculos v ON v.id = pp.veiculo_id
     WHERE pp.user_id = NEW.user_id
       AND pp.status = 'pago'
       AND pp.tipo_produto = 'ativacao'
       AND pp.veiculo_id IS NOT NULL
       AND v.user_id = NEW.user_id
       AND v.status = 'ativo';

    IF v_ativos > v_ativados THEN
      RAISE EXCEPTION
        'CADASTRO_BLOQUEADO: usuário ativo precisa ativar um veículo da garagem antes de cadastrar outro'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;