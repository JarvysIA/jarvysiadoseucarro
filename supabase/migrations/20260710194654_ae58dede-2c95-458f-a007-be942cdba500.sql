
-- =====================================================================
-- Build 5.7B-fix — Ajustes preparatórios do vínculo WhatsApp
-- =====================================================================

-- 1. whatsapp_link_verifications: nova coluna source
ALTER TABLE public.whatsapp_link_verifications
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'onboarding';

ALTER TABLE public.whatsapp_link_verifications
  DROP CONSTRAINT IF EXISTS wlv_source_valid;
ALTER TABLE public.whatsapp_link_verifications
  ADD CONSTRAINT wlv_source_valid
  CHECK (source IN ('onboarding','app_settings'));

-- 2. whatsapp_outbound_queue: purpose + expires_at
ALTER TABLE public.whatsapp_outbound_queue
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

ALTER TABLE public.whatsapp_outbound_queue
  DROP CONSTRAINT IF EXISTS woq_purpose_chk;
ALTER TABLE public.whatsapp_outbound_queue
  ADD CONSTRAINT woq_purpose_chk
  CHECK (purpose IN (
    'general','onboarding','link_code','link_confirm',
    'opt_out_confirm','commercial','notification'
  ));

-- Índice útil para claim do sender por status/purpose/scheduled_at
CREATE INDEX IF NOT EXISTS woq_status_purpose_scheduled_idx
  ON public.whatsapp_outbound_queue(status, purpose, scheduled_at);

