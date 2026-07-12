-- ============================================================
-- BUILD 5.7F2D0 — VALIDAÇÃO FUNCIONAL TRANSACIONAL DAS RPCs
--   claim_whatsapp_orchestrator_items
--   release_whatsapp_orchestrator_item
--   apply_whatsapp_orchestrator_transition
-- Isolamento: BEGIN ... ROLLBACK. Nada é comitado.
-- Fixtures sintéticas: profiles/contacts (que exigem auth.users)
-- não são criados; tais casos ficam BLOCKED_NO_SYNTHETIC_USER.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = notice;
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
  v_pass       int := 0;
  v_fail       int := 0;
  v_blocked    int := 0;
  v_res        jsonb;
  v_msg        uuid;
  v_qid        uuid;
  v_lease      uuid := gen_random_uuid();
  v_bogus      uuid := gen_random_uuid();
  v_instance   uuid;

  c_result     jsonb := '{"decisionKind":"no_op","eventKind":"unknown","outcome":"none"}'::jsonb;
  c_patch      jsonb := '{"next_state":"idle"}'::jsonb;
  c_ver        text  := 'v1';
BEGIN
  RAISE NOTICE '========== BUILD 5.7F2D0 START ==========';

  -- ==========================================================
  -- SEÇÃO 1 — RELEASE: validação de parâmetros (sem fixture)
  -- ==========================================================

  BEGIN
    PERFORM release_whatsapp_orchestrator_item(NULL, v_lease, 'x', 'cancelled', 5);
    v_fail := v_fail + 1; RAISE NOTICE 'R01 FAIL sem exceção';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='INVALID_QUEUE_ITEM_ID' THEN v_pass:=v_pass+1; RAISE NOTICE 'R01 PASS';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R01 FAIL: %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus, NULL, 'x', 'cancelled', 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='INVALID_LEASE_TOKEN' THEN v_pass:=v_pass+1; RAISE NOTICE 'R02 PASS';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R02 FAIL: %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus, v_lease, '', 'cancelled', 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='INVALID_REASON' THEN v_pass:=v_pass+1; RAISE NOTICE 'R03 PASS';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R03 FAIL: %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus, v_lease, 'BAD REASON!', 'cancelled', 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='INVALID_REASON' THEN v_pass:=v_pass+1; RAISE NOTICE 'R04 PASS';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R04 FAIL: %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus, v_lease, 'ok', 'bogus_kind', 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='INVALID_RETRY_KIND' THEN v_pass:=v_pass+1; RAISE NOTICE 'R05 PASS';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R05 FAIL: %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus, v_lease, 'ok', 'cancelled', 5000);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='INVALID_DELAY_SECONDS' THEN v_pass:=v_pass+1; RAISE NOTICE 'R06 PASS';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R06 FAIL: %', SQLERRM; END IF;
  END;

  v_res := release_whatsapp_orchestrator_item(v_bogus, v_lease, 'x', 'cancelled', 5);
  IF v_res->>'ok'='false' AND v_res->>'reason'='queue_item_not_found' THEN
    v_pass:=v_pass+1; RAISE NOTICE 'R07 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'R07 FAIL: %', v_res; END IF;

  -- ==========================================================
  -- SEÇÃO 2 — RELEASE: fixtures (queue + message, contact NULL)
  -- Cada queue precisa de message distinta (wpq_message_unique).
  -- ==========================================================

  -- R08: queue queued (não running) → lease_lost
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(),'zapi','inbound','text','received') RETURNING id INTO v_msg;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status)
    VALUES (gen_random_uuid(), v_msg, 'jarvys', 'queued') RETURNING id INTO v_qid;
  v_res := release_whatsapp_orchestrator_item(v_qid, v_lease, 'ok', 'cancelled', 5);
  IF v_res->>'reason'='lease_lost' THEN v_pass:=v_pass+1; RAISE NOTICE 'R08 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'R08 FAIL: %', v_res; END IF;

  -- R09: running com lease_token errado → lease_lost
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(),'zapi','inbound','text','received') RETURNING id INTO v_msg;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg, 'jarvys','running',
      gen_random_uuid(), now()+interval '5 min', now(), 'w1', 0, 5) RETURNING id INTO v_qid;
  v_res := release_whatsapp_orchestrator_item(v_qid, v_lease, 'ok', 'cancelled', 5);
  IF v_res->>'reason'='lease_lost' THEN v_pass:=v_pass+1; RAISE NOTICE 'R09 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'R09 FAIL: %', v_res; END IF;

  -- R10: transient_error, attempts<max → queued+willRetry
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(),'zapi','inbound','text','received') RETURNING id INTO v_msg;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg, 'jarvys','running',
      v_lease, now()+interval '5 min', now(), 'w1', 1, 5) RETURNING id INTO v_qid;
  v_res := release_whatsapp_orchestrator_item(v_qid, v_lease, 'transient','transient_error', 30);
  IF v_res->>'ok'='true' AND v_res->>'status'='queued' AND (v_res->>'willRetry')='true'
     AND (v_res->>'attempts')::int=2 THEN
    v_pass:=v_pass+1; RAISE NOTICE 'R10 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'R10 FAIL: %', v_res; END IF;

  -- R11: transient_error, attempts=max-1 → failed
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(),'zapi','inbound','text','received') RETURNING id INTO v_msg;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg, 'jarvys','running',
      v_lease, now()+interval '5 min', now(), 'w1', 4, 5) RETURNING id INTO v_qid;
  v_res := release_whatsapp_orchestrator_item(v_qid, v_lease, 'boom','transient_error', 30);
  IF v_res->>'ok'='true' AND v_res->>'status'='failed' AND (v_res->>'willRetry')='false' THEN
    v_pass:=v_pass+1; RAISE NOTICE 'R11 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'R11 FAIL: %', v_res; END IF;

  -- R12: state_conflict → queued sem incremento
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(),'zapi','inbound','text','received') RETURNING id INTO v_msg;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg, 'jarvys','running',
      v_lease, now()+interval '5 min', now(), 'w1', 2, 5) RETURNING id INTO v_qid;
  v_res := release_whatsapp_orchestrator_item(v_qid, v_lease, 'conflict','state_conflict', 15);
  IF v_res->>'ok'='true' AND v_res->>'status'='queued' AND (v_res->>'attempts')::int=2 THEN
    v_pass:=v_pass+1; RAISE NOTICE 'R12 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'R12 FAIL: %', v_res; END IF;

  -- R13: retry_kind=cancelled → cancelled
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(),'zapi','inbound','text','received') RETURNING id INTO v_msg;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg, 'jarvys','running',
      v_lease, now()+interval '5 min', now(), 'w1', 0, 5) RETURNING id INTO v_qid;
  v_res := release_whatsapp_orchestrator_item(v_qid, v_lease, 'canc','cancelled', 5);
  IF v_res->>'ok'='true' AND v_res->>'status'='cancelled' THEN
    v_pass:=v_pass+1; RAISE NOTICE 'R13 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'R13 FAIL: %', v_res; END IF;

  -- R14: status=done sem orch fields → already_terminal
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(),'zapi','inbound','text','received') RETURNING id INTO v_msg;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status, finished_at)
    VALUES (gen_random_uuid(), v_msg, 'jarvys','done', now()) RETURNING id INTO v_qid;
  v_res := release_whatsapp_orchestrator_item(v_qid, v_lease, 'x','cancelled', 5);
  IF v_res->>'reason'='already_terminal' THEN v_pass:=v_pass+1; RAISE NOTICE 'R14 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'R14 FAIL: %', v_res; END IF;

  -- R15: durable replay (done + todos orch preenchidos)
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(),'zapi','inbound','text','received') RETURNING id INTO v_msg;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status, finished_at,
      orchestrator_processed_at, orchestrator_result, orchestrator_version)
    VALUES (gen_random_uuid(), v_msg, 'jarvys','done', now(),
      now(), '{"decisionId":"abc"}'::jsonb, 'v1') RETURNING id INTO v_qid;
  v_res := release_whatsapp_orchestrator_item(v_qid, v_lease, 'x','cancelled', 5);
  IF v_res->>'ok'='true' AND (v_res->>'wasReplay')='true' THEN
    v_pass:=v_pass+1; RAISE NOTICE 'R15 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'R15 FAIL: %', v_res; END IF;

  -- ==========================================================
  -- SEÇÃO 3 — APPLY: validação de payload (sem fixture)
  -- assinatura: (qid, lease, expected_state_version bigint,
  --              patch jsonb, orch_version text, result jsonb, response jsonb)
  -- ==========================================================

  -- A01: expected_state_version negativo → invariant_violation
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, (-1)::bigint, c_patch, c_ver, c_result, NULL);
  IF v_res->>'reason'='invariant_violation' THEN v_pass:=v_pass+1; RAISE NOTICE 'A01 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A01 FAIL: %', v_res; END IF;

  -- A02: orchestrator_version com char inválido → invariant_violation
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint, c_patch, 'BAD VER!', c_result, NULL);
  IF v_res->>'reason'='invariant_violation' THEN v_pass:=v_pass+1; RAISE NOTICE 'A02 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A02 FAIL: %', v_res; END IF;

  -- A03: result_summary non-object → result_summary_invalid
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint, c_patch, c_ver, '[]'::jsonb, NULL);
  IF v_res->>'reason'='result_summary_invalid' THEN v_pass:=v_pass+1; RAISE NOTICE 'A03 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A03 FAIL: %', v_res; END IF;

  -- A04: result_summary chave desconhecida
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint, c_patch, c_ver, '{"unknownKey":"x"}'::jsonb, NULL);
  IF v_res->>'reason'='result_summary_invalid' THEN v_pass:=v_pass+1; RAISE NOTICE 'A04 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A04 FAIL: %', v_res; END IF;

  -- A05: result_summary com decisionKind fora do enum
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint, c_patch, c_ver,
    '{"decisionKind":"nope","eventKind":"unknown","outcome":"none"}'::jsonb, NULL);
  IF v_res->>'reason'='result_summary_invalid' THEN v_pass:=v_pass+1; RAISE NOTICE 'A05 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A05 FAIL: %', v_res; END IF;

  -- A06: patch non-object → patch_invalid_value
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint, '"nope"'::jsonb, c_ver, c_result, NULL);
  IF v_res->>'reason'='patch_invalid_value' THEN v_pass:=v_pass+1; RAISE NOTICE 'A06 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A06 FAIL: %', v_res; END IF;

  -- A07: patch chave desconhecida → patch_invalid_key
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint,
    '{"next_state":"idle","evil_key":1}'::jsonb, c_ver, c_result, NULL);
  IF v_res->>'reason'='patch_invalid_key' THEN v_pass:=v_pass+1; RAISE NOTICE 'A07 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A07 FAIL: %', v_res; END IF;

  -- A08: patch sem next_state → patch_invalid_value
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint, '{}'::jsonb, c_ver, c_result, NULL);
  IF v_res->>'reason'='patch_invalid_value' THEN v_pass:=v_pass+1; RAISE NOTICE 'A08 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A08 FAIL: %', v_res; END IF;

  -- A09: next_state fora do enum → patch_invalid_value
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint,
    '{"next_state":"nope_state"}'::jsonb, c_ver, c_result, NULL);
  IF v_res->>'reason'='patch_invalid_value' THEN v_pass:=v_pass+1; RAISE NOTICE 'A09 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A09 FAIL: %', v_res; END IF;

  -- A10: active_vehicle_id tipo errado → patch_invalid_value
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint,
    '{"next_state":"idle","active_vehicle_id":42}'::jsonb, c_ver, c_result, NULL);
  IF v_res->>'reason'='patch_invalid_value' THEN v_pass:=v_pass+1; RAISE NOTICE 'A10 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A10 FAIL: %', v_res; END IF;

  -- A11: response não-object → response_invalid
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint, c_patch, c_ver, c_result, '"nope"'::jsonb);
  IF v_res->>'reason'='response_invalid' THEN v_pass:=v_pass+1; RAISE NOTICE 'A11 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A11 FAIL: %', v_res; END IF;

  -- A12: response text_body só espaços → response_invalid
  v_res := apply_whatsapp_orchestrator_transition(
    v_bogus, v_lease, 0::bigint, c_patch, c_ver, c_result,
    '{"message_type":"text","purpose":"general","text_body":"   "}'::jsonb);
  IF v_res->>'reason'='response_invalid' THEN v_pass:=v_pass+1; RAISE NOTICE 'A12 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A12 FAIL: %', v_res; END IF;

  -- A13: queue_item_id inexistente → queue_item_not_found
  v_res := apply_whatsapp_orchestrator_transition(
    gen_random_uuid(), v_lease, 0::bigint, c_patch, c_ver, c_result, NULL);
  IF v_res->>'reason'='queue_item_not_found' THEN v_pass:=v_pass+1; RAISE NOTICE 'A13 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A13 FAIL: %', v_res; END IF;

  -- A14: queue com message_id=NULL → source_message_missing
  INSERT INTO whatsapp_processing_queue(id, queue_type, status)
    VALUES (gen_random_uuid(),'jarvys','queued') RETURNING id INTO v_qid;
  v_res := apply_whatsapp_orchestrator_transition(
    v_qid, v_lease, 0::bigint, c_patch, c_ver, c_result, NULL);
  IF v_res->>'reason'='source_message_missing' THEN v_pass:=v_pass+1; RAISE NOTICE 'A14 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A14 FAIL: %', v_res; END IF;

  -- A15: message com contact_id=NULL → contact_missing
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(),'zapi','inbound','text','received') RETURNING id INTO v_msg;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status)
    VALUES (gen_random_uuid(), v_msg, 'jarvys','queued') RETURNING id INTO v_qid;
  v_res := apply_whatsapp_orchestrator_transition(
    v_qid, v_lease, 0::bigint, c_patch, c_ver, c_result, NULL);
  IF v_res->>'reason'='contact_missing' THEN v_pass:=v_pass+1; RAISE NOTICE 'A15 PASS';
  ELSE v_fail:=v_fail+1; RAISE NOTICE 'A15 FAIL: %', v_res; END IF;

  -- ==========================================================
  -- SEÇÃO 4 — CLAIM: validação de parâmetros e fila vazia
  -- ==========================================================

  BEGIN
    PERFORM claim_whatsapp_orchestrator_items('   ', 5, 60);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='INVALID_WORKER_ID' THEN v_pass:=v_pass+1; RAISE NOTICE 'C01 PASS';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C01 FAIL: %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM claim_whatsapp_orchestrator_items('w1', 999, 60);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='INVALID_BATCH' THEN v_pass:=v_pass+1; RAISE NOTICE 'C02 PASS';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C02 FAIL: %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM claim_whatsapp_orchestrator_items('w1', 5, 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM='INVALID_LEASE_SECONDS' THEN v_pass:=v_pass+1; RAISE NOTICE 'C03 PASS';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C03 FAIL: %', SQLERRM; END IF;
  END;

  -- C04: chamada válida (fila da instância isolada é vazia)
  INSERT INTO whatsapp_provider_instances(id, provider, instance_id, status, orchestrator_mode)
    VALUES (gen_random_uuid(),'zapi', 'test-inst-'||gen_random_uuid()::text, 'active','test')
    RETURNING id INTO v_instance;
  PERFORM claim_whatsapp_orchestrator_items('w-5-7-f2d0', 5, 60);
  v_pass := v_pass + 1; RAISE NOTICE 'C04 PASS (claim válido retorna sem erro)';

  -- ==========================================================
  -- SEÇÃO 5 — BLOQUEADOS (dependem de auth.users)
  -- ==========================================================
  v_blocked := 20;
  RAISE NOTICE 'BLOCKED_NO_SYNTHETIC_USER: happy-path apply,';
  RAISE NOTICE '  CAS state_version, contact_not_verified/unlinked,';
  RAISE NOTICE '  message_direction_invalid, message_type_unsupported,';
  RAISE NOTICE '  instance_not_found, orchestrator_not_active,';
  RAISE NOTICE '  lease_lost em apply, message_mismatch, vehicle_invalid,';
  RAISE NOTICE '  draft_transition_invalid, idempotência, concorrência (Modelo B).';

  -- ==========================================================
  -- RELATÓRIO
  -- ==========================================================
  RAISE NOTICE '========== RESUMO ==========';
  RAISE NOTICE 'PASS=%  FAIL=%  BLOCKED=%', v_pass, v_fail, v_blocked;
  IF v_fail > 0 THEN
    RAISE EXCEPTION '5.7F2D0 FAIL: % asserção(ões) falharam', v_fail;
  END IF;
END
$test$;

ROLLBACK;
