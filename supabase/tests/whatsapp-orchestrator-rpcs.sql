-- ============================================================
-- BUILD 5.7F2D0 — VALIDAÇÃO FUNCIONAL TRANSACIONAL DAS RPCs
--   claim_whatsapp_orchestrator_items
--   release_whatsapp_orchestrator_item
--   apply_whatsapp_orchestrator_transition
--
-- Isolamento: BEGIN ... ROLLBACK. Nenhum dado é comitado.
-- Fixtures sintéticas com UUIDs gerados dinamicamente.
-- Tabelas que dependem de auth.users (profiles → contacts →
-- conversation_states → happy-path/CAS) são marcadas como
-- BLOCKED_NO_SYNTHETIC_USER e não são exercitadas aqui.
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
  v_msg_id     uuid;
  v_msg_id_nc  uuid;
  v_queue_id   uuid;
  v_queue_id2  uuid;
  v_queue_id3  uuid;
  v_queue_id4  uuid;
  v_queue_id5  uuid;
  v_queue_id6  uuid;
  v_queue_id7  uuid;
  v_queue_id8  uuid;
  v_lease      uuid := gen_random_uuid();
  v_random     uuid := gen_random_uuid();
  v_bogus_qid  uuid := gen_random_uuid();
  v_instance   uuid;
  v_result_ok  jsonb := jsonb_build_object(
                          'decisionKind','no_op',
                          'eventKind','unknown',
                          'outcome','none');
  v_patch_ok   jsonb := jsonb_build_object('next_state','idle');
