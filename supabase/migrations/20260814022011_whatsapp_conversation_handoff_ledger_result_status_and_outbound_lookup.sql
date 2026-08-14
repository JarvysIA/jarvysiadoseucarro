-- Build C5/C6 extension — pré-requisito do C7. Duas mudanças
-- independentes, na mesma migration por serem ambas pequenas e ambas
-- pré-requisitos do mesmo próximo build:
--
-- 1) reserve_conversation_handoff_execution (C5) passa a devolver
--    também result_status na sua RETURNS TABLE, para que o chamador
--    consiga saber — sem uma segunda RPC — se uma reserva já
--    completed/failed teve sucesso, foi bloqueada, ou falhou (e por
--    quê), no mesmo retorno que já usa pra checar status. Mudança de
--    ASSINATURA (RETURNS TABLE muda de forma): Postgres não permite
--    CREATE OR REPLACE nesse caso — precisa DROP FUNCTION antes do
--    CREATE, o que também derruba REVOKE/GRANT/COMMENT anteriores,
--    reaplicados abaixo dentro desta mesma migration. Corpo idêntico
--    ao já corrigido do C5 (qualificação de coluna já presente,
--    intocada) — a única mudança é a 4ª coluna em cada RETURN QUERY
--    SELECT.
--
-- 2) get_conversation_handoff_outbound_by_key (C6) — nova função,
--    só leitura (LANGUAGE sql, STABLE, sem nenhum INSERT/UPDATE/
--    DELETE), que busca o texto já persistido de uma resposta
--    outbound do Dr. Jarvys pela idempotency_key. Pré-requisito do
--    C7 para o caso em que o ledger já mostra completed/success mas
--    o texto original precisa ser recuperado (ex: reentrega de
--    webhook, sem chamar a IA de novo).

-- ============================================================
-- 1) reserve_conversation_handoff_execution — result_status na saída
-- ============================================================

DROP FUNCTION IF EXISTS public.reserve_conversation_handoff_execution(uuid,text,uuid,uuid,uuid,integer);

CREATE OR REPLACE FUNCTION public.reserve_conversation_handoff_execution(
  p_source_message_id uuid,
  p_segment text,
  p_contact_id uuid,
  p_user_id uuid,
  p_vehicle_id uuid,
  p_ttl_seconds integer
)
RETURNS TABLE(id uuid, status text, is_new_reservation boolean, result_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_now timestamptz := now();
  v_expires timestamptz;
  v_new_id uuid;
  v_existing record;
BEGIN
  IF p_source_message_id IS NULL OR p_contact_id IS NULL OR p_user_id IS NULL
     OR p_segment IS NULL OR p_segment NOT IN ('primary', 'supplemental')
     OR p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'invariant_violation' USING ERRCODE = '22023';
  END IF;

  v_expires := v_now + make_interval(secs => p_ttl_seconds);

  INSERT INTO public.whatsapp_conversation_handoff_ledger
    (source_message_id, segment, contact_id, user_id, vehicle_id, status, reserved_at, expires_at)
  VALUES
    (p_source_message_id, p_segment, p_contact_id, p_user_id, p_vehicle_id, 'reserved', v_now, v_expires)
  ON CONFLICT (source_message_id, segment) DO NOTHING
  RETURNING whatsapp_conversation_handoff_ledger.id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN QUERY SELECT v_new_id, 'reserved'::text, true, NULL::text;
    RETURN;
  END IF;

  -- Conflito: já existe uma linha para este (source_message_id, segment).
  -- Sweep oportunista — só acontece quando alguém de fato tenta reservar
  -- de novo o mesmo par, nenhum job/cron separado é criado por este
  -- build. Os dois casos de expiração são tratados de forma DIFERENTE
  -- (Opção A — segurança acima de disponibilidade, decisão já travada):
  SELECT * INTO v_existing
    FROM public.whatsapp_conversation_handoff_ledger
    WHERE source_message_id = p_source_message_id AND segment = p_segment
    FOR UPDATE;

  -- Caso 1: 'reserved' expirado — a IA nunca chegou a ser invocada para
  -- esta reserva, então é seguro reabri-la como uma nova tentativa.
  -- invoking_at/completed_at/result_status já são NULL nesse estado (CHECK
  -- wchl_shape_check), então o UPDATE não precisa reescrevê-los.
  IF v_existing.status = 'reserved' AND v_existing.expires_at < v_now THEN
    UPDATE public.whatsapp_conversation_handoff_ledger
      SET reserved_at = v_now,
          expires_at = v_expires
      WHERE public.whatsapp_conversation_handoff_ledger.id = v_existing.id;
    RETURN QUERY SELECT v_existing.id, 'reserved'::text, true, NULL::text;
    RETURN;
  END IF;

  -- Caso 2: 'invoking' expirado — a IA pode ter sido invocada (não temos
  -- como saber se ela respondeu ou não), então esta reserva NUNCA é
  -- reaberta. Vira failed permanente para este (source_message_id,
  -- segment): nenhuma nova tentativa jamais chama a IA de novo para o
  -- mesmo par. result_status='transient_failure' pelo mesmo motivo
  -- genérico de "serviço indisponível" já usado no C3.
  IF v_existing.status = 'invoking' AND v_existing.expires_at < v_now THEN
    UPDATE public.whatsapp_conversation_handoff_ledger
      SET status = 'failed', result_status = 'transient_failure', completed_at = v_now
      WHERE public.whatsapp_conversation_handoff_ledger.id = v_existing.id
        AND public.whatsapp_conversation_handoff_ledger.status = 'invoking';
    RETURN QUERY SELECT v_existing.id, 'failed'::text, false, 'transient_failure'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_existing.id, v_existing.status, false, v_existing.result_status;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.reserve_conversation_handoff_execution FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_conversation_handoff_execution FROM anon, authenticated;
COMMENT ON FUNCTION public.reserve_conversation_handoff_execution IS
  'C5: Reserva CAS por (source_message_id, segment). insere nova linha; se já existe: reserved expirado reabre como nova tentativa, invoking expirado NUNCA reabre (vira failed/transient_failure permanente — Opção A, segurança acima de disponibilidade), qualquer outro estado só retorna a linha existente com is_new_reservation=false. Também retorna result_status (success|blocked|transient_failure|permanent_failure) quando status é completed ou failed, NULL enquanto reserved/invoking.';

-- ============================================================
-- 2) get_conversation_handoff_outbound_by_key — leitura, pré-requisito C7
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_conversation_handoff_outbound_by_key(
  p_idempotency_key text
)
RETURNS TABLE(text_body text, outbound_message_id uuid, outbound_queue_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
  SELECT text_body, source_message_id, id
  FROM public.whatsapp_outbound_queue
  WHERE idempotency_key = p_idempotency_key
    AND purpose = 'conversation'
  LIMIT 1;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_conversation_handoff_outbound_by_key FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_conversation_handoff_outbound_by_key FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_handoff_outbound_by_key TO service_role;
COMMENT ON FUNCTION public.get_conversation_handoff_outbound_by_key IS
  'Pré-requisito do C7: busca o texto já persistido de uma resposta outbound do Dr. Jarvys pela idempotency_key, para o caso em que o ledger (C5) já mostra completed/success mas o texto original precisa ser recuperado (ex: reentrega de webhook). Só leitura, filtra purpose=conversation por defesa extra. Backend-only, service_role.';
