
-- Build 5.7E1 — Opt-out e reativação transacional do WhatsApp
-- Duas RPCs mínimas, SECURITY DEFINER, executáveis somente por service_role.
-- O caller (server function autenticada com requireSupabaseAuth) passa p_user_id
-- já validado (context.userId), nunca vindo do client bruto.

-- ---------- disable_whatsapp_messages ----------
CREATE OR REPLACE FUNCTION public.disable_whatsapp_messages(p_user_id uuid)
RETURNS TABLE(result text, contact_id uuid, phone_e164 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact   public.whatsapp_contacts%ROWTYPE;
  v_consent_text constant text :=
    'v1: Desativei as mensagens do Jarvys pelo WhatsApp pelas configurações do app.';
BEGIN
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT 'invalid_request'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Localiza contato ativo verificado do usuário (unlinked_at IS NULL).
  SELECT *
    INTO v_contact
    FROM public.whatsapp_contacts
   WHERE user_id = p_user_id
     AND unlinked_at IS NULL
     AND verified_at IS NOT NULL
   ORDER BY is_primary DESC, verified_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_active_contact'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Idempotência: se já opt_out, retorna ok sem side-effects adicionais.
  IF v_contact.opt_out = true AND v_contact.opt_in = false THEN
    RETURN QUERY SELECT 'ok'::text, v_contact.id, v_contact.phone_e164;
    RETURN;
  END IF;

  UPDATE public.whatsapp_contacts
     SET opt_in     = false,
         opt_out    = true,
         opt_out_at = now()
   WHERE id = v_contact.id;

  -- Consentimento append-only (revogação).
  INSERT INTO public.whatsapp_consents (
    user_id, phone_e164, consent_type, source, consent_text, revoked_at
  ) VALUES (
    p_user_id, v_contact.phone_e164, 'geral', 'app_settings', v_consent_text, now()
  );

  RETURN QUERY SELECT 'ok'::text, v_contact.id, v_contact.phone_e164;
END;
$$;

-- Trava execução: só service_role.
REVOKE ALL ON FUNCTION public.disable_whatsapp_messages(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_whatsapp_messages(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.disable_whatsapp_messages(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.disable_whatsapp_messages(uuid) TO service_role;

-- ---------- reactivate_whatsapp_contact ----------
CREATE OR REPLACE FUNCTION public.reactivate_whatsapp_contact(p_user_id uuid)
RETURNS TABLE(result text, contact_id uuid, phone_e164 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact   public.whatsapp_contacts%ROWTYPE;
  v_consent_text constant text :=
    'v1: Reativei o recebimento de mensagens do Jarvys pelo WhatsApp pelas configurações do app.';
BEGIN
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT 'invalid_request'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT *
    INTO v_contact
    FROM public.whatsapp_contacts
   WHERE user_id = p_user_id
     AND unlinked_at IS NULL
     AND verified_at IS NOT NULL
   ORDER BY is_primary DESC, verified_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_active_contact'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Idempotência: se já opt_in ativo, retorna ok.
  IF v_contact.opt_in = true AND v_contact.opt_out = false THEN
    RETURN QUERY SELECT 'ok'::text, v_contact.id, v_contact.phone_e164;
    RETURN;
  END IF;

  UPDATE public.whatsapp_contacts
     SET opt_in     = true,
         opt_out    = false,
         opt_out_at = NULL,
         opt_in_at  = now(),
         opt_in_source = 'app_settings'
   WHERE id = v_contact.id;

  -- Consentimento append-only (novo aceite).
  INSERT INTO public.whatsapp_consents (
    user_id, phone_e164, consent_type, source, consent_text, accepted_at
  ) VALUES (
    p_user_id, v_contact.phone_e164, 'geral', 'app_settings', v_consent_text, now()
  );

  RETURN QUERY SELECT 'ok'::text, v_contact.id, v_contact.phone_e164;
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_whatsapp_contact(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reactivate_whatsapp_contact(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reactivate_whatsapp_contact(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reactivate_whatsapp_contact(uuid) TO service_role;
