
-- ============================================================================
-- Build 5.7F2B2A — RPCs atômicas do orquestrador WhatsApp
-- claim_whatsapp_orchestrator_items + release_whatsapp_orchestrator_item
-- Ambas SECURITY DEFINER, search_path fixo, service_role apenas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CLAIM
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_whatsapp_orchestrator_items(
  p_worker_id      text,
  p_batch          integer DEFAULT 10,
  p_lease_seconds  integer DEFAULT 300
)
RETURNS TABLE (
  queue_id           uuid,
  message_id         uuid,
  contact_id         uuid,
  user_id            uuid,
  instance_pk        uuid,
  provider           text,
  instance_id        text,
  queue_type         text,
  message_type       text,
  attempts           integer,
  max_attempts       integer,
  lease_token        uuid,
  lease_expires_at   timestamptz,
  was_recovered      boolean,
  orchestrator_mode  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_now         timestamptz := now();
  v_count       integer := 0;
  v_cand        record;
  v_head        record;
  v_new_token   uuid;
  v_new_expiry  timestamptz;
  v_was_rec     boolean;
BEGIN
  -- Parameter validation (short, sanitized errors — no PII)
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' OR char_length(p_worker_id) > 64 THEN
    RAISE EXCEPTION 'INVALID_WORKER_ID' USING ERRCODE = 'check_violation';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 25 THEN
    RAISE EXCEPTION 'INVALID_BATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'INVALID_LEASE_SECONDS' USING ERRCODE = 'check_violation';
  END IF;

  -- Iterate candidates in strict head-of-line order across contacts.
  -- The candidate set below is the ELIGIBLE head per contact
  -- (text/inbound/instance test|active/processable/orchestrator NULL).
  -- Contatos cujo head não é elegível são omitidos daqui e continuam
  -- bloqueados para o novo claim, exatamente como especificado.
  FOR v_cand IN
    WITH heads AS (
      SELECT DISTINCT ON (m.contact_id)
             q.id           AS q_id,
             q.created_at   AS q_created,
             q.status       AS q_status,
             q.scheduled_at AS q_scheduled,
             q.lease_token  AS q_lease_token,
             q.lease_expires_at AS q_lease_expires_at,
             q.claimed_at   AS q_claimed_at,
             q.claimed_by   AS q_claimed_by,
             q.orchestrator_processed_at AS q_orch_pat,
             q.orchestrator_result       AS q_orch_res,
             q.orchestrator_version      AS q_orch_ver,
             q.message_id   AS q_message_id,
             m.contact_id   AS m_contact_id,
             m.message_type AS m_message_type,
             m.direction    AS m_direction,
             m.provider     AS m_provider,
             m.instance_id  AS m_instance_id
        FROM public.whatsapp_processing_queue q
        JOIN public.whatsapp_messages m ON m.id = q.message_id
       WHERE q.status IN ('queued','running')
         AND m.contact_id IS NOT NULL
       ORDER BY m.contact_id, q.created_at ASC, q.id ASC
    ),
    eligible AS (
      SELECT h.*, pi.id AS pi_id, pi.orchestrator_mode AS pi_mode
        FROM heads h
        JOIN public.whatsapp_provider_instances pi
          ON pi.provider    = h.m_provider
         AND pi.instance_id = h.m_instance_id
       WHERE h.m_direction    = 'inbound'
         AND h.m_message_type = 'text'
         AND pi.status = 'active'
         AND pi.orchestrator_mode IN ('test','active')
         AND h.q_orch_pat IS NULL
         AND h.q_orch_res IS NULL
         AND h.q_orch_ver IS NULL
         AND (
              (h.q_status = 'queued' AND h.q_scheduled <= v_now)
              OR
              (h.q_status = 'running'
                 AND h.q_lease_token IS NOT NULL
                 AND h.q_lease_expires_at IS NOT NULL
                 AND h.q_claimed_at IS NOT NULL
                 AND h.q_claimed_by IS NOT NULL
                 AND h.q_lease_expires_at <= v_now)
             )
    )
    SELECT * FROM eligible ORDER BY q_created ASC, q_id ASC
  LOOP
    -- Try to lock the contact row without blocking. LIMIT após SKIP LOCKED
    -- é obtido saltando contatos não bloqueáveis e contando somente sucesso.
    PERFORM 1
       FROM public.whatsapp_contacts c
      WHERE c.id = v_cand.m_contact_id
      FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Revalida o head deste contato após o lock, sem confiar no snapshot.
    SELECT q.id, q.status, q.scheduled_at, q.lease_token, q.lease_expires_at,
           q.claimed_at, q.claimed_by, q.attempts, q.max_attempts,
           q.queue_type, q.started_at,
           q.orchestrator_processed_at, q.orchestrator_result, q.orchestrator_version,
           q.message_id,
           m.contact_id, m.message_type, m.direction, m.provider, m.instance_id,
           m.user_id,
           pi.id AS pi_id, pi.orchestrator_mode AS pi_mode, pi.status AS pi_status
      INTO v_head
      FROM public.whatsapp_processing_queue q
      JOIN public.whatsapp_messages m ON m.id = q.message_id
      LEFT JOIN public.whatsapp_provider_instances pi
             ON pi.provider = m.provider AND pi.instance_id = m.instance_id
     WHERE q.status IN ('queued','running')
       AND m.contact_id = v_cand.m_contact_id
     ORDER BY q.created_at ASC, q.id ASC
     LIMIT 1;

    IF NOT FOUND OR v_head.id IS DISTINCT FROM v_cand.q_id THEN
      -- Head mudou desde o snapshot; não claimar item posterior deste contato.
      CONTINUE;
    END IF;

    -- Revalida elegibilidade (defesa em profundidade após o lock).
    IF v_head.direction    <> 'inbound'
       OR v_head.message_type <> 'text'
       OR v_head.pi_status    IS DISTINCT FROM 'active'
       OR v_head.pi_mode      NOT IN ('test','active')
       OR v_head.orchestrator_processed_at IS NOT NULL
       OR v_head.orchestrator_result       IS NOT NULL
       OR v_head.orchestrator_version      IS NOT NULL
    THEN
      CONTINUE;
    END IF;

    -- Determina se é claim novo (queued) ou retomada (running com lease expirado).
    IF v_head.status = 'queued' THEN
      IF v_head.scheduled_at > v_now THEN
        CONTINUE;
      END IF;
      v_was_rec := false;
    ELSIF v_head.status = 'running' THEN
      IF v_head.lease_token IS NULL
         OR v_head.lease_expires_at IS NULL
         OR v_head.claimed_at IS NULL
         OR v_head.claimed_by IS NULL
         OR v_head.lease_expires_at > v_now
      THEN
        -- Running legado sem lease, ou lease ainda válido: bloqueia o contato.
        CONTINUE;
      END IF;
      v_was_rec := true;
    ELSE
      CONTINUE;
    END IF;

    v_new_token  := gen_random_uuid();
    v_new_expiry := v_now + make_interval(secs => p_lease_seconds);

    -- UPDATE revalidando na WHERE que o item ainda está claimável.
    UPDATE public.whatsapp_processing_queue AS q
       SET status           = 'running',
           started_at       = COALESCE(q.started_at, v_now),
           lease_token      = v_new_token,
           lease_expires_at = v_new_expiry,
           claimed_at       = v_now,
           claimed_by       = p_worker_id
     WHERE q.id = v_head.id
       AND q.orchestrator_processed_at IS NULL
       AND q.orchestrator_result IS NULL
       AND q.orchestrator_version IS NULL
       AND (
            (NOT v_was_rec AND q.status = 'queued' AND q.scheduled_at <= v_now
             AND q.lease_token IS NULL)
            OR
            (v_was_rec AND q.status = 'running'
             AND q.lease_token IS NOT NULL
             AND q.lease_expires_at IS NOT NULL
             AND q.lease_expires_at <= v_now)
           )
    RETURNING q.attempts, q.max_attempts, q.queue_type
      INTO v_head.attempts, v_head.max_attempts, v_head.queue_type;

    IF NOT FOUND THEN
      -- Perdemos a disputa; NÃO tentar próximo item do mesmo contato.
      CONTINUE;
    END IF;

    queue_id          := v_head.id;
    message_id        := v_head.message_id;
    contact_id        := v_head.contact_id;
    user_id           := v_head.user_id;
    instance_pk       := v_head.pi_id;
    provider          := v_head.provider;
    instance_id       := v_head.instance_id;
    queue_type        := v_head.queue_type;
    message_type      := v_head.message_type;
    attempts          := v_head.attempts;
    max_attempts      := v_head.max_attempts;
    lease_token       := v_new_token;
    lease_expires_at  := v_new_expiry;
    was_recovered     := v_was_rec;
    orchestrator_mode := v_head.pi_mode;
    RETURN NEXT;

    v_count := v_count + 1;
    EXIT WHEN v_count >= p_batch;
  END LOOP;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_orchestrator_items(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_whatsapp_orchestrator_items(text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_whatsapp_orchestrator_items(text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_orchestrator_items(text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_whatsapp_orchestrator_items(text, integer, integer) IS
  'Build 5.7F2B2A: head-of-line claim por contato com lease. Não conectado ao worker.';


-- ---------------------------------------------------------------------------
-- RELEASE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_whatsapp_orchestrator_item(
  p_queue_item_id  uuid,
  p_lease_token    uuid,
  p_reason         text,
  p_retry_kind     text,
  p_delay_seconds  integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_now         timestamptz := now();
  v_item        record;
  v_new_attempts integer;
  v_orch_any    boolean;
  v_orch_all    boolean;
BEGIN
  IF p_queue_item_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_QUEUE_ITEM_ID' USING ERRCODE = 'check_violation';
  END IF;
  IF p_lease_token IS NULL THEN
    RAISE EXCEPTION 'INVALID_LEASE_TOKEN' USING ERRCODE = 'check_violation';
  END IF;
  IF p_reason IS NULL
     OR btrim(p_reason) = ''
     OR char_length(p_reason) > 120
     OR p_reason !~ '^[a-z0-9_.:-]+$'
  THEN
    RAISE EXCEPTION 'INVALID_REASON' USING ERRCODE = 'check_violation';
  END IF;
  IF p_retry_kind IS NULL
     OR p_retry_kind NOT IN ('transient_error','state_conflict','cancelled')
  THEN
    RAISE EXCEPTION 'INVALID_RETRY_KIND' USING ERRCODE = 'check_violation';
  END IF;
  IF p_delay_seconds IS NULL OR p_delay_seconds < 1 OR p_delay_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_DELAY_SECONDS' USING ERRCODE = 'check_violation';
  END IF;

  SELECT *
    INTO v_item
    FROM public.whatsapp_processing_queue
   WHERE id = p_queue_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'queue_item_not_found');
  END IF;

  -- Durable replay (antes de validar lease)
  IF v_item.status = 'done'
     AND v_item.orchestrator_processed_at IS NOT NULL
     AND v_item.orchestrator_result IS NOT NULL
     AND v_item.orchestrator_version IS NOT NULL
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'wasReplay', true,
      'orchestratorResult', v_item.orchestrator_result
    );
  END IF;

  -- Invariante orchestrator: todos NULL ou todos preenchidos com status='done'
  v_orch_any := v_item.orchestrator_processed_at IS NOT NULL
             OR v_item.orchestrator_result IS NOT NULL
             OR v_item.orchestrator_version IS NOT NULL;
  v_orch_all := v_item.orchestrator_processed_at IS NOT NULL
            AND v_item.orchestrator_result IS NOT NULL
            AND v_item.orchestrator_version IS NOT NULL;

  IF v_orch_any AND NOT (v_orch_all AND v_item.status = 'done') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invariant_violation');
  END IF;

  IF v_item.status IN ('done','failed','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_terminal');
  END IF;

  IF v_item.status <> 'running'
     OR v_item.lease_token IS DISTINCT FROM p_lease_token
     OR v_item.lease_expires_at IS NULL
     OR v_item.lease_expires_at <= v_now
     OR v_item.claimed_at IS NULL
     OR v_item.claimed_by IS NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lease_lost');
  END IF;

  IF p_retry_kind = 'transient_error' THEN
    v_new_attempts := v_item.attempts + 1;
    IF v_new_attempts >= v_item.max_attempts THEN
      UPDATE public.whatsapp_processing_queue
         SET attempts         = v_new_attempts,
             status           = 'failed',
             finished_at      = v_now,
             error_message    = p_reason,
             lease_token      = NULL,
             lease_expires_at = NULL,
             claimed_at       = NULL,
             claimed_by       = NULL
       WHERE id = p_queue_item_id;
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'failed',
        'attempts', v_new_attempts,
        'willRetry', false
      );
    ELSE
      UPDATE public.whatsapp_processing_queue
         SET attempts         = v_new_attempts,
             status           = 'queued',
             scheduled_at     = v_now + make_interval(secs => p_delay_seconds),
             finished_at      = NULL,
             error_message    = p_reason,
             lease_token      = NULL,
             lease_expires_at = NULL,
             claimed_at       = NULL,
             claimed_by       = NULL
       WHERE id = p_queue_item_id;
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'queued',
        'attempts', v_new_attempts,
        'willRetry', true
      );
    END IF;

  ELSIF p_retry_kind = 'state_conflict' THEN
    UPDATE public.whatsapp_processing_queue
       SET status           = 'queued',
           scheduled_at     = v_now + make_interval(secs => p_delay_seconds),
           finished_at      = NULL,
           error_message    = p_reason,
           lease_token      = NULL,
           lease_expires_at = NULL,
           claimed_at       = NULL,
           claimed_by       = NULL
     WHERE id = p_queue_item_id;
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'queued',
      'attempts', v_item.attempts,
      'willRetry', true
    );

  ELSE -- cancelled
    UPDATE public.whatsapp_processing_queue
       SET status           = 'cancelled',
           finished_at      = v_now,
           error_message    = p_reason,
           lease_token      = NULL,
           lease_expires_at = NULL,
           claimed_at       = NULL,
           claimed_by       = NULL
     WHERE id = p_queue_item_id;
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'cancelled',
      'attempts', v_item.attempts,
      'willRetry', false
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_whatsapp_orchestrator_item(uuid, uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_whatsapp_orchestrator_item(uuid, uuid, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.release_whatsapp_orchestrator_item(uuid, uuid, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_whatsapp_orchestrator_item(uuid, uuid, text, text, integer) TO service_role;

COMMENT ON FUNCTION public.release_whatsapp_orchestrator_item(uuid, uuid, text, text, integer) IS
  'Build 5.7F2B2A: release/retry seguro do orquestrador WhatsApp. Não conectado ao worker.';
