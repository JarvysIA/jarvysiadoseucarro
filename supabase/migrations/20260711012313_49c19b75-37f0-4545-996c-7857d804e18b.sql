
-- 1) Ampliar CHECK de whatsapp_link_verifications.source para aceitar 'change_number'
ALTER TABLE public.whatsapp_link_verifications DROP CONSTRAINT IF EXISTS wlv_source_valid;
ALTER TABLE public.whatsapp_link_verifications
  ADD CONSTRAINT wlv_source_valid
  CHECK (source = ANY (ARRAY['onboarding'::text, 'app_settings'::text, 'change_number'::text]));

-- 2) Ampliar CHECK de whatsapp_consents.source para aceitar 'change_number'
ALTER TABLE public.whatsapp_consents DROP CONSTRAINT IF EXISTS wcs_source_chk;
ALTER TABLE public.whatsapp_consents
  ADD CONSTRAINT wcs_source_chk
  CHECK (source = ANY (ARRAY[
    'app_signup'::text, 'app_settings'::text, 'whatsapp_reply'::text,
    'onboarding'::text, 'checkout'::text, 'activation'::text, 'system'::text,
    'change_number'::text
  ]));

-- 3) Índice parcial: no máximo 1 verification pending 'relink' por usuário
CREATE UNIQUE INDEX IF NOT EXISTS uq_wlv_pending_relink_per_user
  ON public.whatsapp_link_verifications (user_id)
  WHERE status = 'pending' AND purpose = 'relink';

