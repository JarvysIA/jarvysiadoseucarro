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
  v_ver           public.whatsapp_link_verifications%ROWTYPE;
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
  SELECT wlv.*
    INTO v_ver
    FROM public.whatsapp_link_verifications AS wlv
   WHERE wlv.id = p_verification_id
     AND wlv.user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.status = 'blocked' THEN
    RETURN QUERY SELECT 'blocked'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.status <> 'pending' THEN
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.expires_at <= now() THEN
    UPDATE public.whatsapp_link_verifications AS wlv
       SET status = 'expired'
     WHERE wlv.id = v_ver.id;
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.attempts >= v_ver.max_attempts THEN
    UPDATE public.whatsapp_link_verifications AS wlv
       SET status = 'blocked'
     WHERE wlv.id = v_ver.id;
    RETURN QUERY SELECT 'blocked'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.code_hash <> p_code_hash_candidate THEN
    v_new_attempts := v_ver.attempts + 1;
    IF v_new_attempts >= v_ver.max_attempts THEN
      UPDATE public.whatsapp_link_verifications AS wlv
         SET attempts = v_new_attempts,
             status   = 'blocked'
       WHERE wlv.id = v_ver.id;
    ELSE
      UPDATE public.whatsapp_link_verifications AS wlv
         SET attempts = v_new_attempts
       WHERE wlv.id = v_ver.id;
    END IF;
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT wc.id
    INTO v_conflict
    FROM public.whatsapp_contacts AS wc
   WHERE wc.phone_e164 = v_ver.phone_e164
     AND wc.unlinked_at IS NULL
     AND wc.user_id <> p_user_id
   LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RETURN QUERY SELECT 'phone_conflict'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT wc.id
    INTO v_other_active
    FROM public.whatsapp_contacts AS wc
   WHERE wc.user_id = p_user_id
     AND wc.unlinked_at IS NULL
     AND wc.phone_e164 <> v_ver.phone_e164
   LIMIT 1;

  IF v_other_active IS NOT NULL THEN
    RETURN QUERY SELECT 'user_has_other_active'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT wc.id,
         wc.unlinked_at,
         wc.assigned_instance_id,
         wc.assigned_whatsapp_number
    INTO v_existing
    FROM public.whatsapp_contacts AS wc
   WHERE wc.user_id = p_user_id
     AND wc.phone_e164 = v_ver.phone_e164
   FOR UPDATE;

  IF FOUND
     AND v_existing.unlinked_at IS NULL
     AND v_existing.assigned_instance_id IS NOT NULL THEN
    SELECT wpi.instance_id,
           wpi.phone_number_e164
      INTO v_instance
      FROM public.whatsapp_provider_instances AS wpi
     WHERE wpi.provider = 'zapi'
       AND wpi.instance_id = v_existing.assigned_instance_id
       AND wpi.status = 'active'
       AND wpi.health_status <> 'failed'
     LIMIT 1;

    IF NOT FOUND THEN
      SELECT wpi.instance_id,
             wpi.phone_number_e164
        INTO v_instance
        FROM public.whatsapp_provider_instances AS wpi
       WHERE wpi.provider = 'zapi'
         AND wpi.status = 'active'
         AND wpi.health_status <> 'failed'
         AND (wpi.max_users IS NULL OR wpi.current_users < wpi.max_users)
       ORDER BY wpi.is_default DESC, wpi.current_users ASC
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
    SELECT wpi.instance_id,
           wpi.phone_number_e164
      INTO v_instance
      FROM public.whatsapp_provider_instances AS wpi
     WHERE wpi.provider = 'zapi'
       AND wpi.status = 'active'
       AND wpi.health_status <> 'failed'
       AND (wpi.max_users IS NULL OR wpi.current_users < wpi.max_users)
     ORDER BY wpi.is_default DESC, wpi.current_users ASC
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
    RETURNING whatsapp_contacts.id INTO v_contact_id;
  ELSE
    UPDATE public.whatsapp_contacts AS wc
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
     WHERE wc.id = v_existing.id
    RETURNING wc.id INTO v_contact_id;
  END IF;

  IF v_needs_incr THEN
    UPDATE public.whatsapp_provider_instances AS wpi
       SET current_users = wpi.current_users + 1
     WHERE wpi.instance_id = v_use_instance
       AND wpi.provider    = 'zapi';
  END IF;

  INSERT INTO public.whatsapp_consents (
    user_id, phone_e164, consent_type, source, consent_text, accepted_at
  ) VALUES (
    p_user_id, v_ver.phone_e164, 'geral', v_ver.source, v_consent_text, now()
  );

  UPDATE public.whatsapp_link_verifications AS wlv
     SET status      = 'verified',
         verified_at = now()
   WHERE wlv.id = v_ver.id;

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
    RAISE WARNING 'link_confirm_enqueue_failed';
  END;

  RETURN QUERY SELECT 'ok'::text, v_contact_id, v_ver.phone_e164;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_whatsapp_link_code(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_whatsapp_link_code(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_whatsapp_link_code(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_whatsapp_link_code(uuid, uuid, text) TO service_role;