-- ============================================================
-- BUILD 5.7F2E1A.5-MJ1A — TESTES SQL FUNCIONAIS DAS RPCs (jsonb)
--   enqueue_whatsapp_km_prompt          (jsonb)
--   finalize_whatsapp_km_prompt_sent    (jsonb)
--   finalize_whatsapp_km_prompt_failed  (jsonb)
-- Isolamento: BEGIN ... ROLLBACK. Nada é comitado.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = notice;
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
  v_pass       int := 0;
  v_fail       int := 0;

  v_user       uuid;
  v_contact    uuid := gen_random_uuid();
  v_vehicle    uuid := gen_random_uuid();
  v_archived   uuid := gen_random_uuid();

  v_instance_pk uuid;
  v_instance_id text;

  v_idem1      text := 'test-idem-' || gen_random_uuid()::text;
  v_idem2      text := 'test-idem-' || gen_random_uuid()::text;

  v_res        jsonb;
  v_row        record;

  v_queue_ok   uuid;
  v_msg_ok     uuid;
  v_req_ok     uuid;

  v_pmid       text := 'PMID-' || substr(md5(random()::text), 1, 12);
BEGIN
  RAISE NOTICE '========== MJ1A SQL TESTS START ==========';

  SELECT id INTO v_user FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'BLOCKED_NO_PROFILE_FIXTURE'; END IF;

  SELECT id, instance_id INTO v_instance_pk, v_instance_id
    FROM public.whatsapp_provider_instances
   WHERE provider = 'zapi' AND status = 'active'
   ORDER BY created_at LIMIT 1;
  IF v_instance_id IS NULL THEN RAISE EXCEPTION 'BLOCKED_NO_INSTANCE_FIXTURE'; END IF;

  INSERT INTO public.veiculos(id, user_id, placa, status)
       VALUES (v_vehicle,   v_user, 'MJ1A01', 'ativo'),
              (v_archived,  v_user, 'MJ1A02', 'archived');

  INSERT INTO public.whatsapp_contacts(id, user_id, phone_e164, assigned_provider,
                                       assigned_instance_id, assigned_whatsapp_number,
                                       verified_at, opt_in, opt_out)
       VALUES (v_contact, v_user, '+5511900000001', 'zapi', v_instance_id,
               '+551150000000', now(), true, false);

  -- ================== ENQUEUE ==================

  -- E01: created
  v_res := public.enqueue_whatsapp_km_prompt(
    v_idem1, v_contact, v_vehicle, 'Olá! Qual a quilometragem atual?');
  IF v_res->>'result' = 'created'
       AND v_res ? 'prompt_request_id'
       AND v_res ? 'prompt_message_id'
       AND v_res ? 'outbound_queue_id'
    THEN
      v_pass:=v_pass+1; RAISE NOTICE 'E01 PASS created';
      v_queue_ok := (v_res->>'outbound_queue_id')::uuid;
      v_msg_ok   := (v_res->>'prompt_message_id')::uuid;
      v_req_ok   := (v_res->>'prompt_request_id')::uuid;
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E01 FAIL %', v_res; END IF;

  -- E02: replayed (mesma key + mesmo contexto)
  v_res := public.enqueue_whatsapp_km_prompt(
    v_idem1, v_contact, v_vehicle, 'Olá! Qual a quilometragem atual?');
  IF v_res->>'result' = 'replayed'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E02 PASS replayed';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E02 FAIL %', v_res; END IF;

  -- E03: idempotency_context_mismatch
  v_res := public.enqueue_whatsapp_km_prompt(
    v_idem1, v_contact, v_archived, 'Olá!');
  IF v_res->>'result' = 'idempotency_context_mismatch'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E03 PASS %', v_res->>'result';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E03 FAIL %', v_res; END IF;

  -- E04: vehicle_archived
  v_res := public.enqueue_whatsapp_km_prompt(
    v_idem2, v_contact, v_archived, 'Olá!');
  IF v_res->>'result' = 'vehicle_archived'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E04 PASS %', v_res->>'result';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E04 FAIL %', v_res; END IF;

  -- E05: invalid_text
  v_res := public.enqueue_whatsapp_km_prompt(
    'test-idem-bad-' || gen_random_uuid()::text, v_contact, v_vehicle, '   ');
  IF v_res->>'result' = 'invalid_text'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E05 PASS %', v_res->>'result';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E05 FAIL %', v_res; END IF;

  -- E06: invalid_idempotency_key
  v_res := public.enqueue_whatsapp_km_prompt(
    '', v_contact, v_vehicle, 'Olá!');
  IF v_res->>'result' = 'invalid_idempotency_key'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E06 PASS %', v_res->>'result';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E06 FAIL %', v_res; END IF;

  -- E07: contact_not_found
  v_res := public.enqueue_whatsapp_km_prompt(
    'test-idem-nc-' || gen_random_uuid()::text,
    gen_random_uuid(), v_vehicle, 'Olá!');
  IF v_res->>'result' = 'contact_not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E07 PASS %', v_res->>'result';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E07 FAIL %', v_res; END IF;

  -- E08: vehicle_not_found
  v_res := public.enqueue_whatsapp_km_prompt(
    'test-idem-nv-' || gen_random_uuid()::text,
    v_contact, gen_random_uuid(), 'Olá!');
  IF v_res->>'result' = 'vehicle_not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E08 PASS %', v_res->>'result';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E08 FAIL %', v_res; END IF;

  -- E09: invariantes do row criado
  SELECT status, pending_at, expires_at, reserved_at, consumed_at,
         cancelled_at, expired_at, contact_id, user_id, vehicle_id
    INTO v_row
    FROM public.whatsapp_km_prompt_requests
   WHERE id = v_req_ok;
  IF v_row.status = 'queued'
       AND v_row.pending_at IS NULL
       AND v_row.expires_at IS NULL
       AND v_row.reserved_at IS NULL
       AND v_row.consumed_at IS NULL
       AND v_row.cancelled_at IS NULL
       AND v_row.expired_at  IS NULL
       AND v_row.contact_id  = v_contact
       AND v_row.user_id     = v_user
       AND v_row.vehicle_id  = v_vehicle
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E09 PASS queued invariants';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E09 FAIL row=%', v_row; END IF;

  -- ================== FINALIZE_SENT ==================

  v_res := public.enqueue_whatsapp_km_prompt(
    'test-idem-fs-' || gen_random_uuid()::text,
    v_contact, v_vehicle, 'Prompt para finalize sent.');
  IF v_res->>'result' <> 'created' THEN
    v_fail:=v_fail+1; RAISE NOTICE 'FS_SETUP FAIL %', v_res;
  ELSE
    v_queue_ok := (v_res->>'outbound_queue_id')::uuid;
    v_msg_ok   := (v_res->>'prompt_message_id')::uuid;
    v_req_ok   := (v_res->>'prompt_request_id')::uuid;

    -- FS01: queue_state_invalid (queued, não sending)
    v_res := public.finalize_whatsapp_km_prompt_sent(v_queue_ok, v_pmid);
    IF v_res->>'result' = 'queue_state_invalid'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FS01 PASS queue_state_invalid';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FS01 FAIL %', v_res; END IF;

    -- Transição para sending
    UPDATE public.whatsapp_outbound_queue SET status='sending' WHERE id=v_queue_ok;

    -- FS02: invalid_provider_message_id
    v_res := public.finalize_whatsapp_km_prompt_sent(v_queue_ok, '');
    IF v_res->>'result' = 'invalid_provider_message_id'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FS02 PASS invalid_provider_message_id';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FS02 FAIL %', v_res; END IF;

    -- FS03: queue_not_found
    v_res := public.finalize_whatsapp_km_prompt_sent(gen_random_uuid(), v_pmid);
    IF v_res->>'result' = 'queue_not_found'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FS03 PASS queue_not_found';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FS03 FAIL %', v_res; END IF;

    -- FS04: finalized (happy path)
    v_res := public.finalize_whatsapp_km_prompt_sent(v_queue_ok, v_pmid);
    IF v_res->>'result' = 'finalized'
         AND (v_res->>'prompt_request_id')::uuid = v_req_ok
         AND (v_res->>'prompt_message_id')::uuid = v_msg_ok
         AND (v_res->>'outbound_queue_id')::uuid = v_queue_ok
         AND v_res->>'pending_at' IS NOT NULL
         AND v_res->>'expires_at' IS NOT NULL
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FS04 PASS finalized';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FS04 FAIL %', v_res; END IF;

    -- FS05: replayed
    v_res := public.finalize_whatsapp_km_prompt_sent(v_queue_ok, v_pmid);
    IF v_res->>'result' = 'replayed'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FS05 PASS replayed';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FS05 FAIL %', v_res; END IF;

    -- FS06: provider_message_id_mismatch
    v_res := public.finalize_whatsapp_km_prompt_sent(v_queue_ok, v_pmid || '-X');
    IF v_res->>'result' = 'provider_message_id_mismatch'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FS06 PASS provider_message_id_mismatch';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FS06 FAIL %', v_res; END IF;

    -- FS07: request pending invariants
    SELECT status, pending_at, expires_at
      INTO v_row
      FROM public.whatsapp_km_prompt_requests
     WHERE id = v_req_ok;
    IF v_row.status = 'pending'
         AND v_row.pending_at IS NOT NULL
         AND v_row.expires_at IS NOT NULL
         AND v_row.expires_at > v_row.pending_at
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FS07 PASS pending invariants';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FS07 FAIL row=%', v_row; END IF;
  END IF;

  -- ================== FINALIZE_FAILED ==================

  v_res := public.enqueue_whatsapp_km_prompt(
    'test-idem-ff-' || gen_random_uuid()::text,
    v_contact, v_vehicle, 'Prompt para finalize failed.');
  IF v_res->>'result' <> 'created' THEN
    v_fail:=v_fail+1; RAISE NOTICE 'FF_SETUP FAIL %', v_res;
  ELSE
    v_queue_ok := (v_res->>'outbound_queue_id')::uuid;
    v_req_ok   := (v_res->>'prompt_request_id')::uuid;

    UPDATE public.whatsapp_outbound_queue
       SET status='sending', attempts=max_attempts
     WHERE id=v_queue_ok;

    -- FF01: invalid_terminal_reason
    v_res := public.finalize_whatsapp_km_prompt_failed(
      v_queue_ok, 'bogus_reason', 'x');
    IF v_res->>'result' = 'invalid_terminal_reason'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FF01 PASS invalid_terminal_reason';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FF01 FAIL %', v_res; END IF;

    -- FF02: queue_not_found
    v_res := public.finalize_whatsapp_km_prompt_failed(
      gen_random_uuid(), 'non_retryable_provider_error', 'x');
    IF v_res->>'result' = 'queue_not_found'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FF02 PASS queue_not_found';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FF02 FAIL %', v_res; END IF;

    -- FF03: finalized
    v_res := public.finalize_whatsapp_km_prompt_failed(
      v_queue_ok, 'max_attempts_reached', 'exceeded');
    IF v_res->>'result' = 'finalized'
         AND v_res->>'terminal_reason' = 'max_attempts_reached'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FF03 PASS finalized';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FF03 FAIL %', v_res; END IF;

    -- FF04: terminal_replayed
    v_res := public.finalize_whatsapp_km_prompt_failed(
      v_queue_ok, 'max_attempts_reached', 'again');
    IF v_res->>'result' = 'terminal_replayed'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FF04 PASS terminal_replayed';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FF04 FAIL %', v_res; END IF;

    -- FF05: request cancelled invariants
    SELECT status, cancelled_at, pending_at
      INTO v_row
      FROM public.whatsapp_km_prompt_requests
     WHERE id = v_req_ok;
    IF v_row.status = 'cancelled'
         AND v_row.cancelled_at IS NOT NULL
         AND v_row.pending_at IS NULL
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FF05 PASS cancelled invariants';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FF05 FAIL row=%', v_row; END IF;
  END IF;

  -- ================== max_attempts_not_reached ==================

  v_res := public.enqueue_whatsapp_km_prompt(
    'test-idem-mn-' || gen_random_uuid()::text,
    v_contact, v_vehicle, 'Prompt attempts guard.');
  IF v_res->>'result' = 'created' THEN
    v_queue_ok := (v_res->>'outbound_queue_id')::uuid;
    UPDATE public.whatsapp_outbound_queue
       SET status='sending', attempts=0, max_attempts=5
     WHERE id=v_queue_ok;

    v_res := public.finalize_whatsapp_km_prompt_failed(
      v_queue_ok, 'max_attempts_reached', 'nope');
    IF v_res->>'result' = 'max_attempts_not_reached'
      THEN v_pass:=v_pass+1; RAISE NOTICE 'FF06 PASS max_attempts_not_reached';
      ELSE v_fail:=v_fail+1; RAISE NOTICE 'FF06 FAIL %', v_res; END IF;
  ELSE
    v_fail:=v_fail+1; RAISE NOTICE 'FF06 SETUP FAIL %', v_res;
  END IF;

  RAISE NOTICE '========== MJ1A SQL TESTS END: pass=% fail=% ==========', v_pass, v_fail;

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'MJ1A_SQL_TESTS_HAVE_FAILURES pass=% fail=%', v_pass, v_fail;
  END IF;
END
$test$;

ROLLBACK;
