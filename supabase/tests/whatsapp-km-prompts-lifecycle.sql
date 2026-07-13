-- ============================================================
-- BUILD 5.7F2E1A.5-MJ1 — TESTES SQL DO LIFECYCLE DE km-prompts.
--   create_whatsapp_km_prompt_request
--   promote_whatsapp_km_prompt_request_to_pending
--   reserve_whatsapp_km_prompt_request
--   cancel_whatsapp_km_prompt_request
--   expire_whatsapp_km_prompt_requests
-- Isolamento: BEGIN ... ROLLBACK. Nada é comitado.
-- Sandbox_exec só tem INSERT (não UPDATE) em whatsapp_messages/
-- whatsapp_km_prompt_requests. Todos os pré-requisitos são
-- preparados por INSERT direto para simular estados de destino.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = notice;
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
  v_pass    int := 0;
  v_fail    int := 0;

  v_user      uuid;
  v_contact   uuid := gen_random_uuid();
  v_vehicle   uuid := gen_random_uuid();
  v_vehicle2  uuid := gen_random_uuid();
  v_archived  uuid := gen_random_uuid();

  v_prompt_sent    uuid := gen_random_uuid();
  v_prompt_queued  uuid := gen_random_uuid();
  v_prompt_arch    uuid := gen_random_uuid();
  v_draft          uuid := gen_random_uuid();
  v_draft_bad      uuid := gen_random_uuid();

  v_expire_prompt  uuid := gen_random_uuid();
  v_expire_req     uuid := gen_random_uuid();

  v_bogus     uuid := gen_random_uuid();
  v_res       record;
  v_row       record;
  v_count     int;
