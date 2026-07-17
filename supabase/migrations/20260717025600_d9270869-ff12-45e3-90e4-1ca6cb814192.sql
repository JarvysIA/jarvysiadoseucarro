CREATE OR REPLACE FUNCTION public.execute_whatsapp_expense_create(
  p_draft_id uuid,
  p_conversation_state_id uuid,
  p_confirmation_message_id uuid,
  p_source_message_id uuid,
  p_queue_item_id uuid,
  p_user_id uuid,
  p_contact_id uuid,
  p_vehicle_id uuid,
  p_categoria text,
  p_valor numeric,
  p_descricao text,
  p_expected_state_version bigint,
  p_orchestrator_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contact         record;
  v_state           record;
  v_vehicle         record;
  v_existing_exec   record;
  v_dp              jsonb;
  v_dp_vehicle_id   uuid;
  v_dp_categoria    text;
  v_dp_valor        numeric;
  v_exec_id         uuid;
  v_despesa_id      uuid;
  v_exec_despesa_id uuid;
  v_exec_categoria  text;
  v_exec_valor      numeric;
BEGIN
  -- (1) Validação de invariantes de entrada.
  IF p_draft_id IS NULL
     OR p_conversation_state_id IS NULL
     OR p_confirmation_message_id IS NULL
     OR p_source_message_id IS NULL
     OR p_queue_item_id IS NULL
     OR p_user_id IS NULL
     OR p_contact_id IS NULL
     OR p_vehicle_id IS NULL
     OR p_expected_state_version IS NULL
     OR p_expected_state_version < 0
     OR p_orchestrator_version IS NULL
     OR btrim(p_orchestrator_version) = ''
     OR char_length(p_orchestrator_version) > 120 THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  IF p_categoria IS NULL
     OR p_categoria NOT IN ('Revisão','Manutenção','Lavagem','Combustível',
                             'IPVA','Multas','Seguro','Acessórios') THEN
    RETURN jsonb_build_object('kind','rejected','reason','categoria_invalid');
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 OR p_valor > 999999999.99 THEN
    RETURN jsonb_build_object('kind','rejected','reason','valor_invalid');
  END IF;

  IF p_descricao IS NOT NULL AND char_length(p_descricao) > 500 THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  -- (2) Advisory lock derivado do draft_id.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_draft_id::text || '|expense_create', 0)
  );

  -- (3) Trava e valida o contato.
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

  -- (4) Trava e valida o estado conversacional.
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

  IF v_state.state NOT IN ('awaiting_expense_confirmation','awaiting_expense_correction') THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  IF v_state.draft_type IS DISTINCT FROM 'expense'
     OR v_state.draft_id IS DISTINCT FROM p_draft_id
     OR v_state.draft_payload IS NULL
     OR jsonb_typeof(v_state.draft_payload) <> 'object' THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  v_dp := v_state.draft_payload;

  IF (v_dp ->> 'phase') IS DISTINCT FROM 'awaiting_confirmation' THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  BEGIN
    v_dp_vehicle_id := (v_dp ->> 'vehicleId')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END;

  v_dp_categoria := v_dp ->> 'categoria';
  IF v_dp_categoria IS NULL THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  IF (v_dp ->> 'valor') IS NULL OR (v_dp ->> 'valor') !~ '^[0-9]+(\.[0-9]+)?$' THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;
  v_dp_valor := (v_dp ->> 'valor')::numeric;

  IF v_dp_vehicle_id IS DISTINCT FROM p_vehicle_id
     OR v_dp_categoria IS DISTINCT FROM p_categoria
     OR v_dp_valor IS DISTINCT FROM p_valor THEN
    RETURN jsonb_build_object('kind','rejected','reason','invariant_violation');
  END IF;

  -- (5) Valida o veículo.
  SELECT id, user_id, status
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

  -- (6) Idempotência via whatsapp_action_executions — ANTES do insert.
  SELECT id, user_id, contact_id, vehicle_id, result_payload
    INTO v_existing_exec
    FROM public.whatsapp_action_executions
    WHERE draft_id = p_draft_id
      AND action_type = 'expense_create'
    FOR UPDATE;

  IF FOUND THEN
    IF v_existing_exec.user_id IS DISTINCT FROM p_user_id
       OR v_existing_exec.contact_id IS DISTINCT FROM p_contact_id
       OR v_existing_exec.vehicle_id IS DISTINCT FROM p_vehicle_id
       OR v_existing_exec.result_payload IS NULL
       OR jsonb_typeof(v_existing_exec.result_payload) <> 'object' THEN
      RETURN jsonb_build_object('kind','conflicted','reason','action_execution_conflict');
    END IF;

    v_exec_despesa_id := NULL;
    v_exec_categoria := v_existing_exec.result_payload ->> 'categoria';
    IF (v_existing_exec.result_payload ->> 'valor') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      v_exec_valor := (v_existing_exec.result_payload ->> 'valor')::numeric;
    END IF;
    IF (v_existing_exec.result_payload ->> 'despesaId') IS NOT NULL THEN
      BEGIN
        v_exec_despesa_id := (v_existing_exec.result_payload ->> 'despesaId')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_exec_despesa_id := NULL;
      END;
    END IF;

    IF v_exec_categoria IS DISTINCT FROM p_categoria
       OR v_exec_valor IS DISTINCT FROM p_valor THEN
      RETURN jsonb_build_object('kind','conflicted','reason','action_execution_conflict');
    END IF;

    RETURN jsonb_build_object(
      'kind','replayed',
      'actionExecutionId', v_existing_exec.id,
      'despesaId', v_exec_despesa_id,
      'categoria', v_exec_categoria,
      'valor', v_exec_valor
    );
  END IF;

  -- (7) INSERT da despesa.
  INSERT INTO public.despesas (user_id, vehicle_id, valor, categoria, descricao)
  VALUES (p_user_id, p_vehicle_id, p_valor, p_categoria, COALESCE(p_descricao, ''))
  RETURNING id INTO v_despesa_id;

  INSERT INTO public.whatsapp_action_executions (
    draft_id, action_type, user_id, contact_id, vehicle_id,
    conversation_state_id, source_message_id, status,
    result_payload, started_at, completed_at
  ) VALUES (
    p_draft_id, 'expense_create', p_user_id, p_contact_id, p_vehicle_id,
    p_conversation_state_id, p_confirmation_message_id, 'succeeded',
    jsonb_build_object(
      'outcome','applied',
      'despesaId', v_despesa_id,
      'categoria', p_categoria,
      'valor', p_valor,
      'orchestratorVersion', p_orchestrator_version
    ),
    now(), now()
  )
  RETURNING id INTO v_exec_id;

  RETURN jsonb_build_object(
    'kind','applied',
    'actionExecutionId', v_exec_id,
    'despesaId', v_despesa_id,
    'categoria', p_categoria,
    'valor', p_valor
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.execute_whatsapp_expense_create(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, numeric, text, bigint, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.execute_whatsapp_expense_create(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, numeric, text, bigint, text
) TO postgres, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.execute_whatsapp_expense_create('
         || 'uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, '
         || 'text, numeric, text, bigint, text'
         || ') TO sandbox_exec';
  END IF;
END $$;