-- 4) RPC dedicada para troca de número: confirm_whatsapp_phone_change
CREATE OR REPLACE FUNCTION public.confirm_whatsapp_phone_change(
  p_user_id uuid,
  p_verification_id uuid,
  p_code_hash_candidate text
)
RETURNS TABLE(result text, new_contact_id uuid, old_contact_id uuid, new_phone_e164 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ver              public.whatsapp_link_verifications%ROWTYPE;
  v_old_contact      public.whatsapp_contacts%ROWTYPE;
  v_active_count     integer;
  v_conflict         uuid;
  v_hist             public.whatsapp_contacts%ROWTYPE;
  v_new_phone_e164   text;
  v_old_phone_e164   text;
  v_old_contact_id   uuid;
  v_new_contact_id   uuid;
  v_old_instance_id  text;
  v_new_instance_id  text;
  v_new_number       text;
  v_inst_new         public.whatsapp_provider_instances%ROWTYPE;
  v_inst_old         public.whatsapp_provider_instances%ROWTYPE;
  v_same_instance    boolean;
  v_new_attempts     integer;
  v_consent_revoke_txt constant text :=
    'v1: Encerrei o vínculo do WhatsApp anterior ao trocar de número pelo Jarvys.';
  v_consent_accept_txt constant text :=
    'v1: Aceito receber mensagens do Jarvys no novo número do WhatsApp.';
BEGIN
  -- 1) Verification: SELECT ... FOR UPDATE, escopo por user
  SELECT wlv.*
    INTO v_ver
    FROM public.whatsapp_link_verifications AS wlv
   WHERE wlv.id = p_verification_id
     AND wlv.user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.status = 'blocked' THEN
    RETURN QUERY SELECT 'blocked'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.status <> 'pending'
     OR v_ver.purpose <> 'relink'
     OR v_ver.source  <> 'change_number' THEN
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.expires_at <= now() THEN
    UPDATE public.whatsapp_link_verifications AS wlv
       SET status = 'expired'
     WHERE wlv.id = v_ver.id;
    RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF v_ver.attempts >= v_ver.max_attempts THEN
    UPDATE public.whatsapp_link_verifications AS wlv
       SET status = 'blocked'
     WHERE wlv.id = v_ver.id;
    RETURN QUERY SELECT 'blocked'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- 2) Hash: comparação constante do lado do PL
  IF v_ver.code_hash <> p_code_hash_candidate THEN
    v_new_attempts := v_ver.attempts + 1;
    IF v_new_attempts >= v_ver.max_attempts THEN
      UPDATE public.whatsapp_link_verifications AS wlv
         SET attempts = v_new_attempts, status = 'blocked'
       WHERE wlv.id = v_ver.id;
      RETURN QUERY SELECT 'blocked'::text, NULL::uuid, NULL::uuid, NULL::text;
    ELSE
      UPDATE public.whatsapp_link_verifications AS wlv
         SET attempts = v_new_attempts
       WHERE wlv.id = v_ver.id;
      RETURN QUERY SELECT 'invalid_or_expired'::text, NULL::uuid, NULL::uuid, NULL::text;
    END IF;
    RETURN;
  END IF;

  v_new_phone_e164 := v_ver.phone_e164;

  -- 3) Contato antigo ativo (invariante: exatamente 1)
  SELECT COUNT(*)
    INTO v_active_count
    FROM public.whatsapp_contacts AS wc
   WHERE wc.user_id = p_user_id
     AND wc.verified_at IS NOT NULL
     AND wc.unlinked_at IS NULL;

  IF v_active_count = 0 THEN
    RETURN QUERY SELECT 'no_active_contact'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  ELSIF v_active_count > 1 THEN
    RETURN QUERY SELECT 'internal_error'::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT wc.*
    INTO v_old_contact
    FROM public.whatsapp_contacts AS wc
   WHERE wc.user_id = p_user_id
     AND wc.verified_at IS NOT NULL
     AND wc.unlinked_at IS NULL
   FOR UPDATE;

  v_old_contact_id  := v_old_contact.id;
  v_old_phone_e164  := v_old_contact.phone_e164;
  v_old_instance_id := v_old_contact.assigned_instance_id;

  IF v_old_phone_e164 = v_new_phone_e164 THEN
    RETURN QUERY SELECT 'same_phone'::text, NULL::uuid, v_old_contact_id, NULL::text;
    RETURN;
  END IF;

  -- 4) Conflito: novo phone já ativo em outro user
  SELECT wc.id
    INTO v_conflict
    FROM public.whatsapp_contacts AS wc
   WHERE wc.phone_e164 = v_new_phone_e164
     AND wc.unlinked_at IS NULL
     AND wc.user_id <> p_user_id
   LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RETURN QUERY SELECT 'phone_conflict'::text, NULL::uuid, v_old_contact_id, NULL::text;
    RETURN;
  END IF;

  -- 5) Contato histórico do mesmo user com o novo phone (FOR UPDATE)
  SELECT wc.*
    INTO v_hist
    FROM public.whatsapp_contacts AS wc
   WHERE wc.user_id = p_user_id
     AND wc.phone_e164 = v_new_phone_e164
   FOR UPDATE;

  -- 6) Resolver instância candidata NOVA (sem lock ainda)
  IF FOUND AND v_hist.assigned_instance_id IS NOT NULL THEN
    SELECT wpi.*
      INTO v_inst_new
      FROM public.whatsapp_provider_instances AS wpi
     WHERE wpi.provider = 'zapi'
       AND wpi.instance_id = v_hist.assigned_instance_id
       AND wpi.status = 'active'
       AND wpi.health_status <> 'failed';
    IF NOT FOUND THEN
      v_inst_new := NULL;
    END IF;
  END IF;

  IF v_inst_new.instance_id IS NULL THEN
    SELECT wpi.*
      INTO v_inst_new
      FROM public.whatsapp_provider_instances AS wpi
     WHERE wpi.provider = 'zapi'
       AND wpi.status = 'active'
       AND wpi.health_status <> 'failed'
       AND (wpi.max_users IS NULL OR wpi.current_users < wpi.max_users)
     ORDER BY wpi.is_default DESC, wpi.current_users ASC
     LIMIT 1;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'no_instance_available'::text, NULL::uuid, v_old_contact_id, NULL::text;
      RETURN;
    END IF;
  END IF;

  v_new_instance_id := v_inst_new.instance_id;
  v_new_number      := v_inst_new.phone_number_e164;
  v_same_instance   := (v_old_instance_id = v_new_instance_id);

  -- 7) Locks determinísticos em whatsapp_provider_instances por ORDER BY instance_id
  IF v_same_instance THEN
    SELECT wpi.*
      INTO v_inst_new
      FROM public.whatsapp_provider_instances AS wpi
     WHERE wpi.provider = 'zapi'
       AND wpi.instance_id = v_new_instance_id
     FOR UPDATE;
    v_inst_old := v_inst_new;
  ELSE
    -- trava as duas linhas em ordem determinística
    PERFORM 1
      FROM public.whatsapp_provider_instances AS wpi
     WHERE wpi.provider = 'zapi'
       AND wpi.instance_id IN (v_old_instance_id, v_new_instance_id)
     ORDER BY wpi.instance_id
     FOR UPDATE;

    SELECT wpi.* INTO v_inst_new
      FROM public.whatsapp_provider_instances AS wpi
     WHERE wpi.provider='zapi' AND wpi.instance_id=v_new_instance_id;

    SELECT wpi.* INTO v_inst_old
      FROM public.whatsapp_provider_instances AS wpi
     WHERE wpi.provider='zapi' AND wpi.instance_id=v_old_instance_id;
  END IF;

  -- 8) Revalidar pós-lock
  IF v_inst_new.status <> 'active'
     OR v_inst_new.health_status = 'failed'
     OR (v_inst_new.max_users IS NOT NULL AND v_inst_new.current_users >= v_inst_new.max_users AND NOT v_same_instance) THEN
    RETURN QUERY SELECT 'no_instance_available'::text, NULL::uuid, v_old_contact_id, NULL::text;
    RETURN;
  END IF;

  v_new_number := v_inst_new.phone_number_e164;

  -- 9) Encerrar contato antigo
  UPDATE public.whatsapp_contacts AS wc
     SET unlinked_at = now(),
         is_primary  = false,
         opt_in      = false,
         opt_out     = true,
         opt_out_at  = now()
   WHERE wc.id = v_old_contact_id;

  -- 10) Criar ou reativar contato novo (respeita UNIQUE(user_id, phone_e164))
  IF v_hist.id IS NULL THEN
    INSERT INTO public.whatsapp_contacts (
      user_id, phone_e164, verified_at, unlinked_at, is_primary,
      opt_in, opt_out, opt_out_at,
      opt_in_source, opt_in_at,
      assigned_provider, assigned_instance_id, assigned_whatsapp_number
    ) VALUES (
      p_user_id, v_new_phone_e164, now(), NULL, true,
      true, false, NULL,
      'change_number', now(),
      'zapi', v_new_instance_id, v_new_number
    )
    RETURNING whatsapp_contacts.id INTO v_new_contact_id;
  ELSE
    UPDATE public.whatsapp_contacts AS wc
       SET verified_at              = now(),
           unlinked_at              = NULL,
           is_primary               = true,
           opt_in                   = true,
           opt_out                  = false,
           opt_out_at               = NULL,
           opt_in_source            = 'change_number',
           opt_in_at                = now(),
           assigned_provider        = 'zapi',
           assigned_instance_id     = v_new_instance_id,
           assigned_whatsapp_number = v_new_number
     WHERE wc.id = v_hist.id
    RETURNING wc.id INTO v_new_contact_id;
  END IF;

  -- 11) Consentimentos append-only
  INSERT INTO public.whatsapp_consents (
    user_id, phone_e164, consent_type, source, consent_text, revoked_at
  ) VALUES (
    p_user_id, v_old_phone_e164, 'geral', 'change_number', v_consent_revoke_txt, now()
  );

  INSERT INTO public.whatsapp_consents (
    user_id, phone_e164, consent_type, source, consent_text, accepted_at
  ) VALUES (
    p_user_id, v_new_phone_e164, 'geral', 'change_number', v_consent_accept_txt, now()
  );

  -- 12) Verification -> verified
  UPDATE public.whatsapp_link_verifications AS wlv
     SET status = 'verified', verified_at = now()
   WHERE wlv.id = v_ver.id;

  -- 13) profiles.whatsapp <- v_new_phone_e164
  UPDATE public.profiles AS p
     SET whatsapp = v_new_phone_e164
   WHERE p.id = p_user_id;

  -- 14) current_users: delta zero se mesma instância; -1/+1 se diferentes
  IF NOT v_same_instance THEN
    UPDATE public.whatsapp_provider_instances AS wpi
       SET current_users = GREATEST(wpi.current_users - 1, 0)
     WHERE wpi.provider = 'zapi' AND wpi.instance_id = v_old_instance_id;

    UPDATE public.whatsapp_provider_instances AS wpi
       SET current_users = wpi.current_users + 1
     WHERE wpi.provider = 'zapi' AND wpi.instance_id = v_new_instance_id;
  END IF;

  -- 15) Outbound link_confirm no novo número (não aborta a troca em falha)
  BEGIN
    INSERT INTO public.whatsapp_outbound_queue (
      user_id, contact_id, provider, instance_id, phone_e164,
      message_type, text_body, purpose,
      status, priority, attempts, max_attempts, scheduled_at
    ) VALUES (
      p_user_id, v_new_contact_id, 'zapi', v_new_instance_id, v_new_phone_e164,
      'text',
      'Seu número do WhatsApp Jarvys foi alterado com sucesso.',
      'link_confirm',
      'queued', 70, 0, 5, now()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'phone_change_link_confirm_enqueue_failed';
  END;

  RETURN QUERY SELECT 'ok'::text, v_new_contact_id, v_old_contact_id, v_new_phone_e164;
END;
$function$;

-- Grants: service_role only
REVOKE ALL ON FUNCTION public.confirm_whatsapp_phone_change(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_whatsapp_phone_change(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_whatsapp_phone_change(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_whatsapp_phone_change(uuid, uuid, text) TO service_role;
