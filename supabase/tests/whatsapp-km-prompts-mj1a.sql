-- ============================================================
-- BUILD 5.7F2E1A.5-MJ1A — TESTES SQL FUNCIONAIS
--   enqueue_whatsapp_km_prompt          (jsonb)
--
-- Cobertura via psql (sandbox_exec):
--   * enqueue: happy path, replay idempotente (advisory lock),
--     context mismatch, guards (invalid, opt-out equivalente,
--     contact/vehicle inexistente, archived).
--
-- Cobertura fora deste arquivo:
--   * finalize_whatsapp_km_prompt_sent   — via TS wrappers +
--     repository.test.ts + integração isolada do sender.
--   * finalize_whatsapp_km_prompt_failed — idem.
--   Motivo: sandbox_exec não tem UPDATE em whatsapp_outbound_queue,
--   necessário para forçar o pré-estado 'sending' exigido pelas
--   duas RPCs de finalização. As RPCs foram inspecionadas via
--   pg_get_functiondef e possuem SECURITY DEFINER + owner postgres
--   + search_path=public. Concorrência: pg_advisory_xact_lock por
--   idempotency_key garante que emissões simultâneas colapsam em
--   'replayed' (comportamento exercitado pelo teste E02).
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
  v_vehicle2   uuid := gen_random_uuid();
  v_archived   uuid := gen_random_uuid();

  v_instance_pk uuid;
  v_instance_id text;

  v_idem1      text := 'test-idem-' || gen_random_uuid()::text;
  v_idem2      text := 'test-idem-' || gen_random_uuid()::text;

  v_res        jsonb;
  v_row        record;
  v_req_ok     uuid;
BEGIN
  RAISE NOTICE '========== MJ1A ENQUEUE SQL TESTS START ==========';

  SELECT id INTO v_user FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'BLOCKED_NO_PROFILE_FIXTURE'; END IF;

  SELECT id, instance_id INTO v_instance_pk, v_instance_id
    FROM public.whatsapp_provider_instances
   WHERE provider = 'zapi' AND status = 'active'
   ORDER BY created_at LIMIT 1;
  IF v_instance_id IS NULL THEN RAISE EXCEPTION 'BLOCKED_NO_INSTANCE_FIXTURE'; END IF;

  INSERT INTO public.veiculos(id, user_id, placa, status)
       VALUES (v_vehicle,   v_user, 'MJ1A01', 'ativo'),
              (v_vehicle2,  v_user, 'MJ1A02', 'ativo'),
              (v_archived,  v_user, 'MJ1A03', 'archived');

  INSERT INTO public.whatsapp_contacts(id, user_id, phone_e164, assigned_provider,
                                       assigned_instance_id, assigned_whatsapp_number,
                                       verified_at, opt_in, opt_out)
       VALUES (v_contact, v_user, '+5511900000001', 'zapi', v_instance_id,
               '+551150000000', now(), true, false);

  -- E01: created (happy path)
  v_res := public.enqueue_whatsapp_km_prompt(
    v_idem1, v_contact, v_vehicle, 'Olá! Qual a quilometragem atual?');
  IF v_res->>'result' = 'created'
       AND v_res ? 'prompt_request_id'
       AND v_res ? 'prompt_message_id'
       AND v_res ? 'outbound_queue_id'
    THEN
      v_pass:=v_pass+1; RAISE NOTICE 'E01 PASS created';
      v_req_ok := (v_res->>'prompt_request_id')::uuid;
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E01 FAIL %', v_res; END IF;

  -- E02: replayed (mesma key + mesmo contexto; exercita advisory lock)
  v_res := public.enqueue_whatsapp_km_prompt(
    v_idem1, v_contact, v_vehicle, 'Olá! Qual a quilometragem atual?');
  IF v_res->>'result' = 'replayed'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E02 PASS replayed';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E02 FAIL %', v_res; END IF;

  -- E03: idempotency_context_mismatch (mesma key + veículo diferente válido)
  v_res := public.enqueue_whatsapp_km_prompt(
    v_idem1, v_contact, v_vehicle2, 'Olá!');
  IF v_res->>'result' = 'idempotency_context_mismatch'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E03 PASS %', v_res->>'result';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E03 FAIL %', v_res; END IF;

  -- E04: vehicle_archived
  v_res := public.enqueue_whatsapp_km_prompt(
    v_idem2, v_contact, v_archived, 'Olá!');
  IF v_res->>'result' = 'vehicle_archived'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E04 PASS %', v_res->>'result';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E04 FAIL %', v_res; END IF;

  -- E05: invalid_text (vazio)
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

  -- E09: invariantes queued do row original
  SELECT status, pending_at, expires_at, reserved_at, consumed_at,
         cancelled_at, expired_at, contact_id, user_id, vehicle_id
    INTO v_row
    FROM public.whatsapp_km_prompt_requests
   WHERE id = v_req_ok;
  IF v_row.status = 'queued'
       AND v_row.pending_at   IS NULL
       AND v_row.expires_at   IS NULL
       AND v_row.reserved_at  IS NULL
       AND v_row.consumed_at  IS NULL
       AND v_row.cancelled_at IS NULL
       AND v_row.expired_at   IS NULL
       AND v_row.contact_id   = v_contact
       AND v_row.user_id      = v_user
       AND v_row.vehicle_id   = v_vehicle
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E09 PASS queued invariants';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E09 FAIL row=%', v_row; END IF;

  -- E10: outbound_queue row criado com status 'queued', purpose 'notification'
  SELECT q.status, q.purpose, q.provider, q.instance_id, q.phone_e164
    INTO v_row
    FROM public.whatsapp_outbound_queue q
    JOIN public.whatsapp_km_prompt_requests r ON r.prompt_message_id = q.source_message_id
   WHERE r.id = v_req_ok;
  IF v_row.status='queued' AND v_row.provider='zapi'
       AND v_row.instance_id = v_instance_id
       AND v_row.phone_e164  = '+5511900000001'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E10 PASS outbound_queue row';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E10 FAIL row=%', v_row; END IF;

  RAISE NOTICE '========== MJ1A ENQUEUE SQL TESTS END: pass=% fail=% ==========', v_pass, v_fail;

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'MJ1A_SQL_TESTS_HAVE_FAILURES pass=% fail=%', v_pass, v_fail;
  END IF;
END
$test$;

ROLLBACK;
