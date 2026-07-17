-- Build 5.7F2E1A.5-HARD — correção 3
-- Adiciona 'category_reply' e 'expense_reported' ao array c_event_kinds da
-- função apply_whatsapp_orchestrator_transition. Nenhuma outra linha da
-- função foi alterada. CREATE OR REPLACE preserva grants existentes.

CREATE OR REPLACE FUNCTION public.apply_whatsapp_orchestrator_transition(p_queue_item_id uuid, p_lease_token uuid, p_expected_state_version bigint, p_patch jsonb, p_orchestrator_version text, p_result_summary jsonb, p_response jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_states           constant text[] := ARRAY[
    'idle','identifying_intent','awaiting_vehicle','awaiting_expense_confirmation',
    'awaiting_expense_correction','awaiting_requested_km','awaiting_km_confirmation',
    'awaiting_km_correction','awaiting_media_classification','awaiting_ocr_confirmation',
    'awaiting_maintenance_confirmation','processing','completed','cancelled','failed','expired'
  ];
  c_decision_kinds   constant text[] := ARRAY['respond','transition','reset_task','reset_conversation','select_vehicle','fallback','no_op'];
  c_event_kinds      constant text[] := ARRAY['greeting','help','confirm','deny','cancel_task','reset_conversation','vehicle_reply','unknown','expired_state','km_reported','category_reply','expense_reported'];
  c_outcomes         constant text[] := ARRAY['none','completed','cancelled','expired','failed'];
  c_request_sources  constant text[] := ARRAY['user_initiated','proactive_maintenance','reengagement','system'];
  c_draft_types      constant text[] := ARRAY['expense','km_update','maintenance'];
  c_patch_keys       constant text[] := ARRAY['next_state','current_intent','awaiting_field','request_source','active_vehicle_id','draft_type','draft_id','draft_version','draft_payload','confirmed_at','executed_at','expires_at','fallback_count'];
  c_response_keys    constant text[] := ARRAY['response_key','message_type','text_body','purpose','priority','scheduled_at','expires_at'];
  c_summary_keys     constant text[] := ARRAY['decisionKind','eventKind','outcome'];
  c_orch_valid_modes constant text[] := ARRAY['test','active'];

  v_call_now         timestamptz;
  v_lease_checked_at timestamptz;
  v_state_created_at timestamptz;
  v_finished_at      timestamptz;

  v_key text;
  v_ver_regex constant text := '^[a-z0-9._:-]+$';

  v_q               record;
  v_q_pre           record;
  v_msg             record;
  v_msg_pre         record;
  v_contact         record;
  v_instance        record;
  v_state           record;
  v_state_exists    boolean;
  v_vehicle_ok      boolean;

  v_decision_kind   text;
  v_event_kind      text;
  v_outcome         text;

  v_next_state      text;
  v_current_intent  text;
  v_awaiting_field  text;
  v_request_source  text;
  v_active_vehicle  uuid;
  v_draft_type      text;
  v_draft_id        uuid;
  v_draft_version   integer;
  v_draft_payload   jsonb;
  v_confirmed_at    timestamptz;
  v_executed_at     timestamptz;
  v_expires_at      timestamptz;
  v_fallback_count  integer;

  v_snap_state      text;
  v_snap_intent     text;
  v_snap_awaiting   text;
  v_snap_reqsrc     text;
  v_snap_vehicle    uuid;
  v_snap_draft_type text;
  v_snap_draft_id   uuid;
  v_snap_draft_ver  integer;
  v_snap_draft_pl   jsonb;
  v_snap_confirmed  timestamptz;
  v_snap_executed   timestamptz;
  v_snap_expires    timestamptz;
  v_snap_fallback   integer;
  v_snap_ver        bigint;

  v_response_key    text;
  v_msg_type        text;
  v_purpose         text;
  v_text_body       text;
  v_priority        integer;
  v_scheduled_at    timestamptz;
  v_resp_expires_at timestamptz;
  v_idem_key        text;
  v_outbound_id     uuid;
  v_existing_ob     record;

  v_new_state_ver   bigint;
  v_state_row_id    uuid;
  v_rows            integer;
  v_orch_result     jsonb;
BEGIN
  v_call_now := clock_timestamp();

  IF p_queue_item_id IS NULL
     OR p_lease_token IS NULL
     OR p_expected_state_version IS NULL
     OR p_expected_state_version < 0
     OR p_orchestrator_version IS NULL
     OR btrim(p_orchestrator_version) = ''
     OR char_length(p_orchestrator_version) < 1
     OR char_length(p_orchestrator_version) > 32
     OR p_orchestrator_version !~ v_ver_regex
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invariant_violation');
  END IF;

  IF p_result_summary IS NULL OR jsonb_typeof(p_result_summary) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result_summary_invalid');
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_result_summary) LOOP
    IF NOT (v_key = ANY (c_summary_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'result_summary_invalid');
    END IF;
  END LOOP;

  v_decision_kind := p_result_summary->>'decisionKind';
  v_event_kind    := p_result_summary->>'eventKind';
  v_outcome       := p_result_summary->>'outcome';

  IF v_decision_kind IS NULL OR NOT (v_decision_kind = ANY (c_decision_kinds))
     OR v_event_kind IS NULL OR NOT (v_event_kind = ANY (c_event_kinds))
     OR v_outcome IS NULL OR NOT (v_outcome = ANY (c_outcomes))
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result_summary_invalid');
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (c_patch_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_key');
    END IF;
  END LOOP;

  IF NOT (p_patch ? 'next_state') OR p_patch->>'next_state' IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;

  v_next_state := p_patch->>'next_state';
  IF NOT (v_next_state = ANY (c_states)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;

  BEGIN
    IF p_patch ? 'active_vehicle_id' AND jsonb_typeof(p_patch->'active_vehicle_id') <> 'null' THEN
      IF jsonb_typeof(p_patch->'active_vehicle_id') <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
      END IF;
      v_active_vehicle := (p_patch->>'active_vehicle_id')::uuid;
    END IF;
    IF p_patch ? 'draft_id' AND jsonb_typeof(p_patch->'draft_id') <> 'null' THEN
      IF jsonb_typeof(p_patch->'draft_id') <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
      END IF;
      v_draft_id := (p_patch->>'draft_id')::uuid;
    END IF;
    IF p_patch ? 'draft_version' AND jsonb_typeof(p_patch->'draft_version') <> 'null' THEN
      IF jsonb_typeof(p_patch->'draft_version') <> 'number' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
      END IF;
      v_draft_version := (p_patch->>'draft_version')::integer;
      IF v_draft_version < 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
      END IF;
    END IF;
    IF p_patch ? 'fallback_count' AND jsonb_typeof(p_patch->'fallback_count') <> 'null' THEN
      IF jsonb_typeof(p_patch->'fallback_count') <> 'number' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
      END IF;
      v_fallback_count := (p_patch->>'fallback_count')::integer;
      IF v_fallback_count < 0 OR v_fallback_count > 3 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
      END IF;
    END IF;
    IF p_patch ? 'confirmed_at' AND jsonb_typeof(p_patch->'confirmed_at') <> 'null' THEN
      IF jsonb_typeof(p_patch->'confirmed_at') <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
      END IF;
      v_confirmed_at := (p_patch->>'confirmed_at')::timestamptz;
    END IF;
    IF p_patch ? 'executed_at' AND jsonb_typeof(p_patch->'executed_at') <> 'null' THEN
      IF jsonb_typeof(p_patch->'executed_at') <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
      END IF;
      v_executed_at := (p_patch->>'executed_at')::timestamptz;
    END IF;
    IF p_patch ? 'expires_at' AND jsonb_typeof(p_patch->'expires_at') <> 'null' THEN
      IF jsonb_typeof(p_patch->'expires_at') <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
      END IF;
      v_expires_at := (p_patch->>'expires_at')::timestamptz;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END;

  IF p_patch ? 'current_intent' AND jsonb_typeof(p_patch->'current_intent') NOT IN ('string','null') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;
  IF p_patch ? 'awaiting_field' AND jsonb_typeof(p_patch->'awaiting_field') NOT IN ('string','null') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;
  IF p_patch ? 'request_source' AND jsonb_typeof(p_patch->'request_source') NOT IN ('string','null') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;
  IF p_patch ? 'request_source' AND jsonb_typeof(p_patch->'request_source') = 'string'
     AND NOT ((p_patch->>'request_source') = ANY (c_request_sources)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;
  IF p_patch ? 'draft_type' AND jsonb_typeof(p_patch->'draft_type') NOT IN ('string','null') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;
  IF p_patch ? 'draft_type' AND jsonb_typeof(p_patch->'draft_type') = 'string'
     AND NOT ((p_patch->>'draft_type') = ANY (c_draft_types)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;
  IF p_patch ? 'draft_payload' AND jsonb_typeof(p_patch->'draft_payload') NOT IN ('object','null') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;

  v_current_intent := CASE WHEN p_patch ? 'current_intent' AND jsonb_typeof(p_patch->'current_intent') = 'string' THEN p_patch->>'current_intent' END;
  v_awaiting_field := CASE WHEN p_patch ? 'awaiting_field' AND jsonb_typeof(p_patch->'awaiting_field') = 'string' THEN p_patch->>'awaiting_field' END;
  v_request_source := CASE WHEN p_patch ? 'request_source' AND jsonb_typeof(p_patch->'request_source') = 'string' THEN p_patch->>'request_source' END;
  v_draft_type     := CASE WHEN p_patch ? 'draft_type' AND jsonb_typeof(p_patch->'draft_type') = 'string' THEN p_patch->>'draft_type' END;
  v_draft_payload  := CASE WHEN p_patch ? 'draft_payload' AND jsonb_typeof(p_patch->'draft_payload') = 'object' THEN p_patch->'draft_payload' END;

  IF p_response IS NOT NULL THEN
    IF jsonb_typeof(p_response) <> 'object' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_response) LOOP
      IF NOT (v_key = ANY (c_response_keys)) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
      END IF;
    END LOOP;

    v_response_key := p_response->>'response_key';
    IF v_response_key IS NULL OR btrim(v_response_key) = ''
       OR char_length(v_response_key) < 1
       OR char_length(v_response_key) > 64
       OR v_response_key !~ v_ver_regex
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
    END IF;

    v_msg_type := COALESCE(p_response->>'message_type', 'text');
    IF v_msg_type <> 'text' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
    END IF;

    v_purpose := COALESCE(p_response->>'purpose', 'general');
    IF v_purpose <> 'general' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
    END IF;

    v_text_body := p_response->>'text_body';
    IF v_text_body IS NULL OR btrim(v_text_body) = '' OR char_length(v_text_body) > 4000 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
    END IF;

    IF p_response ? 'priority' AND jsonb_typeof(p_response->'priority') <> 'null' THEN
      IF jsonb_typeof(p_response->'priority') <> 'number' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
      END IF;
      BEGIN
        v_priority := (p_response->>'priority')::integer;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
      END;
      IF v_priority < -1000 OR v_priority > 1000 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
      END IF;
    ELSE
      v_priority := 0;
    END IF;

    IF p_response ? 'scheduled_at' AND jsonb_typeof(p_response->'scheduled_at') <> 'null' THEN
      BEGIN
        v_scheduled_at := (p_response->>'scheduled_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
      END;
      IF v_scheduled_at < v_call_now - interval '5 minutes' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
      END IF;
    ELSE
      v_scheduled_at := v_call_now;
    END IF;

    IF p_response ? 'expires_at' AND jsonb_typeof(p_response->'expires_at') <> 'null' THEN
      BEGIN
        v_resp_expires_at := (p_response->>'expires_at')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
      END;
      IF v_resp_expires_at <= v_scheduled_at THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'response_invalid');
      END IF;
    END IF;
  END IF;

  SELECT id, message_id INTO v_q_pre
    FROM public.whatsapp_processing_queue
   WHERE id = p_queue_item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'queue_item_not_found');
  END IF;
  IF v_q_pre.message_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source_message_missing');
  END IF;

  SELECT id, contact_id, provider, instance_id, direction, message_type INTO v_msg_pre
    FROM public.whatsapp_messages
   WHERE id = v_q_pre.message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source_message_missing');
  END IF;
  IF v_msg_pre.contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contact_missing');
  END IF;

  SELECT id, user_id, phone_e164, verified_at, unlinked_at INTO v_contact
    FROM public.whatsapp_contacts
   WHERE id = v_msg_pre.contact_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contact_missing');
  END IF;

  SELECT id, message_id, status, attempts, max_attempts,
         lease_token, lease_expires_at, claimed_at, claimed_by,
         orchestrator_processed_at, orchestrator_result, orchestrator_version
    INTO v_q
    FROM public.whatsapp_processing_queue
   WHERE id = p_queue_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'queue_item_not_found');
  END IF;
  IF v_q.message_id IS DISTINCT FROM v_q_pre.message_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'message_mismatch');
  END IF;

  SELECT id, contact_id, provider, instance_id, direction, message_type INTO v_msg
    FROM public.whatsapp_messages
   WHERE id = v_q.message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'source_message_missing');
  END IF;

  IF v_q.status = 'done'
     AND v_q.orchestrator_processed_at IS NOT NULL
     AND v_q.orchestrator_result IS NOT NULL
     AND v_q.orchestrator_version IS NOT NULL
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'wasReplay', true,
      'orchestratorResult', v_q.orchestrator_result
    );
  END IF;

  IF v_q.orchestrator_processed_at IS NOT NULL
     OR v_q.orchestrator_result IS NOT NULL
     OR v_q.orchestrator_version IS NOT NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invariant_violation');
  END IF;

  IF v_q.status IN ('done','failed','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'queue_already_terminal');
  END IF;

  IF v_msg.contact_id IS DISTINCT FROM v_contact.id
     OR v_msg.provider IS DISTINCT FROM v_msg_pre.provider
     OR v_msg.instance_id IS DISTINCT FROM v_msg_pre.instance_id
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'message_mismatch');
  END IF;
  IF v_msg.direction <> 'inbound' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'message_direction_invalid');
  END IF;
  IF v_msg.message_type <> 'text' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'message_type_unsupported');
  END IF;

  IF v_contact.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contact_missing');
  END IF;
  IF v_contact.verified_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contact_not_verified');
  END IF;
  IF v_contact.unlinked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'contact_unlinked');
  END IF;

  SELECT id, status, orchestrator_mode INTO v_instance
    FROM public.whatsapp_provider_instances
   WHERE provider = v_msg.provider
     AND instance_id = v_msg.instance_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'instance_not_found');
  END IF;
  IF v_instance.status <> 'active' OR NOT (v_instance.orchestrator_mode = ANY (c_orch_valid_modes)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'orchestrator_not_active');
  END IF;

  v_lease_checked_at := clock_timestamp();

  IF v_q.status <> 'running'
     OR v_q.lease_token IS NULL
     OR v_q.lease_token <> p_lease_token
     OR v_q.lease_expires_at IS NULL
     OR v_q.lease_expires_at <= v_lease_checked_at
     OR v_q.claimed_at IS NULL
     OR v_q.claimed_by IS NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lease_lost');
  END IF;

  SELECT id, user_id, contact_id, active_vehicle_id, current_intent, state,
         awaiting_field, request_source, draft_type, draft_id, draft_version,
         draft_payload, confirmed_at, executed_at, expires_at, created_at,
         state_version, fallback_count
    INTO v_state
    FROM public.whatsapp_conversation_states
   WHERE contact_id = v_contact.id
   FOR UPDATE;

  IF FOUND THEN
    v_state_exists := true;
    IF v_state.user_id IS DISTINCT FROM v_contact.user_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invariant_violation');
    END IF;
    v_state_row_id     := v_state.id;
    v_snap_state       := v_state.state;
    v_snap_intent      := v_state.current_intent;
    v_snap_awaiting    := v_state.awaiting_field;
    v_snap_reqsrc      := v_state.request_source;
    v_snap_vehicle     := v_state.active_vehicle_id;
    v_snap_draft_type  := v_state.draft_type;
    v_snap_draft_id    := v_state.draft_id;
    v_snap_draft_ver   := v_state.draft_version;
    v_snap_draft_pl    := v_state.draft_payload;
    v_snap_confirmed   := v_state.confirmed_at;
    v_snap_executed    := v_state.executed_at;
    v_snap_expires     := v_state.expires_at;
    v_snap_fallback    := v_state.fallback_count;
    v_snap_ver         := v_state.state_version;
    v_state_created_at := v_state.created_at;
  ELSE
    v_state_exists := false;
    v_snap_state       := 'idle';
    v_snap_intent      := NULL;
    v_snap_awaiting    := NULL;
    v_snap_reqsrc      := NULL;
    v_snap_vehicle     := NULL;
    v_snap_draft_type  := NULL;
    v_snap_draft_id    := NULL;
    v_snap_draft_ver   := 0;
    v_snap_draft_pl    := NULL;
    v_snap_confirmed   := NULL;
    v_snap_executed    := NULL;
    v_snap_expires     := NULL;
    v_snap_fallback    := 0;
    v_snap_ver         := 0;
    v_state_created_at := clock_timestamp();
  END IF;

  IF v_snap_ver <> p_expected_state_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'state_version_conflict',
      'currentStateVersion', v_snap_ver
    );
  END IF;

  IF NOT (p_patch ? 'current_intent') THEN v_current_intent := v_snap_intent; ELSIF jsonb_typeof(p_patch->'current_intent') = 'null' THEN v_current_intent := NULL; END IF;
  IF NOT (p_patch ? 'awaiting_field') THEN v_awaiting_field := v_snap_awaiting; ELSIF jsonb_typeof(p_patch->'awaiting_field') = 'null' THEN v_awaiting_field := NULL; END IF;
  IF NOT (p_patch ? 'request_source') THEN v_request_source := v_snap_reqsrc; ELSIF jsonb_typeof(p_patch->'request_source') = 'null' THEN v_request_source := NULL; END IF;
  IF NOT (p_patch ? 'active_vehicle_id') THEN v_active_vehicle := v_snap_vehicle; ELSIF jsonb_typeof(p_patch->'active_vehicle_id') = 'null' THEN v_active_vehicle := NULL; END IF;
  IF NOT (p_patch ? 'draft_type') THEN v_draft_type := v_snap_draft_type; ELSIF jsonb_typeof(p_patch->'draft_type') = 'null' THEN v_draft_type := NULL; END IF;
  IF NOT (p_patch ? 'draft_id') THEN v_draft_id := v_snap_draft_id; ELSIF jsonb_typeof(p_patch->'draft_id') = 'null' THEN v_draft_id := NULL; END IF;
  IF NOT (p_patch ? 'draft_version') THEN v_draft_version := v_snap_draft_ver; ELSIF jsonb_typeof(p_patch->'draft_version') = 'null' THEN v_draft_version := 0; END IF;
  IF NOT (p_patch ? 'draft_payload') THEN v_draft_payload := v_snap_draft_pl; ELSIF jsonb_typeof(p_patch->'draft_payload') = 'null' THEN v_draft_payload := NULL; END IF;
  IF NOT (p_patch ? 'confirmed_at') THEN v_confirmed_at := v_snap_confirmed; ELSIF jsonb_typeof(p_patch->'confirmed_at') = 'null' THEN v_confirmed_at := NULL; END IF;
  IF NOT (p_patch ? 'executed_at') THEN v_executed_at := v_snap_executed; ELSIF jsonb_typeof(p_patch->'executed_at') = 'null' THEN v_executed_at := NULL; END IF;
  IF NOT (p_patch ? 'expires_at') THEN v_expires_at := v_snap_expires; ELSIF jsonb_typeof(p_patch->'expires_at') = 'null' THEN v_expires_at := NULL; END IF;
  IF NOT (p_patch ? 'fallback_count') THEN v_fallback_count := v_snap_fallback; ELSIF jsonb_typeof(p_patch->'fallback_count') = 'null' THEN v_fallback_count := 0; END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at <= v_state_created_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'patch_invalid_value');
  END IF;

  IF v_draft_id IS NULL THEN
    IF v_draft_version <> 0 OR v_draft_type IS NOT NULL OR v_draft_payload IS NOT NULL
       OR v_confirmed_at IS NOT NULL OR v_executed_at IS NOT NULL
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
    END IF;
  ELSE
    IF v_snap_draft_id IS NULL OR v_snap_draft_id <> v_draft_id THEN
      IF v_draft_version <> 0 OR v_confirmed_at IS NOT NULL OR v_executed_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
      END IF;
    ELSE
      IF v_draft_version <> v_snap_draft_ver AND v_draft_version <> v_snap_draft_ver + 1 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
      END IF;
    END IF;
    IF v_confirmed_at IS NULL AND v_executed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
    END IF;
    IF v_executed_at IS NOT NULL AND v_confirmed_at IS NOT NULL AND v_executed_at < v_confirmed_at THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'draft_transition_invalid');
    END IF;
  END IF;

  IF v_active_vehicle IS NOT NULL THEN
    SELECT true INTO v_vehicle_ok
      FROM public.veiculos
     WHERE id = v_active_vehicle
       AND user_id = v_contact.user_id
       AND (status IS NULL OR status <> 'archived')
     LIMIT 1;
    IF NOT COALESCE(v_vehicle_ok, false) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'vehicle_invalid');
    END IF;
  END IF;

  v_outbound_id := NULL;
  IF p_response IS NOT NULL THEN
    v_idem_key := 'conv:' || v_contact.id::text || ':msg:' || v_msg.id::text || ':resp:' || v_response_key;

    SELECT * INTO v_existing_ob
      FROM public.whatsapp_outbound_queue
     WHERE idempotency_key = v_idem_key
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
         OR v_existing_ob.priority IS DISTINCT FROM v_priority
         OR v_existing_ob.expires_at IS DISTINCT FROM v_resp_expires_at
      THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'idempotency_payload_mismatch');
      END IF;
      v_outbound_id := v_existing_ob.id;
    END IF;
  END IF;

  v_finished_at := clock_timestamp();

  IF p_response IS NOT NULL AND v_outbound_id IS NULL THEN
    BEGIN
      INSERT INTO public.whatsapp_outbound_queue (
        user_id, contact_id, provider, instance_id, phone_e164,
        message_type, text_body, status, priority, attempts, max_attempts,
        scheduled_at, purpose, expires_at, idempotency_key, source_message_id
      ) VALUES (
        v_contact.user_id, v_contact.id, v_msg.provider, v_msg.instance_id, v_contact.phone_e164,
        'text', v_text_body, 'queued', v_priority, 0, 5,
        v_scheduled_at, 'general', v_resp_expires_at, v_idem_key, v_msg.id
      )
      RETURNING id INTO v_outbound_id;
    EXCEPTION WHEN unique_violation THEN
      IF SQLERRM LIKE '%woq_idempotency_unique%' THEN
        SELECT * INTO v_existing_ob
          FROM public.whatsapp_outbound_queue
         WHERE idempotency_key = v_idem_key
         FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'idempotency_race_lost';
        END IF;
        IF v_existing_ob.source_message_id IS DISTINCT FROM v_msg.id
           OR v_existing_ob.contact_id IS DISTINCT FROM v_contact.id
           OR v_existing_ob.user_id IS DISTINCT FROM v_contact.user_id
           OR v_existing_ob.provider IS DISTINCT FROM v_msg.provider
           OR v_existing_ob.instance_id IS DISTINCT FROM v_msg.instance_id
           OR v_existing_ob.phone_e164 IS DISTINCT FROM v_contact.phone_e164
           OR v_existing_ob.text_body IS DISTINCT FROM v_text_body
           OR v_existing_ob.priority IS DISTINCT FROM v_priority
           OR v_existing_ob.expires_at IS DISTINCT FROM v_resp_expires_at
        THEN
          RAISE EXCEPTION 'idempotency_payload_mismatch_post_race';
        END IF;
        v_outbound_id := v_existing_ob.id;
      ELSE
        RAISE;
      END IF;
    END;
  END IF;

  IF v_state_exists THEN
    UPDATE public.whatsapp_conversation_states
       SET state = v_next_state,
           current_intent = v_current_intent,
           awaiting_field = v_awaiting_field,
           request_source = v_request_source,
           active_vehicle_id = v_active_vehicle,
           draft_type = v_draft_type,
           draft_id = v_draft_id,
           draft_version = v_draft_version,
           draft_payload = v_draft_payload,
           confirmed_at = v_confirmed_at,
           executed_at = v_executed_at,
           expires_at = v_expires_at,
           fallback_count = v_fallback_count,
           last_message_id = v_msg.id,
           last_interaction_at = v_finished_at,
           state_version = state_version + 1
     WHERE id = v_state_row_id
       AND state_version = p_expected_state_version
     RETURNING state_version INTO v_new_state_ver;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'state_update_lost_race';
    END IF;
  ELSE
    INSERT INTO public.whatsapp_conversation_states (
      user_id, contact_id, active_vehicle_id, current_intent, state,
      awaiting_field, request_source, draft_type, draft_id, draft_version,
      draft_payload, confirmed_at, executed_at, last_message_id,
      last_interaction_at, expires_at, created_at, state_version, fallback_count
    ) VALUES (
      v_contact.user_id, v_contact.id, v_active_vehicle, v_current_intent, v_next_state,
      v_awaiting_field, v_request_source, v_draft_type, v_draft_id, v_draft_version,
      v_draft_payload, v_confirmed_at, v_executed_at, v_msg.id,
      v_finished_at, v_expires_at, v_state_created_at, 1, v_fallback_count
    )
    RETURNING state_version INTO v_new_state_ver;
  END IF;

  v_orch_result := jsonb_build_object(
    'decisionKind', v_decision_kind,
    'eventKind', v_event_kind,
    'outcome', v_outcome,
    'responseKey', to_jsonb(v_response_key),
    'nextState', v_next_state,
    'stateVersion', v_new_state_ver,
    'outboundQueueId', to_jsonb(v_outbound_id)
  );

  UPDATE public.whatsapp_processing_queue
     SET status = 'done',
         finished_at = v_finished_at,
         error_message = NULL,
         orchestrator_processed_at = v_finished_at,
         orchestrator_result = v_orch_result,
         orchestrator_version = p_orchestrator_version,
         lease_token = NULL,
         lease_expires_at = NULL,
         claimed_at = NULL,
         claimed_by = NULL
   WHERE id = p_queue_item_id
     AND status = 'running'
     AND lease_token = p_lease_token;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'queue_finalize_lost_race';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'wasReplay', false,
    'orchestratorResult', v_orch_result
  );
END;
$function$;