BEGIN
  RAISE NOTICE '========== BUILD 5.7F2E1A.5-MJ1 START ==========';

  SELECT id INTO v_user FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'BLOCKED_NO_PROFILE_FIXTURE'; END IF;

  -- Fixtures.
  INSERT INTO public.veiculos(id, user_id, placa, status)
       VALUES (v_vehicle,  v_user, 'TSTKM01', 'ativo'),
              (v_vehicle2, v_user, 'TSTKM02', 'ativo'),
              (v_archived, v_user, 'TSTKM03', 'archived');

  INSERT INTO public.whatsapp_contacts(id, user_id, phone_e164, assigned_provider,
                                       assigned_instance_id, verified_at, opt_in, opt_out)
       VALUES (v_contact, v_user, '+5511900000000', 'zapi', 'INSTX', now(), true, false);

  INSERT INTO public.whatsapp_messages(id, user_id, vehicle_id, contact_id, provider,
                                       instance_id, direction, message_type, text_body, status)
  VALUES
    (v_prompt_sent,   v_user, v_vehicle,  v_contact, 'zapi', 'INSTX', 'outbound', 'text', 'ps', 'sent'),
    (v_prompt_queued, v_user, v_vehicle2, v_contact, 'zapi', 'INSTX', 'outbound', 'text', 'pq', 'queued'),
    (v_prompt_arch,   v_user, v_archived, v_contact, 'zapi', 'INSTX', 'outbound', 'text', 'pa', 'sent'),
    (v_expire_prompt, v_user, v_vehicle,  v_contact, 'zapi', 'INSTX', 'outbound', 'text', 'pe', 'sent'),
    (v_draft,         v_user, v_vehicle,  v_contact, 'zapi', 'INSTX', 'inbound',  'text', 'd1', 'received'),
    (v_draft_bad,     v_user, v_vehicle,  v_contact, 'zapi', 'INSTX', 'inbound',  'text', 'd2', 'received');

  -- ================== CREATE ==================

  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_prompt_sent, v_contact, v_user, v_vehicle);
  IF v_res.result='created' AND v_res.request_id IS NOT NULL
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C01 PASS created';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C01 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_prompt_sent, v_contact, v_user, v_vehicle);
  IF v_res.result='replayed'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C02 PASS replayed';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C02 FAIL %', v_res; END IF;

  -- C03: contexto divergente vs mensagem → prompt_context_mismatch.
  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_prompt_sent, v_contact, v_user, v_vehicle2);
  IF v_res.result='prompt_context_mismatch'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C03 PASS context_mismatch';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C03 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_bogus, v_contact, v_user, v_vehicle);
  IF v_res.result='prompt_message_not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C04 PASS not_found';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C04 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_draft, v_contact, v_user, v_vehicle);
  IF v_res.result='prompt_message_not_outbound'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C05 PASS not_outbound';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C05 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_prompt_arch, v_contact, v_user, v_archived);
  IF v_res.result='vehicle_archived'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C06 PASS vehicle_archived';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C06 FAIL %', v_res; END IF;

  -- ================== PROMOTE ==================

  -- Cria request para prompt 'queued' e tenta promover.
  PERFORM public.create_whatsapp_km_prompt_request(
    v_prompt_queued, v_contact, v_user, v_vehicle2);
  SELECT * INTO v_res FROM public.promote_whatsapp_km_prompt_request_to_pending(v_prompt_queued);
  IF v_res.result='prompt_message_not_sent'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P01 PASS not_sent';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P01 FAIL %', v_res; END IF;

  -- Promote do prompt já 'sent'.
  SELECT * INTO v_res FROM public.promote_whatsapp_km_prompt_request_to_pending(v_prompt_sent);
  IF v_res.result='promoted'
     AND v_res.pending_at IS NOT NULL
     AND v_res.expires_at IS NOT NULL
     AND v_res.expires_at > v_res.pending_at
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P02 PASS promoted';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P02 FAIL %', v_res; END IF;

  -- Validade de 7 dias (± 5s).
  IF EXISTS (
    SELECT 1 FROM public.whatsapp_km_prompt_requests
     WHERE prompt_message_id = v_prompt_sent
       AND expires_at BETWEEN pending_at + INTERVAL '7 days' - INTERVAL '5 seconds'
                          AND pending_at + INTERVAL '7 days' + INTERVAL '5 seconds')
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P02b PASS 7-day window';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P02b FAIL janela'; END IF;

  SELECT * INTO v_res FROM public.promote_whatsapp_km_prompt_request_to_pending(v_prompt_sent);
  IF v_res.result='already_pending'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P03 PASS already_pending';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P03 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.promote_whatsapp_km_prompt_request_to_pending(v_bogus);
  IF v_res.result='not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P04 PASS not_found';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P04 FAIL %', v_res; END IF;

  -- ================== RESERVE ==================

  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_prompt_sent, v_contact, v_user, v_vehicle, v_draft);
  IF v_res.result='reserved'
     AND v_res.reserved_draft_id = v_draft
     AND v_res.reserved_at IS NOT NULL
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R01 PASS reserved';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R01 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_prompt_sent, v_contact, v_user, v_vehicle, v_draft);
  IF v_res.result='replayed'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R02 PASS replayed';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R02 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_prompt_sent, v_contact, v_user, v_vehicle, v_draft_bad);
  IF v_res.result='prompt_reserved_by_other_draft'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R03 PASS reserved_by_other_draft';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R03 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_bogus, v_contact, v_user, v_vehicle, v_draft);
  IF v_res.result='prompt_not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R05 PASS prompt_not_found';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R05 FAIL %', v_res; END IF;

  -- ================== CANCEL ==================

  -- Cancelar prompt reserved.
  SELECT * INTO v_res FROM public.cancel_whatsapp_km_prompt_request(v_prompt_sent);
  IF v_res.result='cancelled' AND v_res.cancelled_at IS NOT NULL
    THEN v_pass:=v_pass+1; RAISE NOTICE 'CN01 PASS cancelled';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'CN01 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.cancel_whatsapp_km_prompt_request(v_prompt_sent);
  IF v_res.result='already_terminal'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'CN02 PASS already_terminal';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'CN02 FAIL %', v_res; END IF;

  SELECT * INTO v_res FROM public.cancel_whatsapp_km_prompt_request(v_bogus);
  IF v_res.result='not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'CN04 PASS not_found';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'CN04 FAIL %', v_res; END IF;

  -- ================== EXPIRE ==================

  -- INSERT direto: request 'pending' com expires_at no passado.
  INSERT INTO public.whatsapp_km_prompt_requests
    (id, prompt_message_id, contact_id, user_id, vehicle_id, status,
     pending_at, expires_at)
  VALUES
    (v_expire_req, v_expire_prompt, v_contact, v_user, v_vehicle, 'pending',
     now() - INTERVAL '10 minutes', now() - INTERVAL '1 minute');

  SELECT expired_count INTO v_count FROM public.expire_whatsapp_km_prompt_requests(500);
  IF v_count >= 1
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E01 PASS expired_count=%', v_count;
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E01 FAIL count=%', v_count; END IF;

  SELECT expired_count INTO v_count FROM public.expire_whatsapp_km_prompt_requests(500);
  IF v_count = 0
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E02 PASS idempotent';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E02 FAIL count=%', v_count; END IF;

  BEGIN
    PERFORM public.expire_whatsapp_km_prompt_requests(0);
    v_fail := v_fail + 1; RAISE NOTICE 'E03 FAIL sem exceção';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'E03 PASS reject batch=0 (%)', SQLSTATE;
  END;

  BEGIN
    PERFORM public.expire_whatsapp_km_prompt_requests(-1);
    v_fail := v_fail + 1; RAISE NOTICE 'E03b FAIL sem exceção';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'E03b PASS reject batch<0';
  END;

  -- ================== INVARIANTES ==================

  SELECT * INTO v_row FROM public.whatsapp_km_prompt_requests
   WHERE id = v_expire_req;
  IF v_row.status='expired' AND v_row.expired_at IS NOT NULL
    THEN v_pass:=v_pass+1; RAISE NOTICE 'I01 PASS expired status';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'I01 FAIL row=%', v_row; END IF;

  SELECT * INTO v_row FROM public.whatsapp_km_prompt_requests
   WHERE prompt_message_id = v_prompt_sent;
  IF v_row.status='cancelled' AND v_row.cancelled_at IS NOT NULL
    THEN v_pass:=v_pass+1; RAISE NOTICE 'I02 PASS cancelled status';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'I02 FAIL row=%', v_row; END IF;

  RAISE NOTICE '========== BUILD 5.7F2E1A.5-MJ1 END ==========';
  RAISE NOTICE 'RESULT: pass=% fail=%', v_pass, v_fail;

  IF v_fail > 0 THEN
    RAISE EXCEPTION 'MJ1_TEST_FAILURES=%', v_fail;
  END IF;
END
$test$ LANGUAGE plpgsql;

-- ==========================================================
-- GRANTS: anon/authenticated não têm EXECUTE em NENHUMA RPC MJ1.
-- ==========================================================

DO $grants$
DECLARE
  r record;
  v_bad int := 0;
  v_sig text;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN (
         'create_whatsapp_km_prompt_request',
         'promote_whatsapp_km_prompt_request_to_pending',
         'reserve_whatsapp_km_prompt_request',
         'cancel_whatsapp_km_prompt_request',
         'expire_whatsapp_km_prompt_requests')
  LOOP
    v_sig := 'public.'||r.proname||'('||r.args||')';
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
       OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      RAISE NOTICE 'GRANT LEAK on %', v_sig;
    END IF;
  END LOOP;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'GRANT_LEAKS=%', v_bad;
  ELSE
    RAISE NOTICE 'GRANTS PASS — nenhuma execução para anon/authenticated';
  END IF;
END
$grants$ LANGUAGE plpgsql;

ROLLBACK;
