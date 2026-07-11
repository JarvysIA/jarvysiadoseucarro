
CREATE OR REPLACE FUNCTION public.apply_whatsapp_orchestrator_transition(
  p_queue_item_id uuid,
  p_lease_token uuid,
  p_expected_state_version bigint,
  p_patch jsonb,
  p_orchestrator_version text,
  p_result_summary jsonb,
  p_response jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  c_states constant text[] := ARRAY[
    'idle','identifying_intent','awaiting_vehicle','awaiting_expense_confirmation',
    'awaiting_expense_correction','awaiting_requested_km','awaiting_km_confirmation',
    'awaiting_km_correction','awaiting_media_classification','awaiting_ocr_confirmation',
    'awaiting_maintenance_confirmation','processing','completed','cancelled','failed','expired'
  ];
  c_decision constant text[] := ARRAY['respond','transition','reset_task','reset_conversation','select_vehicle','fallback','no_op'];
  c_event constant text[] := ARRAY['greeting','help','confirm','deny','cancel_task','reset_conversation','vehicle_reply','unknown','expired_state'];
  c_outcome constant text[] := ARRAY['none','completed','cancelled','expired','failed'];
  c_request_source constant text[] := ARRAY['user_initiated','proactive_maintenance','reengagement','system'];
  c_draft_type constant text[] := ARRAY['expense','km_update','maintenance'];
  c_patch_keys constant text[] := ARRAY['next_state','current_intent','awaiting_field','request_source','active_vehicle_id','draft_type','draft_id','draft_version','draft_payload','confirmed_at','executed_at','expires_at','fallback_count'];
  c_response_keys constant text[] := ARRAY['response_key','message_type','text_body','purpose','priority','scheduled_at','expires_at'];
  c_summary_keys constant text[] := ARRAY['decision_kind','event_kind','outcome'];

  v_key text;
  v_now timestamptz := now();
  v_q record;
  v_msg record;
  v_contact record;
  v_state record;
  v_instance record;
  v_state_exists boolean;
  v_vehicle record;

  v_decision_kind text;
  v_event_kind text;
  v_outcome text;

  v_next_state text;
  v_response_key text;
  v_msg_type text;
  v_purpose text;
  v_text_body text;
  v_priority int;
  v_sched timestamptz;
  v_resp_expires timestamptz;

  f_state text;
  f_current_intent text;
  f_awaiting_field text;
  f_request_source text;
  f_active_vehicle uuid;
  f_draft_type text;
  f_draft_id uuid;
  f_draft_version int;
  f_draft_payload jsonb;
  f_confirmed_at timestamptz;
  f_executed_at timestamptz;
  f_expires_at timestamptz;
  f_fallback_count int;

  s_draft_id uuid;
  s_draft_version int;

  v_has_key_draft_id boolean;
  v_has_key_draft_version boolean;
  v_has_key_active_vehicle boolean;
  v_has_key_confirmed_at boolean;
  v_has_key_executed_at boolean;
  v_has_key_draft_payload boolean;

  v_idem_key text;
  v_existing_ob record;
  v_outbound_id uuid;
  v_new_state_version bigint;
  v_orch_result jsonb;
  v_rows int;
  v_constraint text;
BEGIN
  ----------------------------------------------------------------
  -- 6. Parameter validation (before any lock/write)
  ----------------------------------------------------------------
  IF p_queue_item_id IS NULL THEN RAISE EXCEPTION 'INVALID_QUEUE_ITEM_ID' USING ERRCODE='check_violation'; END IF;
  IF p_lease_token IS NULL THEN RAISE EXCEPTION 'INVALID_LEASE_TOKEN' USING ERRCODE='check_violation'; END IF;
  IF p_expected_state_version IS NULL OR p_expected_state_version < 0 THEN
    RAISE EXCEPTION 'INVALID_EXPECTED_STATE_VERSION' USING ERRCODE='check_violation';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PATCH' USING ERRCODE='check_violation';
  END IF;
  IF p_orchestrator_version IS NULL
     OR btrim(p_orchestrator_version) = ''
     OR char_length(p_orchestrator_version) > 32
     OR p_orchestrator_version !~ '^[a-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'INVALID_ORCHESTRATOR_VERSION' USING ERRCODE='check_violation';
  END IF;
  IF p_result_summary IS NULL OR jsonb_typeof(p_result_summary) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_RESULT_SUMMARY' USING ERRCODE='check_violation';
  END IF;
  IF p_response IS NOT NULL AND jsonb_typeof(p_response) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_RESPONSE' USING ERRCODE='check_violation';
  END IF;

  ----------------------------------------------------------------
  -- 7. result_summary contract
  ----------------------------------------------------------------
  FOR v_key IN SELECT jsonb_object_keys(p_result_summary) LOOP
    IF NOT (v_key = ANY(c_summary_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'result_summary_invalid');
    END IF;
  END LOOP;
  v_decision_kind := p_result_summary->>'decision_kind';
  v_event_kind := p_result_summary->>'event_kind';
  v_outcome := p_result_summary->>'outcome';
  IF v_decision_kind IS NULL OR v_event_kind IS NULL OR v_outcome IS NULL
     OR NOT (v_decision_kind = ANY(c_decision))
     OR NOT (v_event_kind = ANY(c_event))
     OR NOT (v_outcome = ANY(c_outcome)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result_summary_invalid');
  END IF;

  ----------------------------------------------------------------
  -- 8. Initial discovery (no lock)
  ----------------------------------------------------------------
  SELECT q.id, q.message_id INTO v_q
    FROM public.whatsapp_processing_queue q WHERE q.id = p_queue_item_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'queue_item_not_found'); END IF;
  IF v_q.message_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'source_message_missing'); END IF;

  SELECT m.id, m.contact_id INTO v_msg
    FROM public.whatsapp_messages m WHERE m.id = v_q.message_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'source_message_missing'); END IF;
  IF v_msg.contact_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'contact_missing'); END IF;

  ----------------------------------------------------------------
  -- 10. Lock contact
  ----------------------------------------------------------------
  SELECT c.id, c.user_id, c.phone_e164, c.verified_at, c.unlinked_at
    INTO v_contact
    FROM public.whatsapp_contacts c
    WHERE c.id = v_msg.contact_id
    FOR UPDATE;
  IF NOT FOUND OR v_contact.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contact_missing');
  END IF;

  ----------------------------------------------------------------
  -- 11. Lock queue + reload message
  ----------------------------------------------------------------
  SELECT q.id, q.message_id, q.status, q.lease_token, q.lease_expires_at,
         q.claimed_at, q.claimed_by,
         q.orchestrator_processed_at, q.orchestrator_result, q.orchestrator_version,
         q.attempts
    INTO v_q
    FROM public.whatsapp_processing_queue q
    WHERE q.id = p_queue_item_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'queue_item_not_found'); END IF;

  SELECT m.id, m.contact_id, m.provider, m.instance_id, m.direction, m.message_type
    INTO v_msg
    FROM public.whatsapp_messages m WHERE m.id = v_q.message_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'source_message_missing'); END IF;
  IF v_msg.contact_id IS DISTINCT FROM v_contact.id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'message_mismatch');
  END IF;

  ----------------------------------------------------------------
  -- 12. Durable replay
  ----------------------------------------------------------------
  IF v_q.status = 'done'
     AND v_q.orchestrator_processed_at IS NOT NULL
     AND v_q.orchestrator_result IS NOT NULL
     AND v_q.orchestrator_version IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'wasReplay', true, 'orchestratorResult', v_q.orchestrator_result);
  END IF;

  ----------------------------------------------------------------
  -- 13. Invariants
  ----------------------------------------------------------------
  IF v_q.orchestrator_processed_at IS NOT NULL
     OR v_q.orchestrator_result IS NOT NULL
     OR v_q.orchestrator_version IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'orchestrator_invariant_violation');
  END IF;
  IF v_q.status IN ('done','failed','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'queue_already_terminal');
  END IF;

  ----------------------------------------------------------------
  -- 14. Post-replay eligibility
  ----------------------------------------------------------------
  IF v_contact.verified_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contact_not_verified');
  END IF;
  IF v_contact.unlinked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contact_unlinked');
  END IF;
  IF p_response IS NOT NULL AND (v_contact.phone_e164 IS NULL OR btrim(v_contact.phone_e164) = '') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contact_phone_missing');
  END IF;
  IF v_msg.direction <> 'inbound' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'message_direction_invalid');
  END IF;
  IF v_msg.message_type <> 'text' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'message_type_unsupported');
  END IF;
  IF v_msg.provider IS NULL OR btrim(v_msg.provider) = ''
     OR v_msg.instance_id IS NULL OR btrim(v_msg.instance_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'instance_not_found');
  END IF;

  SELECT pi.status, pi.orchestrator_mode INTO v_instance
    FROM public.whatsapp_provider_instances pi
    WHERE pi.provider = v_msg.provider AND pi.instance_id = v_msg.instance_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'instance_not_found');
  END IF;
  IF v_instance.status <> 'active' OR v_instance.orchestrator_mode NOT IN ('test','active') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'orchestrator_not_active');
  END IF;

  ----------------------------------------------------------------
  -- 15. Lease
  ----------------------------------------------------------------
  IF v_q.status <> 'running'
     OR v_q.lease_token IS DISTINCT FROM p_lease_token
     OR v_q.lease_expires_at IS NULL OR v_q.lease_expires_at <= v_now
     OR v_q.claimed_at IS NULL OR v_q.claimed_by IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lease_lost');
  END IF;

  ----------------------------------------------------------------
  -- 16. Load state (or virtual snapshot)
  ----------------------------------------------------------------
  SELECT s.id, s.user_id, s.state, s.state_version, s.fallback_count,
         s.active_vehicle_id, s.current_intent, s.awaiting_field,
         s.request_source, s.draft_type, s.draft_id, s.draft_version,
         s.draft_payload, s.confirmed_at, s.executed_at, s.expires_at
    INTO v_state
    FROM public.whatsapp_conversation_states s
    WHERE s.contact_id = v_contact.id
    FOR UPDATE;
  v_state_exists := FOUND;

  IF v_state_exists THEN
    IF v_state.user_id IS DISTINCT FROM v_contact.user_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'state_invariant_violation');
    END IF;
    f_state := v_state.state;
    f_fallback_count := v_state.fallback_count;
    f_active_vehicle := v_state.active_vehicle_id;
    f_current_intent := v_state.current_intent;
    f_awaiting_field := v_state.awaiting_field;
    f_request_source := v_state.request_source;
    f_draft_type := v_state.draft_type;
    f_draft_id := v_state.draft_id;
    f_draft_version := v_state.draft_version;
    f_draft_payload := v_state.draft_payload;
    f_confirmed_at := v_state.confirmed_at;
    f_executed_at := v_state.executed_at;
    f_expires_at := v_state.expires_at;
  ELSE
    f_state := 'idle';
    f_fallback_count := 0;
    f_active_vehicle := NULL;
    f_current_intent := NULL;
    f_awaiting_field := NULL;
    f_request_source := NULL;
    f_draft_type := NULL;
    f_draft_id := NULL;
    f_draft_version := 0;
    f_draft_payload := NULL;
    f_confirmed_at := NULL;
    f_executed_at := NULL;
    f_expires_at := NULL;
  END IF;

  s_draft_id := f_draft_id;
  s_draft_version := f_draft_version;

  ----------------------------------------------------------------
  -- 17. CAS
  ----------------------------------------------------------------
  IF (CASE WHEN v_state_exists THEN v_state.state_version ELSE 0::bigint END) <> p_expected_state_version THEN
    RETURN jsonb_build_object(
      'ok', false, 'conflict', true,
      'reason', 'state_version_conflict',
      'currentStateVersion', CASE WHEN v_state_exists THEN v_state.state_version ELSE 0::bigint END
    );
  END IF;

  ----------------------------------------------------------------
  -- 18/19/20. Patch whitelist + types
  ----------------------------------------------------------------
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY(c_patch_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_key');
    END IF;
  END LOOP;
  IF NOT (p_patch ? 'next_state') OR jsonb_typeof(p_patch->'next_state') <> 'string' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;
  v_next_state := p_patch->>'next_state';
  IF NOT (v_next_state = ANY(c_states)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;

  IF p_patch ? 'current_intent' THEN
    IF jsonb_typeof(p_patch->'current_intent') NOT IN ('string','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    f_current_intent := p_patch->>'current_intent';
  END IF;
  IF p_patch ? 'awaiting_field' THEN
    IF jsonb_typeof(p_patch->'awaiting_field') NOT IN ('string','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    f_awaiting_field := p_patch->>'awaiting_field';
  END IF;
  IF p_patch ? 'request_source' THEN
    IF jsonb_typeof(p_patch->'request_source') NOT IN ('string','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    IF p_patch->>'request_source' IS NOT NULL AND NOT (p_patch->>'request_source' = ANY(c_request_source)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    f_request_source := p_patch->>'request_source';
  END IF;
  IF p_patch ? 'draft_type' THEN
    IF jsonb_typeof(p_patch->'draft_type') NOT IN ('string','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    IF p_patch->>'draft_type' IS NOT NULL AND NOT (p_patch->>'draft_type' = ANY(c_draft_type)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    f_draft_type := p_patch->>'draft_type';
  END IF;
  IF p_patch ? 'fallback_count' THEN
    IF jsonb_typeof(p_patch->'fallback_count') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    BEGIN f_fallback_count := (p_patch->>'fallback_count')::int;
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END;
    IF f_fallback_count < 0 OR f_fallback_count > 3 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
  END IF;

  v_has_key_active_vehicle := p_patch ? 'active_vehicle_id';
  IF v_has_key_active_vehicle THEN
    IF jsonb_typeof(p_patch->'active_vehicle_id') NOT IN ('string','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    IF p_patch->>'active_vehicle_id' IS NULL THEN
      f_active_vehicle := NULL;
    ELSE
      BEGIN f_active_vehicle := (p_patch->>'active_vehicle_id')::uuid;
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END;
    END IF;
  END IF;

  v_has_key_draft_id := p_patch ? 'draft_id';
  IF v_has_key_draft_id THEN
    IF jsonb_typeof(p_patch->'draft_id') NOT IN ('string','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    IF p_patch->>'draft_id' IS NULL THEN
      f_draft_id := NULL;
    ELSE
      BEGIN f_draft_id := (p_patch->>'draft_id')::uuid;
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END;
    END IF;
  END IF;

  v_has_key_draft_version := p_patch ? 'draft_version';
  IF v_has_key_draft_version THEN
    IF jsonb_typeof(p_patch->'draft_version') <> 'number' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    BEGIN f_draft_version := (p_patch->>'draft_version')::int;
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END;
    IF f_draft_version < 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
  END IF;

  v_has_key_draft_payload := p_patch ? 'draft_payload';
  IF v_has_key_draft_payload THEN
    IF jsonb_typeof(p_patch->'draft_payload') NOT IN ('object','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    IF jsonb_typeof(p_patch->'draft_payload') = 'null' THEN
      f_draft_payload := NULL;
    ELSE
      f_draft_payload := p_patch->'draft_payload';
    END IF;
  END IF;

  v_has_key_confirmed_at := p_patch ? 'confirmed_at';
  IF v_has_key_confirmed_at THEN
    IF jsonb_typeof(p_patch->'confirmed_at') NOT IN ('string','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    IF p_patch->>'confirmed_at' IS NULL THEN
      f_confirmed_at := NULL;
    ELSE
      BEGIN f_confirmed_at := (p_patch->>'confirmed_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END;
    END IF;
  END IF;

  v_has_key_executed_at := p_patch ? 'executed_at';
  IF v_has_key_executed_at THEN
    IF jsonb_typeof(p_patch->'executed_at') NOT IN ('string','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    IF p_patch->>'executed_at' IS NULL THEN
      f_executed_at := NULL;
    ELSE
      BEGIN f_executed_at := (p_patch->>'executed_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END;
    END IF;
  END IF;

  IF p_patch ? 'expires_at' THEN
    IF jsonb_typeof(p_patch->'expires_at') NOT IN ('string','null') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    IF p_patch->>'expires_at' IS NULL THEN
      f_expires_at := NULL;
    ELSE
      BEGIN f_expires_at := (p_patch->>'expires_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END;
      IF f_expires_at <= v_now THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value'); END IF;
    END IF;
  END IF;

  f_state := v_next_state;

  ----------------------------------------------------------------
  -- 21. Vehicle in focus
  ----------------------------------------------------------------
  IF v_has_key_active_vehicle AND f_active_vehicle IS NOT NULL THEN
    SELECT v.id, v.user_id, v.status INTO v_vehicle
      FROM public.veiculos v WHERE v.id = f_active_vehicle;
    IF NOT FOUND OR v_vehicle.user_id IS DISTINCT FROM v_contact.user_id OR v_vehicle.status = 'archived' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'vehicle_invalid');
    END IF;
  END IF;

  ----------------------------------------------------------------
  -- 22. Draft transition rules
  ----------------------------------------------------------------
  IF v_has_key_draft_id AND (p_patch->>'draft_id') IS NULL THEN
    IF (v_has_key_draft_version AND f_draft_version <> 0)
       OR (v_has_key_confirmed_at AND f_confirmed_at IS NOT NULL)
       OR (v_has_key_executed_at AND f_executed_at IS NOT NULL)
       OR (v_has_key_draft_payload AND f_draft_payload IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
    END IF;
    f_draft_id := NULL;
    f_draft_version := 0;
    f_draft_payload := NULL;
    f_confirmed_at := NULL;
    f_executed_at := NULL;
  ELSIF v_has_key_draft_id AND f_draft_id IS NOT NULL AND s_draft_id IS DISTINCT FROM f_draft_id THEN
    IF (v_has_key_draft_version AND f_draft_version <> 0)
       OR (v_has_key_confirmed_at AND f_confirmed_at IS NOT NULL)
       OR (v_has_key_executed_at AND f_executed_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
    END IF;
    f_draft_version := 0;
    f_confirmed_at := NULL;
    f_executed_at := NULL;
  ELSIF f_draft_id IS NOT NULL AND s_draft_id IS NOT NULL AND f_draft_id = s_draft_id THEN
    IF v_has_key_draft_version THEN
      IF f_draft_version < s_draft_version OR f_draft_version > s_draft_version + 1 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
      END IF;
    END IF;
  END IF;

  IF f_draft_id IS NULL THEN
    IF f_draft_version <> 0 OR f_confirmed_at IS NOT NULL OR f_executed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
    END IF;
  END IF;

  IF f_executed_at IS NOT NULL THEN
    IF f_draft_id IS NULL OR f_confirmed_at IS NULL OR f_executed_at < f_confirmed_at THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
    END IF;
  END IF;

  ----------------------------------------------------------------
  -- 24. Response payload
  ----------------------------------------------------------------
  IF p_response IS NOT NULL THEN
    FOR v_key IN SELECT jsonb_object_keys(p_response) LOOP
      IF NOT (v_key = ANY(c_response_keys)) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
      END IF;
    END LOOP;
    v_response_key := p_response->>'response_key';
    IF v_response_key IS NULL OR char_length(v_response_key) < 1 OR char_length(v_response_key) > 64
       OR v_response_key !~ '^[a-z0-9._:-]+$' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
    END IF;
    v_msg_type := COALESCE(p_response->>'message_type', 'text');
    IF v_msg_type <> 'text' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END IF;
    v_purpose := COALESCE(p_response->>'purpose', 'general');
    IF v_purpose <> 'general' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END IF;
    v_text_body := p_response->>'text_body';
    IF v_text_body IS NULL OR btrim(v_text_body) = '' OR char_length(v_text_body) > 4000 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END IF;
    IF p_response ? 'priority' THEN
      IF jsonb_typeof(p_response->'priority') <> 'number' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END IF;
      BEGIN v_priority := (p_response->>'priority')::int;
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END;
      IF v_priority < -1000 OR v_priority > 1000 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END IF;
    ELSE
      v_priority := 0;
    END IF;
    IF p_response ? 'scheduled_at' THEN
      IF jsonb_typeof(p_response->'scheduled_at') <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END IF;
      BEGIN v_sched := (p_response->>'scheduled_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END;
      IF v_sched < v_now - interval '5 minutes' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END IF;
    ELSE
      v_sched := v_now;
    END IF;
    IF p_response ? 'expires_at' THEN
      IF jsonb_typeof(p_response->'expires_at') NOT IN ('string','null') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END IF;
      IF p_response->>'expires_at' IS NULL THEN
        v_resp_expires := NULL;
      ELSE
        BEGIN v_resp_expires := (p_response->>'expires_at')::timestamptz;
        EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END;
        IF v_resp_expires <= v_sched THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid'); END IF;
      END IF;
    ELSE
      v_resp_expires := NULL;
    END IF;
  END IF;

  ----------------------------------------------------------------
  -- 25. Consistency decision_kind vs response
  ----------------------------------------------------------------
  IF v_decision_kind = 'no_op' AND p_response IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result_summary_invalid');
  END IF;
  IF v_decision_kind IN ('respond','fallback','reset_task','reset_conversation','select_vehicle')
     AND p_response IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result_summary_invalid');
  END IF;

  ----------------------------------------------------------------
  -- 27/28/29. Idempotency key + resolve existing outbound
  ----------------------------------------------------------------
  IF p_response IS NOT NULL THEN
    v_idem_key := format('conv:%s:msg:%s:resp:%s', v_contact.id::text, v_msg.id::text, v_response_key);
    SELECT o.id, o.source_message_id, o.contact_id, o.user_id, o.provider, o.instance_id,
           o.phone_e164, o.message_type, o.purpose, o.text_body, o.priority
      INTO v_existing_ob
      FROM public.whatsapp_outbound_queue o
      WHERE o.idempotency_key = v_idem_key
      FOR UPDATE;
    IF FOUND THEN
      IF v_existing_ob.source_message_id IS DISTINCT FROM v_msg.id
         OR v_existing_ob.contact_id IS DISTINCT FROM v_contact.id
         OR v_existing_ob.user_id IS DISTINCT FROM v_contact.user_id
         OR v_existing_ob.provider IS DISTINCT FROM v_msg.provider
         OR v_existing_ob.instance_id IS DISTINCT FROM v_msg.instance_id
         OR v_existing_ob.phone_e164 IS DISTINCT FROM v_contact.phone_e164
         OR v_existing_ob.message_type IS DISTINCT FROM 'text'
         OR v_existing_ob.purpose IS DISTINCT FROM 'general'
         OR v_existing_ob.text_body IS DISTINCT FROM v_text_body
         OR v_existing_ob.priority IS DISTINCT FROM v_priority THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'idempotency_payload_mismatch');
      END IF;
      v_outbound_id := v_existing_ob.id;
    END IF;
  END IF;

  ----------------------------------------------------------------
  -- 30/31. WRITE PHASE — outbound insert if needed
  ----------------------------------------------------------------
  IF p_response IS NOT NULL AND v_outbound_id IS NULL THEN
    BEGIN
      INSERT INTO public.whatsapp_outbound_queue(
        user_id, contact_id, provider, instance_id, phone_e164,
        message_type, text_body, status, priority, attempts, max_attempts,
        scheduled_at, expires_at, purpose, idempotency_key, source_message_id
      ) VALUES (
        v_contact.user_id, v_contact.id, v_msg.provider, v_msg.instance_id, v_contact.phone_e164,
        'text', v_text_body, 'queued', v_priority, 0, 5,
        v_sched, v_resp_expires, 'general', v_idem_key, v_msg.id
      ) RETURNING id INTO v_outbound_id;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint <> 'woq_idempotency_unique' THEN RAISE; END IF;
      SELECT o.id, o.source_message_id, o.contact_id, o.user_id, o.provider, o.instance_id,
             o.phone_e164, o.message_type, o.purpose, o.text_body, o.priority
        INTO v_existing_ob
        FROM public.whatsapp_outbound_queue o
        WHERE o.idempotency_key = v_idem_key
        FOR UPDATE;
      IF NOT FOUND THEN RAISE; END IF;
      IF v_existing_ob.source_message_id IS DISTINCT FROM v_msg.id
         OR v_existing_ob.contact_id IS DISTINCT FROM v_contact.id
         OR v_existing_ob.user_id IS DISTINCT FROM v_contact.user_id
         OR v_existing_ob.provider IS DISTINCT FROM v_msg.provider
         OR v_existing_ob.instance_id IS DISTINCT FROM v_msg.instance_id
         OR v_existing_ob.phone_e164 IS DISTINCT FROM v_contact.phone_e164
         OR v_existing_ob.text_body IS DISTINCT FROM v_text_body
         OR v_existing_ob.priority IS DISTINCT FROM v_priority THEN
        RAISE EXCEPTION 'outbound_race_divergent';
      END IF;
      v_outbound_id := v_existing_ob.id;
    END;
  END IF;

  ----------------------------------------------------------------
  -- 32. State insert or update
  ----------------------------------------------------------------
  IF v_state_exists THEN
    UPDATE public.whatsapp_conversation_states
       SET state = f_state,
           current_intent = f_current_intent,
           awaiting_field = f_awaiting_field,
           request_source = f_request_source,
           active_vehicle_id = f_active_vehicle,
           draft_type = f_draft_type,
           draft_id = f_draft_id,
           draft_version = f_draft_version,
           draft_payload = f_draft_payload,
           confirmed_at = f_confirmed_at,
           executed_at = f_executed_at,
           expires_at = f_expires_at,
           fallback_count = f_fallback_count,
           state_version = state_version + 1,
           last_message_id = v_msg.id,
           last_interaction_at = v_now
     WHERE id = v_state.id AND state_version = p_expected_state_version
     RETURNING state_version INTO v_new_state_version;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'state_update_lost_race'; END IF;
  ELSE
    BEGIN
      INSERT INTO public.whatsapp_conversation_states(
        user_id, contact_id, state, state_version, fallback_count,
        active_vehicle_id, current_intent, awaiting_field, request_source,
        draft_type, draft_id, draft_version, draft_payload,
        confirmed_at, executed_at, expires_at,
        last_message_id, last_interaction_at
      ) VALUES (
        v_contact.user_id, v_contact.id, f_state, 1, f_fallback_count,
        f_active_vehicle, f_current_intent, f_awaiting_field, f_request_source,
        f_draft_type, f_draft_id, f_draft_version, f_draft_payload,
        f_confirmed_at, f_executed_at, f_expires_at,
        v_msg.id, v_now
      ) RETURNING state_version INTO v_new_state_version;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'state_insert_lost_race';
    END;
  END IF;

  ----------------------------------------------------------------
  -- 34. Build orchestrator_result
  ----------------------------------------------------------------
  v_orch_result := jsonb_build_object(
    'decisionKind', v_decision_kind,
    'eventKind', v_event_kind,
    'responseKey', v_response_key,
    'nextState', f_state,
    'outcome', v_outcome,
    'stateVersion', v_new_state_version,
    'outboundQueueId', v_outbound_id
  );

  ----------------------------------------------------------------
  -- 35. Finalize queue
  ----------------------------------------------------------------
  UPDATE public.whatsapp_processing_queue
     SET status = 'done',
         finished_at = v_now,
         error_message = NULL,
         orchestrator_processed_at = v_now,
         orchestrator_result = v_orch_result,
         orchestrator_version = p_orchestrator_version,
         lease_token = NULL,
         lease_expires_at = NULL,
         claimed_at = NULL,
         claimed_by = NULL
   WHERE id = p_queue_item_id
     AND status = 'running'
     AND lease_token = p_lease_token
     AND lease_expires_at > v_now;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'queue_finalize_lost_race'; END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'wasReplay', false,
    'stateVersion', v_new_state_version,
    'outboundQueueId', v_outbound_id,
    'orchestratorResult', v_orch_result
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_whatsapp_orchestrator_transition(uuid, uuid, bigint, jsonb, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_whatsapp_orchestrator_transition(uuid, uuid, bigint, jsonb, text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_whatsapp_orchestrator_transition(uuid, uuid, bigint, jsonb, text, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_orchestrator_transition(uuid, uuid, bigint, jsonb, text, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.apply_whatsapp_orchestrator_transition(uuid, uuid, bigint, jsonb, text, jsonb, jsonb) IS
  'Build 5.7F2B2C — RPC atomica de transicao do orquestrador WhatsApp. CAS por state_version, outbound idempotente e finalizacao da fila. service_role apenas.';
