-- ============================================================
-- BUILD 5.7F2E1A.5-MJ1 — TESTES SQL DO LIFECYCLE DE km-prompts.
--   create_whatsapp_km_prompt_request
--   promote_whatsapp_km_prompt_request_to_pending
--   reserve_whatsapp_km_prompt_request
--   cancel_whatsapp_km_prompt_request
--   expire_whatsapp_km_prompt_requests
-- Isolamento: BEGIN ... ROLLBACK. Nada é comitado.
-- Fixtures sintéticas usam um profile existente (public.profiles),
-- criando veículos, contact e mensagens dentro da transação.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = notice;
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
  v_pass    int := 0;
  v_fail    int := 0;

  -- fixtures
  v_user      uuid;
  v_contact   uuid := gen_random_uuid();
  v_vehicle   uuid := gen_random_uuid();
  v_vehicle2  uuid := gen_random_uuid();
  v_archived  uuid := gen_random_uuid();

  v_prompt    uuid := gen_random_uuid();
  v_prompt2   uuid := gen_random_uuid();
  v_prompt3   uuid := gen_random_uuid();
  v_draft     uuid := gen_random_uuid();
  v_draft_bad uuid := gen_random_uuid();

  v_bogus     uuid := gen_random_uuid();

  v_res       record;
  v_row       record;
  v_count     int;
