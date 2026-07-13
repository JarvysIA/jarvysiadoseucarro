
-- Build 5.7F2E1A.5-MJ1A — Three SECURITY DEFINER RPCs for atomic Jarvys KM prompt emission and sender finalization.
-- Backend-only. No productive caller. Does not alter promote/create/reserve/cancel/expire primitives or existing tables.

-- ============================================================
-- 1) enqueue_whatsapp_km_prompt
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_km_prompt(
  p_idempotency_key text,
  p_contact_id      uuid,
  p_vehicle_id      uuid,
  p_text_body       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_contact       record;
  v_vehicle       record;
  v_instance      record;
  v_existing_q    record;
  v_existing_msg  record;
  v_existing_req  record;
  v_msg_id        uuid;
  v_queue_id      uuid;
  v_create        record;
  v_key_trim      text;
  v_body_trim     text;
BEGIN
  -- Argument validation
  IF p_idempotency_key IS NULL THEN
    RETURN jsonb_build_object('result','invalid_idempotency_key');
  END IF;
  v_key_trim := btrim(p_idempotency_key);
  IF v_key_trim = '' OR char_length(p_idempotency_key) > 255 THEN
    RETURN jsonb_build_object('result','invalid_idempotency_key');
  END IF;

  IF p_text_body IS NULL THEN
    RETURN jsonb_build_object('result','invalid_text');
  END IF;
  v_body_trim := btrim(p_text_body);
  IF v_body_trim = '' OR char_length(p_text_body) > 4000 THEN
    RETURN jsonb_build_object('result','invalid_text');
  END IF;

  IF p_contact_id IS NULL OR p_vehicle_id IS NULL THEN
    RETURN jsonb_build_object('result','contact_not_found');
  END IF;

  -- Advisory lock keyed on idempotency key
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  -- Load and validate contact
  SELECT id, user_id, phone_e164, assigned_provider, assigned_instance_id,
         assigned_whatsapp_number, opt_in, opt_out, unlinked_at, verified_at
    INTO v_contact
    FROM public.whatsapp_contacts
    WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','contact_not_found');
  END IF;
  IF v_contact.opt_out = true THEN
    RETURN jsonb_build_object('result','contact_opted_out');
  END IF;
  IF v_contact.opt_in <> true
     OR v_contact.unlinked_at IS NOT NULL
     OR v_contact.verified_at IS NULL
     OR v_contact.user_id IS NULL
     OR v_contact.phone_e164 IS NULL
     OR v_contact.phone_e164 !~ '^\+[0-9]{10,15}$' THEN
    RETURN jsonb_build_object('result','contact_not_eligible');
  END IF;
  IF v_contact.assigned_provider IS NULL OR btrim(v_contact.assigned_provider) = ''
     OR v_contact.assigned_instance_id IS NULL OR btrim(v_contact.assigned_instance_id) = ''
     OR v_contact.assigned_whatsapp_number IS NULL OR btrim(v_contact.assigned_whatsapp_number) = '' THEN
    RETURN jsonb_build_object('result','contact_not_linked');
  END IF;

  -- Load and validate vehicle
  SELECT id, user_id, status
    INTO v_vehicle
    FROM public.veiculos
    WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','vehicle_not_found');
  END IF;
  IF v_vehicle.user_id IS DISTINCT FROM v_contact.user_id THEN
    RETURN jsonb_build_object('result','vehicle_not_owned');
  END IF;
  IF v_vehicle.status IS NULL THEN
    RETURN jsonb_build_object('result','vehicle_context_invalid');
  END IF;
  IF v_vehicle.status = 'archived' THEN
    RETURN jsonb_build_object('result','vehicle_archived');
  END IF;
  IF v_vehicle.status NOT IN ('free','trial','ativo','vip','enterprise') THEN
    RETURN jsonb_build_object('result','vehicle_context_invalid');
  END IF;

  -- Load and validate instance (canonical (provider, instance_id))
  SELECT id, provider, instance_id, status, phone_number_e164
    INTO v_instance
    FROM public.whatsapp_provider_instances
    WHERE provider = v_contact.assigned_provider
      AND instance_id = v_contact.assigned_instance_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','instance_not_found');
  END IF;
  IF v_instance.status <> 'active' THEN
    RETURN jsonb_build_object('result','instance_inactive');
  END IF;
  IF v_instance.provider <> 'zapi' THEN
    RETURN jsonb_build_object('result','instance_context_mismatch');
  END IF;
  IF v_instance.phone_number_e164 IS NOT NULL
     AND v_instance.phone_number_e164 <> v_contact.assigned_whatsapp_number THEN
    RETURN jsonb_build_object('result','instance_context_mismatch');
  END IF;

  -- Replay check via idempotency key
  SELECT id, user_id, contact_id, vehicle_id, provider, instance_id,
         phone_e164, text_body, purpose, source_message_id, status, idempotency_key
    INTO v_existing_q
    FROM public.whatsapp_outbound_queue
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

  IF FOUND THEN
    IF v_existing_q.purpose <> 'notification'
       OR v_existing_q.user_id IS DISTINCT FROM v_contact.user_id
       OR v_existing_q.contact_id IS DISTINCT FROM p_contact_id
       OR v_existing_q.vehicle_id IS DISTINCT FROM p_vehicle_id
       OR v_existing_q.provider IS DISTINCT FROM v_contact.assigned_provider
       OR v_existing_q.instance_id IS DISTINCT FROM v_contact.assigned_instance_id
       OR v_existing_q.phone_e164 IS DISTINCT FROM v_contact.phone_e164
       OR v_existing_q.text_body IS DISTINCT FROM p_text_body
       OR v_existing_q.source_message_id IS NULL THEN
      RETURN jsonb_build_object('result','idempotency_context_mismatch');
    END IF;

    SELECT id, direction, message_type, contact_id, user_id, vehicle_id, provider, instance_id, text_body
      INTO v_existing_msg
      FROM public.whatsapp_messages
      WHERE id = v_existing_q.source_message_id;
    IF NOT FOUND
       OR v_existing_msg.direction <> 'outbound'
       OR v_existing_msg.message_type <> 'text'
       OR v_existing_msg.contact_id IS DISTINCT FROM p_contact_id
       OR v_existing_msg.user_id IS DISTINCT FROM v_contact.user_id
       OR v_existing_msg.vehicle_id IS DISTINCT FROM p_vehicle_id
       OR v_existing_msg.text_body IS DISTINCT FROM p_text_body THEN
      RETURN jsonb_build_object('result','idempotency_context_mismatch');
    END IF;

    SELECT id, contact_id, user_id, vehicle_id
      INTO v_existing_req
      FROM public.whatsapp_km_prompt_requests
      WHERE prompt_message_id = v_existing_q.source_message_id;
    IF NOT FOUND
       OR v_existing_req.contact_id <> p_contact_id
       OR v_existing_req.user_id <> v_contact.user_id
       OR v_existing_req.vehicle_id <> p_vehicle_id THEN
      RETURN jsonb_build_object('result','idempotency_context_mismatch');
    END IF;

    RETURN jsonb_build_object(
      'result','replayed',
      'prompt_request_id', v_existing_req.id,
      'prompt_message_id', v_existing_q.source_message_id,
      'outbound_queue_id', v_existing_q.id
    );
  END IF;

  -- New emission — insert message (explicit queued), queue, then request via primitive
  INSERT INTO public.whatsapp_messages
    (direction, message_type, status, provider, instance_id,
     contact_id, user_id, vehicle_id, text_body)
  VALUES
    ('outbound','text','queued', v_contact.assigned_provider, v_contact.assigned_instance_id,
     p_contact_id, v_contact.user_id, p_vehicle_id, p_text_body)
  RETURNING id INTO v_msg_id;

  INSERT INTO public.whatsapp_outbound_queue
    (user_id, contact_id, vehicle_id, provider, instance_id, phone_e164,
     message_type, purpose, text_body, status, priority, attempts, max_attempts,
     source_message_id, idempotency_key)
  VALUES
    (v_contact.user_id, p_contact_id, p_vehicle_id,
     v_contact.assigned_provider, v_contact.assigned_instance_id, v_contact.phone_e164,
     'text','notification', p_text_body, 'queued', 0, 0, 5,
     v_msg_id, p_idempotency_key)
  RETURNING id INTO v_queue_id;

  SELECT * INTO v_create
    FROM public.create_whatsapp_km_prompt_request(
      v_msg_id, p_contact_id, v_contact.user_id, p_vehicle_id
    );
  IF v_create.result <> 'created' THEN
    RAISE EXCEPTION 'km_prompt_create_failed_%', v_create.result
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN jsonb_build_object(
    'result','created',
    'prompt_request_id', v_create.request_id,
    'prompt_message_id', v_msg_id,
    'outbound_queue_id', v_queue_id
  );
END;
$function$;

ALTER FUNCTION public.enqueue_whatsapp_km_prompt(text, uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_km_prompt(text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_km_prompt(text, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_km_prompt(text, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_whatsapp_km_prompt(text, uuid, uuid, text) TO service_role;
COMMENT ON FUNCTION public.enqueue_whatsapp_km_prompt(text, uuid, uuid, text) IS
  'Build 5.7F2E1A.5-MJ1A. Backend-only. Atomic creation of Jarvys KM prompt (message + outbound queue + km request), all in queued state. No text-based authorization. Not connected to productive callers.';

-- ============================================================
-- 2) finalize_whatsapp_km_prompt_sent
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_whatsapp_km_prompt_sent(
  p_outbound_queue_id   uuid,
  p_provider_message_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_queue     record;
  v_msg       record;
  v_req       record;
  v_promote   record;
  v_now       timestamptz;
  v_pid_trim  text;
BEGIN
  IF p_provider_message_id IS NULL THEN
    RETURN jsonb_build_object('result','invalid_provider_message_id');
  END IF;
  v_pid_trim := btrim(p_provider_message_id);
  IF v_pid_trim = '' OR char_length(p_provider_message_id) > 255 THEN
    RETURN jsonb_build_object('result','invalid_provider_message_id');
  END IF;

  SELECT id, user_id, contact_id, vehicle_id, provider, instance_id,
         source_message_id, status, provider_message_id, purpose
    INTO v_queue
    FROM public.whatsapp_outbound_queue
    WHERE id = p_outbound_queue_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','queue_not_found');
  END IF;

  IF v_queue.source_message_id IS NULL THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  SELECT id, direction, message_type, status, contact_id, user_id, vehicle_id,
         provider, instance_id, provider_message_id
    INTO v_msg
    FROM public.whatsapp_messages
    WHERE id = v_queue.source_message_id;
  IF NOT FOUND
     OR v_msg.direction <> 'outbound'
     OR v_msg.message_type <> 'text'
     OR v_msg.contact_id IS DISTINCT FROM v_queue.contact_id
     OR v_msg.user_id IS DISTINCT FROM v_queue.user_id
     OR v_msg.vehicle_id IS DISTINCT FROM v_queue.vehicle_id
     OR v_msg.provider IS DISTINCT FROM v_queue.provider
     OR v_msg.instance_id IS DISTINCT FROM v_queue.instance_id THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  SELECT id, status, contact_id, user_id, vehicle_id, pending_at, expires_at
    INTO v_req
    FROM public.whatsapp_km_prompt_requests
    WHERE prompt_message_id = v_queue.source_message_id;
  IF NOT FOUND
     OR v_req.contact_id IS DISTINCT FROM v_queue.contact_id
     OR v_req.user_id    IS DISTINCT FROM v_queue.user_id
     OR v_req.vehicle_id IS DISTINCT FROM v_queue.vehicle_id THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  -- Replay branch: queue already sent
  IF v_queue.status = 'sent' THEN
    IF v_msg.status <> 'sent' THEN
      RETURN jsonb_build_object('result','km_prompt_invariant_violation');
    END IF;
    IF v_req.status = 'cancelled' AND v_req.pending_at IS NULL THEN
      RETURN jsonb_build_object('result','km_prompt_invariant_violation');
    END IF;
    IF v_req.status NOT IN ('pending','reserved','consumed','expired','cancelled') THEN
      RETURN jsonb_build_object('result','km_prompt_invariant_violation');
    END IF;

    IF v_queue.provider_message_id IS NULL THEN
      v_now := now();
      UPDATE public.whatsapp_outbound_queue
        SET provider_message_id = p_provider_message_id
        WHERE id = v_queue.id;
      UPDATE public.whatsapp_messages
        SET provider_message_id = p_provider_message_id, updated_at = v_now
        WHERE id = v_msg.id;
    ELSIF v_queue.provider_message_id <> p_provider_message_id THEN
      RETURN jsonb_build_object('result','provider_message_id_mismatch');
    END IF;

    RETURN jsonb_build_object(
      'result','replayed',
      'prompt_request_id', v_req.id,
      'prompt_message_id', v_msg.id,
      'outbound_queue_id', v_queue.id,
      'pending_at', v_req.pending_at,
      'expires_at', v_req.expires_at
    );
  END IF;

  -- First application branch
  IF v_queue.status <> 'sending' THEN
    RETURN jsonb_build_object('result','queue_state_invalid');
  END IF;
  IF v_msg.status <> 'queued' OR v_req.status <> 'queued' THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  v_now := now();

  UPDATE public.whatsapp_outbound_queue
    SET status = 'sent',
        sent_at = v_now,
        provider_message_id = p_provider_message_id,
        error_message = NULL
    WHERE id = v_queue.id;

  UPDATE public.whatsapp_messages
    SET status = 'sent',
        provider_message_id = p_provider_message_id,
        updated_at = v_now
    WHERE id = v_msg.id;

  SELECT * INTO v_promote
    FROM public.promote_whatsapp_km_prompt_request_to_pending(v_msg.id);
  IF v_promote.result NOT IN ('promoted','already_pending') THEN
    RAISE EXCEPTION 'km_prompt_promote_failed_%', v_promote.result
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN jsonb_build_object(
    'result','finalized',
    'prompt_request_id', v_promote.request_id,
    'prompt_message_id', v_msg.id,
    'outbound_queue_id', v_queue.id,
    'pending_at', v_promote.pending_at,
    'expires_at', v_promote.expires_at
  );
END;
$function$;

ALTER FUNCTION public.finalize_whatsapp_km_prompt_sent(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_km_prompt_sent(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_km_prompt_sent(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_km_prompt_sent(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_km_prompt_sent(uuid, text) TO service_role;
COMMENT ON FUNCTION public.finalize_whatsapp_km_prompt_sent(uuid, text) IS
  'Build 5.7F2E1A.5-MJ1A. Backend-only. Atomic success finalization for Jarvys KM prompt outbound: marks queue+message sent and promotes request to pending. No fallback after invariant.';

-- ============================================================
-- 3) finalize_whatsapp_km_prompt_failed
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_whatsapp_km_prompt_failed(
  p_outbound_queue_id uuid,
  p_terminal_reason   text,
  p_error_message     text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_queue     record;
  v_msg       record;
  v_req       record;
  v_cancel    record;
  v_now       timestamptz;
  v_detail    text;
  v_persist   text;
BEGIN
  IF p_terminal_reason IS NULL OR p_terminal_reason NOT IN (
      'non_retryable_provider_error',
      'max_attempts_reached',
      'timeout_ambiguous',
      'preflight_invalid',
      'instance_not_found'
  ) THEN
    RETURN jsonb_build_object('result','invalid_terminal_reason');
  END IF;

  SELECT id, user_id, contact_id, vehicle_id, provider, instance_id,
         source_message_id, status, attempts, max_attempts, error_message
    INTO v_queue
    FROM public.whatsapp_outbound_queue
    WHERE id = p_outbound_queue_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','queue_not_found');
  END IF;

  IF v_queue.source_message_id IS NULL THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  SELECT id, direction, message_type, status, contact_id, user_id, vehicle_id
    INTO v_msg
    FROM public.whatsapp_messages
    WHERE id = v_queue.source_message_id;
  IF NOT FOUND
     OR v_msg.direction <> 'outbound'
     OR v_msg.contact_id IS DISTINCT FROM v_queue.contact_id
     OR v_msg.user_id IS DISTINCT FROM v_queue.user_id
     OR v_msg.vehicle_id IS DISTINCT FROM v_queue.vehicle_id THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  SELECT id, status, contact_id, user_id, vehicle_id, pending_at
    INTO v_req
    FROM public.whatsapp_km_prompt_requests
    WHERE prompt_message_id = v_queue.source_message_id;
  IF NOT FOUND
     OR v_req.contact_id IS DISTINCT FROM v_queue.contact_id
     OR v_req.user_id    IS DISTINCT FROM v_queue.user_id
     OR v_req.vehicle_id IS DISTINCT FROM v_queue.vehicle_id THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  -- Success winner blocks terminal
  IF v_queue.status = 'sent' THEN
    RETURN jsonb_build_object('result','terminal_after_success_invariant');
  END IF;

  -- Full terminal replay: queue+message failed + request cancelled
  IF v_queue.status = 'failed' AND v_msg.status = 'failed' AND v_req.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'result','terminal_replayed',
      'prompt_request_id', v_req.id,
      'terminal_reason', p_terminal_reason
    );
  END IF;

  -- Repair: queue+message failed but request still queued
  IF v_queue.status = 'failed' AND v_msg.status = 'failed' AND v_req.status = 'queued' THEN
    SELECT * INTO v_cancel
      FROM public.cancel_whatsapp_km_prompt_request(v_msg.id);
    IF v_cancel.result NOT IN ('cancelled','already_terminal') THEN
      RAISE EXCEPTION 'km_prompt_cancel_failed_%', v_cancel.result
        USING ERRCODE = 'raise_exception';
    END IF;
    RETURN jsonb_build_object(
      'result','terminal_replayed',
      'prompt_request_id', v_req.id,
      'terminal_reason', p_terminal_reason,
      'repaired', true
    );
  END IF;

  -- Inconsistent partial states
  IF v_queue.status = 'failed' THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  -- Not sent yet, not failed yet: must be sending (or queued for preflight)
  IF v_queue.status NOT IN ('sending','queued') THEN
    RETURN jsonb_build_object('result','queue_state_invalid');
  END IF;
  IF v_msg.status <> 'queued' THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  -- If request already progressed past queued → do not regress; do not mark queue/message failed
  IF v_req.status IN ('pending','reserved','consumed','expired') THEN
    RETURN jsonb_build_object(
      'result','terminal_after_prompt_progress_invariant',
      'prompt_request_id', v_req.id
    );
  END IF;
  IF v_req.status = 'cancelled' THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;
  IF v_req.status <> 'queued' THEN
    RETURN jsonb_build_object('result','km_prompt_invariant_violation');
  END IF;

  -- Reason-specific revalidation
  IF p_terminal_reason = 'max_attempts_reached' THEN
    IF v_queue.attempts < v_queue.max_attempts THEN
      RETURN jsonb_build_object('result','max_attempts_not_reached');
    END IF;
  END IF;

  -- Sanitize detail
  v_detail := NULL;
  IF p_error_message IS NOT NULL THEN
    v_detail := regexp_replace(p_error_message, '[[:cntrl:]]', ' ', 'g');
    v_detail := btrim(v_detail);
    IF v_detail = '' THEN v_detail := NULL; END IF;
    IF v_detail IS NOT NULL AND char_length(v_detail) > 200 THEN
      v_detail := substring(v_detail from 1 for 200);
    END IF;
  END IF;
  IF v_detail IS NULL THEN
    v_persist := p_terminal_reason;
  ELSE
    v_persist := p_terminal_reason || ': ' || v_detail;
    IF char_length(v_persist) > 200 THEN
      v_persist := substring(v_persist from 1 for 200);
    END IF;
  END IF;

  v_now := now();

  UPDATE public.whatsapp_outbound_queue
    SET status = 'failed', error_message = v_persist
    WHERE id = v_queue.id;

  UPDATE public.whatsapp_messages
    SET status = 'failed', updated_at = v_now
    WHERE id = v_msg.id;

  SELECT * INTO v_cancel
    FROM public.cancel_whatsapp_km_prompt_request(v_msg.id);
  IF v_cancel.result NOT IN ('cancelled','already_terminal') THEN
    RAISE EXCEPTION 'km_prompt_cancel_failed_%', v_cancel.result
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN jsonb_build_object(
    'result','finalized',
    'prompt_request_id', v_req.id,
    'prompt_message_id', v_msg.id,
    'outbound_queue_id', v_queue.id,
    'terminal_reason', p_terminal_reason
  );
END;
$function$;

ALTER FUNCTION public.finalize_whatsapp_km_prompt_failed(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_km_prompt_failed(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_km_prompt_failed(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_whatsapp_km_prompt_failed(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_whatsapp_km_prompt_failed(uuid, text, text) TO service_role;
COMMENT ON FUNCTION public.finalize_whatsapp_km_prompt_failed(uuid, text, text) IS
  'Build 5.7F2E1A.5-MJ1A. Backend-only. Atomic terminal-failure finalization for Jarvys KM prompt outbound: marks queue+message failed and cancels request when still queued. Never regresses pending/reserved/consumed/expired.';