-- 3. RPC transacional de confirmação do vínculo WhatsApp
CREATE OR REPLACE FUNCTION public.confirm_whatsapp_link_code(
  p_user_id uuid,
  p_verification_id uuid,
  p_code_hash_candidate text
)
RETURNS TABLE(result text, contact_id uuid, phone_e164 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ver           record;
  v_conflict      uuid;
  v_other_active  uuid;
  v_existing      record;
  v_instance      record;
  v_use_instance  text;
  v_use_number    text;
  v_contact_id    uuid;
  v_needs_incr    boolean := false;
  v_new_attempts  integer;
  v_consent_text  constant text :=
    'v1: Aceito receber mensagens do Jarvys pelo WhatsApp sobre manutenção, revisão, despesas do meu veículo e recursos inteligentes do app.';
BEGIN
  -- 7.1 Bloquear verificação
  SELECT *
    INTO v_ver
    FROM public.whatsapp_link_verifications
   WHERE id = p_verification_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- 7.2 Validar estado
  IF v_ver.status = 'blocked' THEN
    RETURN QUERY SELECT 'blocked'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.status <> 'pending' THEN
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.expires_at <= now() THEN
    UPDATE public.whatsapp_link_verifications
       SET status = 'expired'
     WHERE id = v_ver.id;
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.attempts >= v_ver.max_attempts THEN
    UPDATE public.whatsapp_link_verifications
       SET status = 'blocked'
     WHERE id = v_ver.id;
    RETURN QUERY SELECT 'blocked'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- 7.3 Validar hash
  IF v_ver.code_hash <> p_code_hash_candidate THEN
    v_new_attempts := v_ver.attempts + 1;
    IF v_new_attempts >= v_ver.max_attempts THEN
      UPDATE public.whatsapp_link_verifications
         SET attempts = v_new_attempts,
             status   = 'blocked'
       WHERE id = v_ver.id;
    ELSE
      UPDATE public.whatsapp_link_verifications
         SET attempts = v_new_attempts
       WHERE id = v_ver.id;
    END IF;
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- 7.4 Conflitos
  SELECT id INTO v_conflict
    FROM public.whatsapp_contacts
   WHERE phone_e164 = v_ver.phone_e164
     AND unlinked_at IS NULL
     AND user_id <> p_user_id
   LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RETURN QUERY SELECT 'phone_conflict'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT id INTO v_other_active
    FROM public.whatsapp_contacts
   WHERE user_id = p_user_id
     AND unlinked_at IS NULL
     AND phone_e164 <> v_ver.phone_e164
   LIMIT 1;
  IF v_other_active IS NOT NULL THEN
    RETURN QUERY SELECT 'user_has_other_active'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- 7.5 Ler contato histórico explicitamente (FOR UPDATE)
  SELECT id, unlinked_at, assigned_instance_id, assigned_whatsapp_number
    INTO v_existing
    FROM public.whatsapp_contacts
   WHERE user_id = p_user_id
     AND phone_e164 = v_ver.phone_e164
   FOR UPDATE;

  -- 7.6 Instância
  IF FOUND
     AND v_existing.unlinked_at IS NULL
     AND v_existing.assigned_instance_id IS NOT NULL THEN
    -- Contato já ativo: preservar instância; validar apenas que ainda existe/ativa
    SELECT instance_id, phone_number_e164
      INTO v_instance
      FROM public.whatsapp_provider_instances
     WHERE provider = 'zapi'
       AND instance_id = v_existing.assigned_instance_id
       AND status = 'active'
       AND health_status <> 'failed'
     LIMIT 1;

    IF NOT FOUND THEN
      -- Instância antiga ficou inválida; escolher nova sem incrementar contador
      -- (contato já estava contabilizado nela originalmente).
      SELECT instance_id, phone_number_e164
        INTO v_instance
        FROM public.whatsapp_provider_instances
       WHERE provider = 'zapi'
         AND status = 'active'
         AND health_status <> 'failed'
         AND (max_users IS NULL OR current_users < max_users)
       ORDER BY is_default DESC, current_users ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 'no_instance_available'::text, NULL::uuid, NULL::text;
        RETURN;
      END IF;
    END IF;

    v_use_instance := v_instance.instance_id;
    v_use_number   := v_instance.phone_number_e164;
    v_needs_incr   := false;
  ELSE
    -- Contato novo OU reativação: escolher instância e planejar incremento
    SELECT instance_id, phone_number_e164
      INTO v_instance
      FROM public.whatsapp_provider_instances
     WHERE provider = 'zapi'
       AND status = 'active'
       AND health_status <> 'failed'
       AND (max_users IS NULL OR current_users < max_users)
     ORDER BY is_default DESC, current_users ASC
     FOR UPDATE SKIP LOCKED
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'no_instance_available'::text, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    v_use_instance := v_instance.instance_id;
    v_use_number   := v_instance.phone_number_e164;
    v_needs_incr   := true;
  END IF;

  -- 7.7 Criar ou reativar contato
  IF v_existing.id IS NULL THEN
    INSERT INTO public.whatsapp_contacts (
      user_id, phone_e164, verified_at, unlinked_at, is_primary,
      opt_in, opt_out, opt_out_at,
      opt_in_source, opt_in_at,
      assigned_provider, assigned_instance_id, assigned_whatsapp_number
    ) VALUES (
      p_user_id, v_ver.phone_e164, now(), NULL, true,
      true, false, NULL,
      v_ver.source, now(),
      'zapi', v_use_instance, v_use_number
    )
    RETURNING id INTO v_contact_id;
  ELSE
    UPDATE public.whatsapp_contacts
       SET verified_at              = now(),
           unlinked_at              = NULL,
           is_primary               = true,
           opt_in                   = true,
           opt_out                  = false,
           opt_out_at               = NULL,
           opt_in_source            = v_ver.source,
           opt_in_at                = now(),
           assigned_provider        = 'zapi',
           assigned_instance_id     = v_use_instance,
           assigned_whatsapp_number = v_use_number
     WHERE id = v_existing.id
    RETURNING id INTO v_contact_id;
  END IF;

  -- Incremento controlado por estado lido antes (sem xmax)
  IF v_needs_incr THEN
    UPDATE public.whatsapp_provider_instances
       SET current_users = current_users + 1
     WHERE instance_id = v_use_instance
       AND provider    = 'zapi';
  END IF;

  -- 7.8 Consentimento (sem contact_id — coluna inexistente)
  INSERT INTO public.whatsapp_consents (
    user_id, phone_e164, consent_type, source, consent_text, accepted_at
  ) VALUES (
    p_user_id, v_ver.phone_e164, 'geral', v_ver.source, v_consent_text, now()
  );

  -- 7.9 Marcar verificação
  UPDATE public.whatsapp_link_verifications
     SET status      = 'verified',
         verified_at = now()
   WHERE id = v_ver.id;

  -- 7.10 Enfileirar confirmação (falha isolada não desfaz vínculo)
  BEGIN
    INSERT INTO public.whatsapp_outbound_queue (
      user_id, contact_id, provider, instance_id, phone_e164,
      message_type, text_body, purpose,
      status, priority, attempts, max_attempts, scheduled_at
    ) VALUES (
      p_user_id, v_contact_id, 'zapi', v_use_instance, v_ver.phone_e164,
      'text',
      'Seu WhatsApp foi vinculado ao Jarvys com sucesso.',
      'link_confirm',
      'queued', 70, 0, 5, now()
    );
  EXCEPTION WHEN OTHERS THEN
    -- Não expor erro sensível; vínculo permanece válido
    RAISE WARNING 'link_confirm_enqueue_failed';
  END;

  RETURN QUERY SELECT 'ok'::text, v_contact_id, v_ver.phone_e164;
END;
$$;

-- 4. Grants restritos: apenas service_role
REVOKE ALL ON FUNCTION public.confirm_whatsapp_link_code(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_whatsapp_link_code(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_whatsapp_link_code(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_whatsapp_link_code(uuid, uuid, text) TO service_role;