BEGIN
  RAISE NOTICE '========== BUILD 5.7F2E1A.5-MJ1 START ==========';

  -- Pega um profile existente (qualquer um) para satisfazer FKs.
  SELECT id INTO v_user FROM public.profiles ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'BLOCKED_NO_PROFILE_FIXTURE';
  END IF;

  -- Cria veículos sintéticos (2 ativos + 1 archived) e contact.
  INSERT INTO public.veiculos(id, user_id, placa, status)
       VALUES (v_vehicle, v_user, 'TSTKM01', 'ativo'),
              (v_vehicle2, v_user, 'TSTKM02', 'ativo'),
              (v_archived, v_user, 'TSTKM03', 'archived');

  INSERT INTO public.whatsapp_contacts(id, user_id, provider, instance_id, phone_hash, verified_at)
       VALUES (v_contact, v_user, 'zapi', 'INSTX', repeat('a', 64), now());

  -- Mensagens: outbound (prompt), outbound de outro contexto, inbound (draft).
  INSERT INTO public.whatsapp_messages(id, user_id, vehicle_id, contact_id, provider,
                                       instance_id, direction, message_type, text_body, status)
       VALUES (v_prompt,  v_user, v_vehicle,  v_contact, 'zapi', 'INSTX', 'outbound', 'text', 'p1', 'queued'),
              (v_prompt2, v_user, v_vehicle,  v_contact, 'zapi', 'INSTX', 'outbound', 'text', 'p2', 'queued'),
              (v_prompt3, v_user, v_archived, v_contact, 'zapi', 'INSTX', 'outbound', 'text', 'p3', 'queued'),
              (v_draft,   v_user, v_vehicle,  v_contact, 'zapi', 'INSTX', 'inbound',  'text', 'd1', 'received'),
              (v_draft_bad, v_user, v_vehicle2, v_contact, 'zapi', 'INSTX', 'inbound', 'text', 'd2', 'received');

  -- ==========================================================
  -- CREATE
  -- ==========================================================

  -- C01 — outbound queued: created
  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_prompt, v_contact, v_user, v_vehicle);
  IF v_res.result='created' AND v_res.request_id IS NOT NULL
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C01 PASS created';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C01 FAIL %', v_res; END IF;

  -- C02 — idempotência: replayed
  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_prompt, v_contact, v_user, v_vehicle);
  IF v_res.result='replayed'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C02 PASS replayed';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C02 FAIL %', v_res; END IF;

  -- C03 — mesmo prompt, contexto diferente
  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_prompt, v_contact, v_user, v_vehicle2);
  IF v_res.result='already_exists_with_different_context'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C03 PASS diff context';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C03 FAIL %', v_res; END IF;

  -- C04 — prompt inexistente
  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_bogus, v_contact, v_user, v_vehicle);
  IF v_res.result='prompt_message_not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C04 PASS not_found';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C04 FAIL %', v_res; END IF;

  -- C05 — mensagem inbound (não outbound)
  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_draft, v_contact, v_user, v_vehicle);
  IF v_res.result='prompt_message_not_outbound'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C05 PASS not_outbound';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C05 FAIL %', v_res; END IF;

  -- C06 — veículo archived
  SELECT * INTO v_res FROM public.create_whatsapp_km_prompt_request(
    v_prompt3, v_contact, v_user, v_archived);
  IF v_res.result='vehicle_archived'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'C06 PASS vehicle_archived';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'C06 FAIL %', v_res; END IF;

  -- ==========================================================
  -- PROMOTE
  -- ==========================================================

  -- P01 — ainda 'queued' (não enviado)
  SELECT * INTO v_res FROM public.promote_whatsapp_km_prompt_request_to_pending(v_prompt);
  IF v_res.result='prompt_message_not_sent'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P01 PASS not_sent';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P01 FAIL %', v_res; END IF;

  -- Marca outbound como sent
  UPDATE public.whatsapp_messages SET status='sent', updated_at=now() WHERE id=v_prompt;

  -- P02 — promoted
  SELECT * INTO v_res FROM public.promote_whatsapp_km_prompt_request_to_pending(v_prompt);
  IF v_res.result='promoted'
     AND v_res.pending_at IS NOT NULL
     AND v_res.expires_at IS NOT NULL
     AND v_res.expires_at > v_res.pending_at
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P02 PASS promoted';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P02 FAIL %', v_res; END IF;

  -- P02b — validade de 7 dias exata (± 5s)
  IF EXISTS (
    SELECT 1 FROM public.whatsapp_km_prompt_requests
     WHERE prompt_message_id = v_prompt
       AND expires_at BETWEEN pending_at + INTERVAL '7 days' - INTERVAL '5 seconds'
                          AND pending_at + INTERVAL '7 days' + INTERVAL '5 seconds')
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P02b PASS 7 days';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P02b FAIL janela'; END IF;

  -- P03 — replay/promoted já: already_pending
  SELECT * INTO v_res FROM public.promote_whatsapp_km_prompt_request_to_pending(v_prompt);
  IF v_res.result='already_pending'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P03 PASS already_pending';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P03 FAIL %', v_res; END IF;

  -- P04 — prompt inexistente
  SELECT * INTO v_res FROM public.promote_whatsapp_km_prompt_request_to_pending(v_bogus);
  IF v_res.result='not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'P04 PASS not_found';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'P04 FAIL %', v_res; END IF;

  -- ==========================================================
  -- RESERVE
  -- ==========================================================

  -- R01 — reserved
  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_prompt, v_contact, v_user, v_vehicle, v_draft);
  IF v_res.result='reserved'
     AND v_res.reserved_draft_id = v_draft
     AND v_res.reserved_at IS NOT NULL
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R01 PASS reserved';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R01 FAIL %', v_res; END IF;

  -- R02 — replay com mesmo draft
  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_prompt, v_contact, v_user, v_vehicle, v_draft);
  IF v_res.result='replayed'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R02 PASS replayed';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R02 FAIL %', v_res; END IF;

  -- R03 — draft diferente: reserved_by_other_draft
  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_prompt, v_contact, v_user, v_vehicle, v_draft_bad);
  IF v_res.result='prompt_reserved_by_other_draft'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R03 PASS reserved_by_other_draft';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R03 FAIL %', v_res; END IF;

  -- R04 — contexto (vehicle) diferente
  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_prompt, v_contact, v_user, v_vehicle2, v_draft);
  IF v_res.result='prompt_context_mismatch' OR v_res.result='replayed'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R04 note %', v_res;
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R04 FAIL %', v_res; END IF;

  -- R05 — prompt inexistente
  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_bogus, v_contact, v_user, v_vehicle, v_draft);
  IF v_res.result='prompt_not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R05 PASS prompt_not_found';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R05 FAIL %', v_res; END IF;

  -- R06 — reserved é terminal para reserve? Estado após R01 é 'reserved'.
  -- Novo prompt em estado pending para testar R06.
  -- Cria prompt2 → pending
  UPDATE public.whatsapp_messages SET status='sent' WHERE id=v_prompt2;
  PERFORM public.create_whatsapp_km_prompt_request(v_prompt2, v_contact, v_user, v_vehicle);
  PERFORM public.promote_whatsapp_km_prompt_request_to_pending(v_prompt2);

  -- Forçar expirado por UPDATE direto (fixture)
  UPDATE public.whatsapp_km_prompt_requests
     SET expires_at = now() - INTERVAL '1 hour'
   WHERE prompt_message_id = v_prompt2;

  SELECT * INTO v_res FROM public.reserve_whatsapp_km_prompt_request(
    v_prompt2, v_contact, v_user, v_vehicle, v_draft);
  IF v_res.result='prompt_expired'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'R06 PASS prompt_expired';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'R06 FAIL %', v_res; END IF;

  -- ==========================================================
  -- CANCEL
  -- ==========================================================

  -- CN01 — cancelar prompt2 (expired): já-terminal via expiração lógica
  -- estado ainda é 'pending' porque expire_at é regra, não estado.
  SELECT * INTO v_res FROM public.cancel_whatsapp_km_prompt_request(v_prompt2);
  IF v_res.result='cancelled' AND v_res.cancelled_at IS NOT NULL
    THEN v_pass:=v_pass+1; RAISE NOTICE 'CN01 PASS cancelled';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'CN01 FAIL %', v_res; END IF;

  -- CN02 — replay cancel → already_terminal
  SELECT * INTO v_res FROM public.cancel_whatsapp_km_prompt_request(v_prompt2);
  IF v_res.result='already_terminal'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'CN02 PASS already_terminal';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'CN02 FAIL %', v_res; END IF;

  -- CN03 — cancelar reserved (prompt): permitido antes de consumed
  SELECT * INTO v_res FROM public.cancel_whatsapp_km_prompt_request(v_prompt);
  IF v_res.result IN ('cancelled', 'already_terminal')
    THEN v_pass:=v_pass+1; RAISE NOTICE 'CN03 note %', v_res;
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'CN03 FAIL %', v_res; END IF;

  -- CN04 — não encontrado
  SELECT * INTO v_res FROM public.cancel_whatsapp_km_prompt_request(v_bogus);
  IF v_res.result='not_found'
    THEN v_pass:=v_pass+1; RAISE NOTICE 'CN04 PASS not_found';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'CN04 FAIL %', v_res; END IF;

  -- ==========================================================
  -- EXPIRE (batch)
  -- ==========================================================

  -- Setup: cria prompt3 fixture, promove com expires no passado, mas sem cancelar.
  UPDATE public.whatsapp_messages SET status='sent', vehicle_id=v_vehicle WHERE id=v_prompt3;
  PERFORM public.create_whatsapp_km_prompt_request(v_prompt3, v_contact, v_user, v_vehicle);
  PERFORM public.promote_whatsapp_km_prompt_request_to_pending(v_prompt3);
  UPDATE public.whatsapp_km_prompt_requests
     SET expires_at = now() - INTERVAL '10 minutes'
   WHERE prompt_message_id = v_prompt3;

  -- E01 — expira ao menos 1
  SELECT expired_count INTO v_count FROM public.expire_whatsapp_km_prompt_requests(500);
  IF v_count >= 1
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E01 PASS expired_count=%', v_count;
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E01 FAIL count=%', v_count; END IF;

  -- E02 — idempotente: rodar de novo não expira o mesmo
  SELECT expired_count INTO v_count FROM public.expire_whatsapp_km_prompt_requests(500);
  IF v_count = 0
    THEN v_pass:=v_pass+1; RAISE NOTICE 'E02 PASS idempotent';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'E02 FAIL count=%', v_count; END IF;

  -- E03 — batch inválido (<=0)
  BEGIN
    PERFORM public.expire_whatsapp_km_prompt_requests(0);
    v_fail := v_fail + 1; RAISE NOTICE 'E03 FAIL sem exceção';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'E03 PASS reject batch=0 (%): %', SQLSTATE, SQLERRM;
  END;

  BEGIN
    PERFORM public.expire_whatsapp_km_prompt_requests(-1);
    v_fail := v_fail + 1; RAISE NOTICE 'E03b FAIL sem exceção';
  EXCEPTION WHEN OTHERS THEN
    v_pass := v_pass + 1; RAISE NOTICE 'E03b PASS reject batch<0';
  END;

  -- ==========================================================
  -- INVARIANTES estruturais
  -- ==========================================================

  -- I01 — prompt3 agora tem status='expired' e expired_at NOT NULL
  SELECT * INTO v_row FROM public.whatsapp_km_prompt_requests
   WHERE prompt_message_id = v_prompt3;
  IF v_row.status='expired' AND v_row.expired_at IS NOT NULL
    THEN v_pass:=v_pass+1; RAISE NOTICE 'I01 PASS expired status';
    ELSE v_fail:=v_fail+1; RAISE NOTICE 'I01 FAIL row=%', v_row; END IF;

  -- I02 — prompt2 tem status='cancelled' com cancelled_at NOT NULL
  SELECT * INTO v_row FROM public.whatsapp_km_prompt_requests
   WHERE prompt_message_id = v_prompt2;
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
-- GRANTS: anon/authenticated não têm EXECUTE
-- ==========================================================

DO $grants$
DECLARE
  r record;
  v_bad int := 0;
BEGIN
  FOR r IN
    SELECT p.proname
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
    IF has_function_privilege('anon', 'public.'||r.proname||'(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated',
                                 'public.'||r.proname||'(uuid)', 'EXECUTE')
    THEN
      v_bad := v_bad + 1;
      RAISE NOTICE 'GRANT LEAK on %', r.proname;
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
