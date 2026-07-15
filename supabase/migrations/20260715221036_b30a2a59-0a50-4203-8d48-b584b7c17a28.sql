
-- Build 5.7F2E1B — RPC atômica de atualização confirmada de KM.
-- Escopo estrito: cria UMA função nova. Não altera tabelas, não toca em
-- whatsapp_km_prompt_requests, não conecta runtime, não muda orchestrator_mode.
-- Estilo/padrão espelhados de apply_whatsapp_orchestrator_transition e
-- reserve_whatsapp_km_prompt_request; advisory lock como em enqueue_whatsapp_km_prompt.

CREATE OR REPLACE FUNCTION public.execute_whatsapp_km_update(
  p_draft_id                 uuid,
  p_conversation_state_id    uuid,
  p_confirmation_message_id  uuid,
  p_source_message_id        uuid,
  p_queue_item_id            uuid,
  p_user_id                  uuid,
  p_contact_id               uuid,
  p_vehicle_id               uuid,
  p_expected_previous_km     integer,
  p_new_km                   integer,
  p_is_correction            boolean,
  p_correction_confirmed     boolean,
  p_correction_reason        text,
  p_expected_state_version   bigint,
  p_orchestrator_version     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contact           record;
  v_state             record;
  v_vehicle           record;
  v_existing_exec     record;
  v_current_km        integer;
  v_real_is_corr      boolean;
  v_dp                jsonb;
  v_dp_vehicle_id     uuid;
  v_dp_new_km         integer;
  v_dp_expected_prev  integer;
  v_dp_is_corr        boolean;
  v_dp_prev_raw       jsonb;
  v_updated           integer;
  v_exec_id           uuid;
  v_exec_prev_km      integer;
  v_exec_new_km       integer;
  v_reason_trim       text;
BEGIN
  -- ==========================================================
  -- (1) Validação de invariantes de entrada.
  -- ==========================================================
  IF p_draft_id IS NULL
     OR p_conversation_state_id IS NULL
     OR p_confirmation_message_id IS NULL
     OR p_source_message_id IS NULL
     OR p_queue_item_id IS NULL
     OR p_user_id IS NULL
     OR p_contact_id IS NULL
     OR p_vehicle_id IS NULL
     OR p_is_correction IS NULL
     OR p_correction_confirmed IS NULL
     OR p_expected_state_version IS NULL
     OR p_expected_state_version < 0
     OR p_orchestrator_version IS NULL
     OR btrim(p_orchestrator_version) = ''
     OR char_length(p_orchestrator_version) > 120 THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  IF p_correction_reason IS NOT NULL THEN
    v_reason_trim := btrim(p_correction_reason);
    IF v_reason_trim = '' OR char_length(p_correction_reason) > 500 THEN
      RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
    END IF;
  END IF;

  IF p_new_km IS NULL OR p_new_km < 0 OR p_new_km > 2147483647 THEN
    RETURN jsonb_build_object('kind','rejected','reason','km_invalid');
  END IF;

  IF p_expected_previous_km IS NOT NULL
     AND (p_expected_previous_km < 0 OR p_expected_previous_km > 2147483647) THEN
    RETURN jsonb_build_object('kind','rejected','reason','km_invalid');
  END IF;

  -- ==========================================================
  -- (2) Advisory lock derivado do draft_id — serializa chamadas
  -- concorrentes para o mesmo draft, mesmo padrão de
  -- enqueue_whatsapp_km_prompt.
  -- ==========================================================
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_draft_id::text || '|km_update', 0)
  );

  -- ==========================================================
  -- (3) Trava e valida o contato.
  -- ==========================================================
  SELECT id, user_id, unlinked_at
    INTO v_contact
    FROM public.whatsapp_contacts
    WHERE id = p_contact_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind','rejected','reason','contact_missing');
  END IF;

  IF v_contact.user_id IS NULL OR v_contact.user_id <> p_user_id THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  IF v_contact.unlinked_at IS NOT NULL THEN
    RETURN jsonb_build_object('kind','rejected','reason','contact_unlinked');
  END IF;

  -- ==========================================================
  -- (4) Trava e valida o estado conversacional.
  -- ==========================================================
  SELECT id, contact_id, state, state_version, draft_type, draft_id, draft_payload
    INTO v_state
    FROM public.whatsapp_conversation_states
    WHERE contact_id = v_contact.id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  IF v_state.state_version IS DISTINCT FROM p_expected_state_version THEN
    RETURN jsonb_build_object(
      'kind','conflicted',
      'reason','state_version_conflict',
      'currentStateVersion', v_state.state_version
    );
  END IF;

  IF v_state.state NOT IN ('awaiting_km_confirmation','awaiting_km_correction') THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  IF v_state.draft_type IS DISTINCT FROM 'km_update'
     OR v_state.draft_id IS DISTINCT FROM p_draft_id
     OR v_state.draft_payload IS NULL
     OR jsonb_typeof(v_state.draft_payload) <> 'object' THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  -- Fonte de verdade: draft_payload persistido. Parâmetros só servem
  -- para conferência cruzada.
  v_dp := v_state.draft_payload;

  BEGIN
    v_dp_vehicle_id := (v_dp ->> 'vehicleId')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END;

  IF (v_dp ->> 'newKm') IS NULL OR (v_dp ->> 'newKm') !~ '^-?[0-9]+$' THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;
  v_dp_new_km := (v_dp ->> 'newKm')::integer;

  v_dp_prev_raw := v_dp -> 'expectedPreviousKm';
  IF v_dp_prev_raw IS NULL OR jsonb_typeof(v_dp_prev_raw) = 'null' THEN
    v_dp_expected_prev := NULL;
  ELSIF jsonb_typeof(v_dp_prev_raw) = 'number' THEN
    v_dp_expected_prev := (v_dp ->> 'expectedPreviousKm')::integer;
  ELSE
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  IF (v_dp ->> 'isCorrection') IS NULL
     OR jsonb_typeof(v_dp -> 'isCorrection') <> 'boolean' THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;
  v_dp_is_corr := (v_dp ->> 'isCorrection')::boolean;

  IF v_dp_vehicle_id IS DISTINCT FROM p_vehicle_id
     OR v_dp_new_km IS DISTINCT FROM p_new_km
     OR v_dp_expected_prev IS DISTINCT FROM p_expected_previous_km
     OR v_dp_is_corr IS DISTINCT FROM p_is_correction THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  -- ==========================================================
  -- (5) Valida o veículo.
  -- ==========================================================
  SELECT id, user_id, status, km_atual
    INTO v_vehicle
    FROM public.veiculos
    WHERE id = p_vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind','rejected','reason','vehicle_not_found');
  END IF;

  IF v_vehicle.user_id IS DISTINCT FROM v_contact.user_id THEN
    RETURN jsonb_build_object('kind','rejected','reason','vehicle_not_owned');
  END IF;

  IF v_vehicle.status = 'archived' THEN
    RETURN jsonb_build_object('kind','rejected','reason','vehicle_archived');
  END IF;

  v_current_km := v_vehicle.km_atual;

  -- ==========================================================
  -- (6) Revalida isCorrection contra o km real do veículo.
  -- ==========================================================
  v_real_is_corr := (v_current_km IS NOT NULL AND p_new_km < v_current_km);

  IF v_real_is_corr AND p_correction_confirmed = false THEN
    RETURN jsonb_build_object('kind','rejected','reason','correction_not_confirmed');
  END IF;

  -- ==========================================================
  -- (7) Idempotência via whatsapp_action_executions.
  -- ==========================================================
  SELECT id, user_id, contact_id, vehicle_id, result_payload
    INTO v_existing_exec
    FROM public.whatsapp_action_executions
    WHERE draft_id = p_draft_id
      AND action_type = 'km_update'
    FOR UPDATE;

  IF FOUND THEN
    IF v_existing_exec.user_id IS DISTINCT FROM p_user_id
       OR v_existing_exec.contact_id IS DISTINCT FROM p_contact_id
       OR v_existing_exec.vehicle_id IS DISTINCT FROM p_vehicle_id
       OR v_existing_exec.result_payload IS NULL
       OR jsonb_typeof(v_existing_exec.result_payload) <> 'object' THEN
      RETURN jsonb_build_object('kind','conflicted','reason','action_execution_conflict');
    END IF;

    -- Extrai newKm gravado no result_payload (aceita registros no_op também).
    v_exec_new_km := NULL;
    v_exec_prev_km := NULL;

    IF (v_existing_exec.result_payload ->> 'newKm') IS NOT NULL
       AND (v_existing_exec.result_payload ->> 'newKm') ~ '^-?[0-9]+$' THEN
      v_exec_new_km := (v_existing_exec.result_payload ->> 'newKm')::integer;
    ELSIF (v_existing_exec.result_payload ->> 'currentKm') IS NOT NULL
          AND (v_existing_exec.result_payload ->> 'currentKm') ~ '^-?[0-9]+$' THEN
      -- Registro no_op anterior: currentKm é o valor efetivo.
      v_exec_new_km := (v_existing_exec.result_payload ->> 'currentKm')::integer;
    END IF;

    IF (v_existing_exec.result_payload ->> 'previousKm') IS NOT NULL
       AND (v_existing_exec.result_payload ->> 'previousKm') ~ '^-?[0-9]+$' THEN
      v_exec_prev_km := (v_existing_exec.result_payload ->> 'previousKm')::integer;
    END IF;

    IF v_exec_new_km IS DISTINCT FROM p_new_km THEN
      RETURN jsonb_build_object('kind','conflicted','reason','action_execution_conflict');
    END IF;

    RETURN jsonb_build_object(
      'kind','replayed',
      'actionExecutionId', v_existing_exec.id,
      'previousKm', v_exec_prev_km,
      'newKm', v_exec_new_km,
      'noChange', (v_current_km IS NOT DISTINCT FROM p_new_km)
    );
  END IF;

  -- ==========================================================
  -- (8) No-op: p_new_km igual ao km atual real.
  -- ==========================================================
  IF v_current_km IS NOT DISTINCT FROM p_new_km THEN
    INSERT INTO public.whatsapp_action_executions (
      draft_id, action_type, user_id, contact_id, vehicle_id,
      conversation_state_id, source_message_id, status,
      result_payload, started_at, completed_at
    ) VALUES (
      p_draft_id, 'km_update', p_user_id, p_contact_id, p_vehicle_id,
      p_conversation_state_id, p_confirmation_message_id, 'succeeded',
      jsonb_build_object(
        'outcome','no_op',
        'currentKm', v_current_km,
        'orchestratorVersion', p_orchestrator_version
      ),
      now(), now()
    )
    RETURNING id INTO v_exec_id;

    RETURN jsonb_build_object(
      'kind','no_op',
      'actionExecutionId', v_exec_id,
      'currentKm', v_current_km
    );
  END IF;

  -- ==========================================================
  -- (9) UPDATE atômico condicionado ao km esperado.
  -- ==========================================================
  UPDATE public.veiculos
     SET km_atual = p_new_km
   WHERE id = p_vehicle_id
     AND km_atual IS NOT DISTINCT FROM p_expected_previous_km;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT km_atual INTO v_current_km
      FROM public.veiculos
      WHERE id = p_vehicle_id;

    RETURN jsonb_build_object(
      'kind','conflicted',
      'reason','km_conflict',
      'currentKm', v_current_km
    );
  END IF;

  INSERT INTO public.whatsapp_action_executions (
    draft_id, action_type, user_id, contact_id, vehicle_id,
    conversation_state_id, source_message_id, status,
    result_payload, started_at, completed_at
  ) VALUES (
    p_draft_id, 'km_update', p_user_id, p_contact_id, p_vehicle_id,
    p_conversation_state_id, p_confirmation_message_id, 'succeeded',
    jsonb_build_object(
      'outcome','applied',
      'previousKm', p_expected_previous_km,
      'newKm', p_new_km,
      'orchestratorVersion', p_orchestrator_version
    ),
    now(), now()
  )
  RETURNING id INTO v_exec_id;

  RETURN jsonb_build_object(
    'kind','applied',
    'actionExecutionId', v_exec_id,
    'previousKm', p_expected_previous_km,
    'newKm', p_new_km
  );
END;
$function$;

ALTER FUNCTION public.execute_whatsapp_km_update(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, integer, boolean, boolean, text, bigint, text
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.execute_whatsapp_km_update(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, integer, boolean, boolean, text, bigint, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.execute_whatsapp_km_update(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, integer, boolean, boolean, text, bigint, text
) FROM anon;

REVOKE ALL ON FUNCTION public.execute_whatsapp_km_update(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, integer, boolean, boolean, text, bigint, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.execute_whatsapp_km_update(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, integer, boolean, boolean, text, bigint, text
) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.execute_whatsapp_km_update('
         || 'uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, '
         || 'integer, integer, boolean, boolean, text, bigint, text'
         || ') TO sandbox_exec';
  END IF;
END $$;

COMMENT ON FUNCTION public.execute_whatsapp_km_update(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid,
  integer, integer, boolean, boolean, text, bigint, text
) IS 'Build 5.7F2E1B — RPC atômica/idempotente de aplicação confirmada de KM. Fonte de verdade: draft_payload persistido em whatsapp_conversation_states. Sem caller runtime.';
