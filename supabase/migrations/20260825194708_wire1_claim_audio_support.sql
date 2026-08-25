-- WIRE-1 — claim_whatsapp_orchestrator_items passa a aceitar também
-- message_type='audio', além de 'text'. Motivo: o wiring do orquestrador
-- pra voz (WIRE-2, ainda não feito) precisa que a RPC de claim de fato
-- reivindique itens de áudio; hoje ela filtra estritamente por
-- message_type = 'text' em dois pontos redundantes (defesa em
-- profundidade), então nenhuma mensagem de voz jamais chega a ser
-- claimed, independente de qualquer wiring do lado TypeScript.
--
-- Mudança: idêntica à definição vigente (migration
-- 20260712032126_105c0148-525d-4fb3-8a6d-7cdd2d9efbce.sql), exceto pelas
-- 2 linhas do filtro de message_type:
--   (a) dentro da CTE "eligible" (snapshot inicial):
--       AND h.m_message_type = 'text'
--       vira
--       AND h.m_message_type IN ('text', 'audio')
--   (b) na revalidação pós-lock (defesa em profundidade):
--       OR v_head.message_type <> 'text'
--       vira
--       OR v_head.message_type NOT IN ('text', 'audio')
--
-- Assinatura, tipo de retorno (15 colunas), SECURITY DEFINER, search_path,
-- route_owner='orchestrator', ordem de locks, lease/lock, idempotência,
-- reason codes, attempts e todos os demais filtros permanecem IDÊNTICOS.
-- Grants preservados automaticamente pelo Postgres (CREATE OR REPLACE
-- não reseta GRANT/REVOKE de uma função já existente com a mesma
-- assinatura) — não é necessário repetir REVOKE/GRANT aqui.
--
-- Fora de escopo (não tocado por esta migration): image/pdf/video/file
-- continuam fora do filtro; apply_whatsapp_orchestrator_transition e
-- release_whatsapp_orchestrator_item não são alterados; nenhum arquivo
-- TypeScript é alterado (o wiring do lado TS é WIRE-2, build separado).
CREATE OR REPLACE FUNCTION public.claim_whatsapp_orchestrator_items(
  p_worker_id text,
  p_batch integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE(
  queue_id uuid,
  message_id uuid,
  contact_id uuid,
  user_id uuid,
  instance_pk uuid,
  provider text,
  instance_id text,
  queue_type text,
  message_type text,
  attempts integer,
  max_attempts integer,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  was_recovered boolean,
  orchestrator_mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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
  IF p_worker_id IS NULL OR btrim(p_worker_id) = '' OR char_length(p_worker_id) > 64 THEN
    RAISE EXCEPTION 'INVALID_WORKER_ID' USING ERRCODE = 'check_violation';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 25 THEN
    RAISE EXCEPTION 'INVALID_BATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'INVALID_LEASE_SECONDS' USING ERRCODE = 'check_violation';
  END IF;

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
         AND q.route_owner = 'orchestrator'
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
         AND h.m_message_type IN ('text', 'audio')
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
    PERFORM 1
       FROM public.whatsapp_contacts c
      WHERE c.id = v_cand.m_contact_id
      FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

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
       AND q.route_owner = 'orchestrator'
       AND m.contact_id = v_cand.m_contact_id
     ORDER BY q.created_at ASC, q.id ASC
     LIMIT 1;

    IF NOT FOUND OR v_head.id IS DISTINCT FROM v_cand.q_id THEN
      CONTINUE;
    END IF;

    IF v_head.direction    <> 'inbound'
       OR v_head.message_type NOT IN ('text', 'audio')
       OR v_head.pi_status    IS DISTINCT FROM 'active'
       OR v_head.pi_mode      NOT IN ('test','active')
       OR v_head.orchestrator_processed_at IS NOT NULL
       OR v_head.orchestrator_result       IS NOT NULL
       OR v_head.orchestrator_version      IS NOT NULL
    THEN
      CONTINUE;
    END IF;

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
        CONTINUE;
      END IF;
      v_was_rec := true;
    ELSE
      CONTINUE;
    END IF;

    v_new_token  := gen_random_uuid();
    v_new_expiry := v_now + make_interval(secs => p_lease_seconds);

    UPDATE public.whatsapp_processing_queue AS q
       SET status           = 'running',
           started_at       = COALESCE(q.started_at, v_now),
           lease_token      = v_new_token,
           lease_expires_at = v_new_expiry,
           claimed_at       = v_now,
           claimed_by       = p_worker_id
     WHERE q.id = v_head.id
       AND q.route_owner = 'orchestrator'
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