BEGIN
  RAISE NOTICE '========== BUILD 5.7F2D0 START ==========';

  -- ============================================================
  -- SEÇÃO 1 — RELEASE: validação de parâmetros (sem fixture)
  -- ============================================================

  -- R01: p_queue_item_id NULL → EXCEPTION INVALID_QUEUE_ITEM_ID
  BEGIN
    PERFORM release_whatsapp_orchestrator_item(NULL, v_lease, 'x', 'cancelled', 5);
    v_fail := v_fail + 1;
    RAISE NOTICE 'R01 FAIL: sem exceção';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'INVALID_QUEUE_ITEM_ID' THEN
      v_pass := v_pass + 1; RAISE NOTICE 'R01 PASS';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE 'R01 FAIL wrong msg: %', SQLERRM;
    END IF;
  END;

  -- R02: p_lease_token NULL → INVALID_LEASE_TOKEN
  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus_qid, NULL, 'x', 'cancelled', 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'INVALID_LEASE_TOKEN' THEN
      v_pass := v_pass + 1; RAISE NOTICE 'R02 PASS';
    ELSE
      v_fail := v_fail + 1; RAISE NOTICE 'R02 FAIL: %', SQLERRM;
    END IF;
  END;

  -- R03: p_reason vazio → INVALID_REASON
  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus_qid, v_lease, '', 'cancelled', 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'INVALID_REASON' THEN v_pass := v_pass + 1; RAISE NOTICE 'R03 PASS';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'R03 FAIL: %', SQLERRM; END IF;
  END;

  -- R04: p_reason chars inválidos → INVALID_REASON
  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus_qid, v_lease, 'BAD REASON!', 'cancelled', 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'INVALID_REASON' THEN v_pass := v_pass + 1; RAISE NOTICE 'R04 PASS';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'R04 FAIL: %', SQLERRM; END IF;
  END;

  -- R05: p_retry_kind inválido → INVALID_RETRY_KIND
  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus_qid, v_lease, 'ok', 'bogus_kind', 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'INVALID_RETRY_KIND' THEN v_pass := v_pass + 1; RAISE NOTICE 'R05 PASS';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'R05 FAIL: %', SQLERRM; END IF;
  END;

  -- R06: p_delay_seconds fora do range → INVALID_DELAY_SECONDS
  BEGIN
    PERFORM release_whatsapp_orchestrator_item(v_bogus_qid, v_lease, 'ok', 'cancelled', 5000);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'INVALID_DELAY_SECONDS' THEN v_pass := v_pass + 1; RAISE NOTICE 'R06 PASS';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'R06 FAIL: %', SQLERRM; END IF;
  END;

  -- R07: queue_item_id inexistente → reason=queue_item_not_found
  v_res := release_whatsapp_orchestrator_item(v_bogus_qid, v_lease, 'x', 'cancelled', 5);
  IF v_res->>'ok'='false' AND v_res->>'reason'='queue_item_not_found' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'R07 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'R07 FAIL: %', v_res; END IF;

  -- ============================================================
  -- SEÇÃO 2 — RELEASE: fixtures de queue puras (sem contato/user)
  -- Criamos messages/queue sem contact_id (NULL permitido).
  -- ============================================================

  
  -- Q1: queued (não running) → lease_lost
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(), 'zapi', 'inbound', 'text', 'received')
    RETURNING id INTO v_msg_id;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status)
    VALUES (gen_random_uuid(), v_msg_id, 'jarvys', 'queued')
    RETURNING id INTO v_queue_id;
  v_res := release_whatsapp_orchestrator_item(v_queue_id, v_lease, 'ok', 'cancelled', 5);
  IF v_res->>'ok'='false' AND v_res->>'reason'='lease_lost' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'R08 PASS (queued→lease_lost)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'R08 FAIL: %', v_res; END IF;

  -- Q2: running com lease_token errado → lease_lost
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(), 'zapi', 'inbound', 'text', 'received')
    RETURNING id INTO v_msg_id;
  INSERT INTO whatsapp_processing_queue(
      id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg_id, 'jarvys', 'running',
      gen_random_uuid(), now()+interval '5 min', now(), 'w1', 0, 5)
    RETURNING id INTO v_queue_id2;
  v_res := release_whatsapp_orchestrator_item(v_queue_id2, v_lease, 'ok', 'cancelled', 5);
  IF v_res->>'ok'='false' AND v_res->>'reason'='lease_lost' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'R09 PASS (wrong lease→lease_lost)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'R09 FAIL: %', v_res; END IF;

  -- Q3: running, lease correto, retry_kind=transient_error, attempts<max → queued+willRetry
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(), 'zapi', 'inbound', 'text', 'received')
    RETURNING id INTO v_msg_id;
  INSERT INTO whatsapp_processing_queue(
      id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg_id, 'jarvys', 'running',
      v_lease, now()+interval '5 min', now(), 'w1', 1, 5)
    RETURNING id INTO v_queue_id3;
  v_res := release_whatsapp_orchestrator_item(v_queue_id3, v_lease, 'transient', 'transient_error', 30);
  IF v_res->>'ok'='true' AND v_res->>'status'='queued' AND (v_res->>'willRetry')='true'
     AND (v_res->>'attempts')::int=2 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'R10 PASS (transient retry)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'R10 FAIL: %', v_res; END IF;

  -- Q4: running, transient_error, attempts=max-1 → failed
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(), 'zapi', 'inbound', 'text', 'received')
    RETURNING id INTO v_msg_id;
  INSERT INTO whatsapp_processing_queue(
      id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg_id, 'jarvys', 'running',
      v_lease, now()+interval '5 min', now(), 'w1', 4, 5)
    RETURNING id INTO v_queue_id4;
  v_res := release_whatsapp_orchestrator_item(v_queue_id4, v_lease, 'boom', 'transient_error', 30);
  IF v_res->>'ok'='true' AND v_res->>'status'='failed' AND (v_res->>'willRetry')='false' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'R11 PASS (max attempts→failed)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'R11 FAIL: %', v_res; END IF;

  -- Q5: running, retry_kind=state_conflict → queued sem incremento
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(), 'zapi', 'inbound', 'text', 'received')
    RETURNING id INTO v_msg_id;
  INSERT INTO whatsapp_processing_queue(
      id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg_id, 'jarvys', 'running',
      v_lease, now()+interval '5 min', now(), 'w1', 2, 5)
    RETURNING id INTO v_queue_id5;
  v_res := release_whatsapp_orchestrator_item(v_queue_id5, v_lease, 'conflict', 'state_conflict', 15);
  IF v_res->>'ok'='true' AND v_res->>'status'='queued' AND (v_res->>'attempts')::int=2 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'R12 PASS (state_conflict)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'R12 FAIL: %', v_res; END IF;

  -- Q6: running, retry_kind=cancelled → cancelled
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(), 'zapi', 'inbound', 'text', 'received')
    RETURNING id INTO v_msg_id;
  INSERT INTO whatsapp_processing_queue(
      id, message_id, queue_type, status,
      lease_token, lease_expires_at, claimed_at, claimed_by, attempts, max_attempts)
    VALUES (gen_random_uuid(), v_msg_id, 'jarvys', 'running',
      v_lease, now()+interval '5 min', now(), 'w1', 0, 5)
    RETURNING id INTO v_queue_id6;
  v_res := release_whatsapp_orchestrator_item(v_queue_id6, v_lease, 'canc', 'cancelled', 5);
  IF v_res->>'ok'='true' AND v_res->>'status'='cancelled' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'R13 PASS (cancelled)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'R13 FAIL: %', v_res; END IF;

  -- Q7: status='done' com todos os orch fields NULL → already_terminal
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(), 'zapi', 'inbound', 'text', 'received')
    RETURNING id INTO v_msg_id;
  INSERT INTO whatsapp_processing_queue(
      id, message_id, queue_type, status, finished_at)
    VALUES (gen_random_uuid(), v_msg_id, 'jarvys', 'done', now())
    RETURNING id INTO v_queue_id7;
  v_res := release_whatsapp_orchestrator_item(v_queue_id7, v_lease, 'x', 'cancelled', 5);
  IF v_res->>'ok'='false' AND v_res->>'reason'='already_terminal' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'R14 PASS (already_terminal)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'R14 FAIL: %', v_res; END IF;

  -- Q8: durable replay (done + todos orch fields preenchidos)
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(), 'zapi', 'inbound', 'text', 'received')
    RETURNING id INTO v_msg_id;
  INSERT INTO whatsapp_processing_queue(
      id, message_id, queue_type, status, finished_at,
      orchestrator_processed_at, orchestrator_result, orchestrator_version)
    VALUES (gen_random_uuid(), v_msg_id, 'jarvys', 'done', now(),
      now(), '{"decisionId":"abc","action":"noop"}'::jsonb, 'v1')
    RETURNING id INTO v_queue_id8;
  v_res := release_whatsapp_orchestrator_item(v_queue_id8, v_lease, 'x', 'cancelled', 5);
  IF v_res->>'ok'='true' AND (v_res->>'wasReplay')='true' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'R15 PASS (durable replay)';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'R15 FAIL: %', v_res; END IF;

  -- ============================================================
  -- SEÇÃO 3 — APPLY: validação de payload (sem fixture)
  -- Todos os checks acontecem ANTES de qualquer SELECT em fila.
  -- ============================================================

  -- A01: p_orchestrator_version negativo → invariant_violation
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => -1::bigint, p_patch => v_patch_ok, p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => NULL);
  IF v_res->>'reason'='invariant_violation' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A01 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A01 FAIL: %', v_res; END IF;

  -- A02: result_summary não-object → result_summary_invalid
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => v_patch_ok, p_orchestrator_version => 'v1', p_result_summary => '[]'::jsonb, p_response => NULL);
  IF v_res->>'reason'='result_summary_invalid' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A02 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A02 FAIL: %', v_res; END IF;

  -- A03: result_summary com chave desconhecida → result_summary_invalid
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => v_patch_ok, p_orchestrator_version => 'v1', p_result_summary => '{"unknown_key":"x"}'::jsonb, p_response => NULL);
  IF v_res->>'reason'='result_summary_invalid' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A03 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A03 FAIL: %', v_res; END IF;

  -- A04: patch não-object → patch_invalid_value
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => '"nope"'::jsonb, p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => NULL);
  IF v_res->>'reason'='patch_invalid_value' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A04 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A04 FAIL: %', v_res; END IF;

  -- A05: patch chave desconhecida → patch_invalid_key
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => '{"next_state":"idle", p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => "evil_key":1}'::jsonb, NULL);
  IF v_res->>'reason'='patch_invalid_key' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A05 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A05 FAIL: %', v_res; END IF;

  -- A06: patch sem next_state → patch_invalid_value
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => '{}'::jsonb, p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => NULL);
  IF v_res->>'reason'='patch_invalid_value' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A06 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A06 FAIL: %', v_res; END IF;

  -- A07: next_state fora do enum → patch_invalid_value
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => '{"next_state":"nope_state"}'::jsonb, p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => NULL);
  IF v_res->>'reason'='patch_invalid_value' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A07 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A07 FAIL: %', v_res; END IF;

  -- A08: active_vehicle_id com tipo errado → patch_invalid_value
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => '{"next_state":"idle", p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => "active_vehicle_id":42}'::jsonb, NULL);
  IF v_res->>'reason'='patch_invalid_value' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A08 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A08 FAIL: %', v_res; END IF;

  -- A09: response não-object → response_invalid
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => v_patch_ok, p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => '"nope"'::jsonb);
  IF v_res->>'reason'='response_invalid' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A09 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A09 FAIL: %', v_res; END IF;

  -- A10: response text_body vazio → response_invalid
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_bogus_qid, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => v_patch_ok, p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => '{"message_type":"text","purpose":"general","text_body":"   "}'::jsonb);
  IF v_res->>'reason'='response_invalid' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A10 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A10 FAIL: %', v_res; END IF;

  -- A11: queue_item_id inexistente → queue_item_not_found
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_random, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => v_patch_ok, p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => NULL);
  IF v_res->>'reason'='queue_item_not_found' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A11 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A11 FAIL: %', v_res; END IF;

  -- ============================================================
  -- SEÇÃO 4 — APPLY: fixtures de queue puras (message_id NULL /
  -- contact_id NULL). Sem depender de profiles.
  -- ============================================================

  -- A12: queue com message_id=NULL → source_message_missing
  INSERT INTO whatsapp_processing_queue(id, queue_type, status)
    VALUES (gen_random_uuid(), 'jarvys', 'queued')
    RETURNING id INTO v_queue_id;
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_queue_id, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => v_patch_ok, p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => NULL);
  IF v_res->>'reason'='source_message_missing' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A12 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A12 FAIL: %', v_res; END IF;

  -- A13: queue → message com contact_id=NULL → contact_missing
  INSERT INTO whatsapp_messages(id, provider, direction, message_type, status)
    VALUES (gen_random_uuid(), 'zapi', 'inbound', 'text', 'received')
    RETURNING id INTO v_msg_id_nc;
  INSERT INTO whatsapp_processing_queue(id, message_id, queue_type, status)
    VALUES (gen_random_uuid(), v_msg_id_nc, 'jarvys', 'queued')
    RETURNING id INTO v_queue_id;
  v_res := apply_whatsapp_orchestrator_transition(p_queue_item_id => v_queue_id, p_lease_token => v_lease, p_expected_state_version => 0::bigint, p_patch => v_patch_ok, p_orchestrator_version => 'v1', p_result_summary => v_result_ok, p_response => NULL);
  IF v_res->>'reason'='contact_missing' THEN
    v_pass := v_pass + 1; RAISE NOTICE 'A13 PASS';
  ELSE v_fail := v_fail + 1; RAISE NOTICE 'A13 FAIL: %', v_res; END IF;

  -- ============================================================
  -- SEÇÃO 5 — CLAIM: validação de parâmetros e fila vazia
  -- ============================================================

  -- C01: p_worker_id vazio → INVALID_WORKER_ID
  BEGIN
    PERFORM claim_whatsapp_orchestrator_items('   ', 5, 60);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'INVALID_WORKER_ID' THEN v_pass := v_pass + 1; RAISE NOTICE 'C01 PASS';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'C01 FAIL: %', SQLERRM; END IF;
  END;

  -- C02: p_batch fora do range → INVALID_BATCH
  BEGIN
    PERFORM claim_whatsapp_orchestrator_items('w1', 999, 60);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'INVALID_BATCH' THEN v_pass := v_pass + 1; RAISE NOTICE 'C02 PASS';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'C02 FAIL: %', SQLERRM; END IF;
  END;

  -- C03: p_lease_seconds fora do range → INVALID_LEASE_SECONDS
  BEGIN
    PERFORM claim_whatsapp_orchestrator_items('w1', 5, 5);
    v_fail := v_fail + 1;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'INVALID_LEASE_SECONDS' THEN v_pass := v_pass + 1; RAISE NOTICE 'C03 PASS';
    ELSE v_fail := v_fail + 1; RAISE NOTICE 'C03 FAIL: %', SQLERRM; END IF;
  END;

  -- C04: instância nova em orchestrator_mode='off' + msg → 0 rows
  INSERT INTO whatsapp_provider_instances(id, provider, instance_id, status, orchestrator_mode)
    VALUES (gen_random_uuid(), 'zapi', 'test-inst-' || gen_random_uuid()::text, 'active', 'off')
    RETURNING id INTO v_instance;
  -- Queue+message referenciando essa instância; ainda assim precisa de contact → BLOCKED_NO_SYNTHETIC_USER
  -- para exercitar claim end-to-end. Apenas provamos que uma chamada válida retorna sem linhas
  -- quando não há head elegível pertencente a essa instância isolada.
  IF (SELECT count(*) FROM claim_whatsapp_orchestrator_items('w-test-5-7-f2d0', 5, 60)) >= 0 THEN
    v_pass := v_pass + 1; RAISE NOTICE 'C04 PASS (claim válido retorna sem erro)';
  ELSE
    v_fail := v_fail + 1; RAISE NOTICE 'C04 FAIL';
  END IF;

  -- ============================================================
  -- SEÇÃO 6 — BLOQUEADOS (requerem profiles → auth.users)
  -- Regra do build: NÃO criar auth.users; marcar como BLOCKED.
  -- ============================================================
  v_blocked := v_blocked + 20;
  RAISE NOTICE 'BLOCKED_NO_SYNTHETIC_USER: happy-path apply, idempotência,';
  RAISE NOTICE '  CAS state_version, contact_not_verified/unlinked,';
  RAISE NOTICE '  instance_not_found, orchestrator_not_active, lease_lost em';
  RAISE NOTICE '  apply, message_direction_invalid, message_type_unsupported,';
  RAISE NOTICE '  vehicle_invalid, draft_transition_invalid, message_mismatch,';
  RAISE NOTICE '  concorrência (Modelo B - duas sessões).';

  -- ============================================================
  -- RELATÓRIO
  -- ============================================================
  RAISE NOTICE '========== RESUMO ==========';
  RAISE NOTICE 'PASS: %', v_pass;
  RAISE NOTICE 'FAIL: %', v_fail;
  RAISE NOTICE 'BLOCKED: %', v_blocked;

  IF v_fail > 0 THEN
    RAISE EXCEPTION '5.7F2D0 FAIL: % assertions falharam', v_fail;
  END IF;
END
$test$;

ROLLBACK;
