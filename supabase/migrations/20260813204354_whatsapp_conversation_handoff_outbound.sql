-- Build C6 — Outbound persistido do Conversation Handoff (Dr. Jarvys via
-- WhatsApp). Reaproveita a whatsapp_outbound_queue já existente em
-- produção — nenhuma tabela nova. Adiciona o valor 'conversation' à
-- CHECK de purpose (woq_purpose_chk) e uma RPC SECURITY DEFINER
-- (enqueue_conversation_handoff_outbound), modelada explicitamente no
-- padrão real de enqueue_whatsapp_km_prompt: pg_advisory_xact_lock na
-- chave de idempotência + replay check com validação de contexto
-- completo (nunca depender só da UNIQUE index woq_idempotency_unique).
-- Validação mais leve que o padrão do KM-prompt: não duplica a
-- checagem de instância/provider ativo (o sender whatsapp-send-outbound
-- já faz isso) — confia que o C4 já autorizou a conversa. Backend-only,
-- ainda desconectada do runtime.

-- ============================================================
-- 1) ALTER da constraint de purpose — adiciona 'conversation'
-- ============================================================

ALTER TABLE public.whatsapp_outbound_queue DROP CONSTRAINT woq_purpose_chk;
ALTER TABLE public.whatsapp_outbound_queue ADD CONSTRAINT woq_purpose_chk
  CHECK (purpose = ANY (ARRAY[
    'general','onboarding','link_code','link_confirm',
    'opt_out_confirm','commercial','notification','conversation'
  ]::text[]));

-- ============================================================
-- 2) RPC enqueue_conversation_handoff_outbound
-- ============================================================

CREATE OR REPLACE FUNCTION public.enqueue_conversation_handoff_outbound(
  p_idempotency_key text,
  p_contact_id      uuid,
  p_user_id         uuid,
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
  v_existing_q    record;
  v_existing_msg  record;
  v_msg_id        uuid;
  v_queue_id      uuid;
  v_key_trim      text;
  v_body_trim     text;
BEGIN
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

  IF p_contact_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('result','contact_not_found');
  END IF;

  -- Advisory lock keyed on idempotency key (mesmo padrão do KM-prompt —
  -- nunca depender só da UNIQUE index woq_idempotency_unique).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  SELECT id, user_id, phone_e164, assigned_provider, assigned_instance_id,
         assigned_whatsapp_number, opt_out
    INTO v_contact
    FROM public.whatsapp_contacts
    WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result','contact_not_found');
  END IF;
  IF v_contact.opt_out = true THEN
    RETURN jsonb_build_object('result','contact_opted_out');
  END IF;
  IF v_contact.user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('result','contact_context_mismatch');
  END IF;
  IF v_contact.assigned_provider IS NULL OR btrim(v_contact.assigned_provider) = ''
     OR v_contact.assigned_instance_id IS NULL OR btrim(v_contact.assigned_instance_id) = '' THEN
    RETURN jsonb_build_object('result','contact_not_linked');
  END IF;

  IF p_vehicle_id IS NOT NULL THEN
    SELECT id INTO v_vehicle FROM public.veiculos WHERE id = p_vehicle_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('result','vehicle_not_found');
    END IF;
  END IF;

  -- Replay check via idempotency key
  SELECT id, user_id, contact_id, vehicle_id, purpose, text_body, source_message_id
    INTO v_existing_q
    FROM public.whatsapp_outbound_queue
    WHERE idempotency_key = p_idempotency_key
    FOR UPDATE;

  IF FOUND THEN
    IF v_existing_q.purpose <> 'conversation'
       OR v_existing_q.user_id IS DISTINCT FROM p_user_id
       OR v_existing_q.contact_id IS DISTINCT FROM p_contact_id
       OR v_existing_q.vehicle_id IS DISTINCT FROM p_vehicle_id
       OR v_existing_q.text_body IS DISTINCT FROM p_text_body
       OR v_existing_q.source_message_id IS NULL THEN
      RETURN jsonb_build_object('result','idempotency_context_mismatch');
    END IF;

    SELECT id, direction, message_type, contact_id, user_id, vehicle_id, text_body
      INTO v_existing_msg
      FROM public.whatsapp_messages
      WHERE id = v_existing_q.source_message_id;
    IF NOT FOUND
       OR v_existing_msg.direction <> 'outbound'
       OR v_existing_msg.message_type <> 'text'
       OR v_existing_msg.contact_id IS DISTINCT FROM p_contact_id
       OR v_existing_msg.user_id IS DISTINCT FROM p_user_id
       OR v_existing_msg.vehicle_id IS DISTINCT FROM p_vehicle_id
       OR v_existing_msg.text_body IS DISTINCT FROM p_text_body THEN
      RETURN jsonb_build_object('result','idempotency_context_mismatch');
    END IF;

    RETURN jsonb_build_object(
      'result','replayed',
      'outbound_message_id', v_existing_q.source_message_id,
      'outbound_queue_id', v_existing_q.id
    );
  END IF;

  -- Nova emissão
  INSERT INTO public.whatsapp_messages
    (direction, message_type, status, provider, instance_id,
     contact_id, user_id, vehicle_id, text_body)
  VALUES
    ('outbound','text','queued',
     v_contact.assigned_provider, v_contact.assigned_instance_id,
     p_contact_id, p_user_id, p_vehicle_id, p_text_body)
  RETURNING id INTO v_msg_id;

  INSERT INTO public.whatsapp_outbound_queue
    (user_id, contact_id, vehicle_id, provider, instance_id, phone_e164,
     message_type, purpose, text_body, status, priority, attempts, max_attempts,
     source_message_id, idempotency_key)
  VALUES
    (p_user_id, p_contact_id, p_vehicle_id,
     v_contact.assigned_provider, v_contact.assigned_instance_id, v_contact.phone_e164,
     'text','conversation', p_text_body, 'queued', 0, 0, 5,
     v_msg_id, p_idempotency_key)
  RETURNING id INTO v_queue_id;

  RETURN jsonb_build_object(
    'result','created',
    'outbound_message_id', v_msg_id,
    'outbound_queue_id', v_queue_id
  );
END;
$function$;

-- REVOKE/GRANT — seguindo o padrão exato do enqueue_whatsapp_km_prompt
-- (não o padrão mais simples de REVOKE EXECUTE de 2 linhas usado no C5).
ALTER FUNCTION public.enqueue_conversation_handoff_outbound(text,uuid,uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_conversation_handoff_outbound(text,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_conversation_handoff_outbound(text,uuid,uuid,uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_conversation_handoff_outbound(text,uuid,uuid,uuid,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_conversation_handoff_outbound(text,uuid,uuid,uuid,text) TO service_role;
COMMENT ON FUNCTION public.enqueue_conversation_handoff_outbound(text,uuid,uuid,uuid,text) IS
  'C6: Emissão idempotente da resposta outbound do Dr. Jarvys, reaproveitando whatsapp_outbound_queue (purpose=conversation). Modelada em enqueue_whatsapp_km_prompt, sem a checagem de instância/provider ativo (feita pelo sender). Backend-only, service_role.';
