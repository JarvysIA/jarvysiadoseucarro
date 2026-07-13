
-- Build 5.7F2E1A.5-MJ1 — Infra backend-only de solicitações Jarvys de KM.
-- Tabela + 5 funções SECURITY DEFINER (service_role). Nenhuma policy cliente.
-- Não conectada ao worker/sender/core. Nenhum grant a authenticated.

CREATE TABLE public.whatsapp_km_prompt_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_message_id uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  vehicle_id uuid NOT NULL REFERENCES public.veiculos(id) ON DELETE RESTRICT,
  status text NOT NULL,
  reserved_draft_id uuid NULL REFERENCES public.whatsapp_messages(id) ON DELETE RESTRICT,
  reserved_at timestamptz NULL,
  pending_at timestamptz NULL,
  expires_at timestamptz NULL,
  consumed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  expired_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_km_prompt_requests_status_check CHECK (
    status IN ('queued','pending','reserved','consumed','expired','cancelled')
  ),
  CONSTRAINT whatsapp_km_prompt_requests_shape_check CHECK (
    (status = 'queued'
      AND pending_at IS NULL AND expires_at IS NULL
      AND reserved_draft_id IS NULL AND reserved_at IS NULL
      AND consumed_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL)
    OR (status = 'pending'
      AND pending_at IS NOT NULL AND expires_at IS NOT NULL
      AND expires_at > pending_at
      AND reserved_draft_id IS NULL AND reserved_at IS NULL
      AND consumed_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL)
    OR (status = 'reserved'
      AND pending_at IS NOT NULL AND expires_at IS NOT NULL
      AND reserved_draft_id IS NOT NULL AND reserved_at IS NOT NULL
      AND reserved_at >= pending_at
      AND consumed_at IS NULL AND cancelled_at IS NULL AND expired_at IS NULL)
    OR (status = 'consumed'
      AND pending_at IS NOT NULL AND expires_at IS NOT NULL
      AND reserved_draft_id IS NOT NULL AND reserved_at IS NOT NULL
      AND consumed_at IS NOT NULL AND consumed_at >= reserved_at
      AND cancelled_at IS NULL AND expired_at IS NULL)
    OR (status = 'expired'
      AND pending_at IS NOT NULL AND expires_at IS NOT NULL
      AND expired_at IS NOT NULL AND expired_at >= expires_at
      AND reserved_draft_id IS NULL AND reserved_at IS NULL
      AND consumed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND cancelled_at >= created_at
      AND consumed_at IS NULL AND expired_at IS NULL
      AND (
        (pending_at IS NULL AND expires_at IS NULL
          AND reserved_draft_id IS NULL AND reserved_at IS NULL)
        OR
        (pending_at IS NOT NULL AND expires_at IS NOT NULL
          AND cancelled_at >= pending_at
          AND reserved_draft_id IS NULL AND reserved_at IS NULL)
        OR
        (pending_at IS NOT NULL AND expires_at IS NOT NULL
          AND reserved_draft_id IS NOT NULL AND reserved_at IS NOT NULL
          AND cancelled_at >= reserved_at)
      )
    )
  )
);

ALTER TABLE public.whatsapp_km_prompt_requests OWNER TO postgres;

CREATE UNIQUE INDEX whatsapp_km_prompt_requests_prompt_message_id_uk
  ON public.whatsapp_km_prompt_requests (prompt_message_id);

CREATE UNIQUE INDEX whatsapp_km_prompt_requests_reserved_draft_id_uk
  ON public.whatsapp_km_prompt_requests (reserved_draft_id)
  WHERE reserved_draft_id IS NOT NULL;

CREATE INDEX whatsapp_km_prompt_requests_contact_status_created_idx
  ON public.whatsapp_km_prompt_requests (contact_id, status, created_at DESC);

CREATE INDEX whatsapp_km_prompt_requests_vehicle_status_idx
  ON public.whatsapp_km_prompt_requests (vehicle_id, status);

CREATE INDEX whatsapp_km_prompt_requests_pending_expiry_idx
  ON public.whatsapp_km_prompt_requests (status, expires_at)
  WHERE status = 'pending';

ALTER TABLE public.whatsapp_km_prompt_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_km_prompt_requests FROM PUBLIC;
REVOKE ALL ON public.whatsapp_km_prompt_requests FROM anon;
REVOKE ALL ON public.whatsapp_km_prompt_requests FROM authenticated;

COMMENT ON TABLE public.whatsapp_km_prompt_requests IS
  'Build 5.7F2E1A.5-MJ1 — Infra backend-only de solicitações Jarvys de KM. Identidade pela mensagem outbound (prompt_message_id). Acesso exclusivo por funções SECURITY DEFINER de service_role; não é acessível ao cliente. Ainda desconectada do runtime.';
COMMENT ON COLUMN public.whatsapp_km_prompt_requests.prompt_message_id IS
  'Identidade da outbound Jarvys que solicitou o KM. UNIQUE. FK RESTRICT.';
COMMENT ON COLUMN public.whatsapp_km_prompt_requests.reserved_draft_id IS
  'Mensagem inbound T1 que reservou o prompt. UNIQUE parcial. FK RESTRICT.';
COMMENT ON COLUMN public.whatsapp_km_prompt_requests.status IS
  'Lifecycle fechado: queued|pending|reserved|consumed|expired|cancelled. pending exige outbound sent; validade = pending_at + 7 dias.';

-- ============================================================
-- 1) CREATE
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_whatsapp_km_prompt_request(
  p_prompt_message_id uuid,
  p_contact_id uuid,
  p_user_id uuid,
  p_vehicle_id uuid
)
RETURNS TABLE(result text, request_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_msg record;
  v_contact record;
  v_vehicle record;
  v_existing record;
  v_new_id uuid;
BEGIN
  SELECT id, direction, contact_id, user_id, vehicle_id
    INTO v_msg
    FROM public.whatsapp_messages
    WHERE id = p_prompt_message_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'prompt_message_not_found'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_msg.direction <> 'outbound' THEN
    RETURN QUERY SELECT 'prompt_message_not_outbound'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_msg.contact_id IS DISTINCT FROM p_contact_id
     OR v_msg.user_id IS DISTINCT FROM p_user_id
     OR v_msg.vehicle_id IS DISTINCT FROM p_vehicle_id THEN
    RETURN QUERY SELECT 'prompt_context_mismatch'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT id, user_id INTO v_contact
    FROM public.whatsapp_contacts WHERE id = p_contact_id;
  IF NOT FOUND OR v_contact.user_id IS DISTINCT FROM p_user_id THEN
    RETURN QUERY SELECT 'prompt_context_mismatch'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT id, user_id, status INTO v_vehicle
    FROM public.veiculos WHERE id = p_vehicle_id;
  IF NOT FOUND OR v_vehicle.user_id IS DISTINCT FROM p_user_id THEN
    RETURN QUERY SELECT 'prompt_context_mismatch'::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_vehicle.status = 'archived' THEN
    RETURN QUERY SELECT 'vehicle_archived'::text, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_km_prompt_requests
    (prompt_message_id, contact_id, user_id, vehicle_id, status)
  VALUES
    (p_prompt_message_id, p_contact_id, p_user_id, p_vehicle_id, 'queued')
  ON CONFLICT (prompt_message_id) DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN QUERY SELECT 'created'::text, v_new_id;
    RETURN;
  END IF;

  SELECT * INTO v_existing
    FROM public.whatsapp_km_prompt_requests
    WHERE prompt_message_id = p_prompt_message_id
    FOR UPDATE;

  IF v_existing.contact_id = p_contact_id
     AND v_existing.user_id = p_user_id
     AND v_existing.vehicle_id = p_vehicle_id THEN
    RETURN QUERY SELECT 'replayed'::text, v_existing.id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'already_exists_with_different_context'::text, v_existing.id;
END;
$fn$;

ALTER FUNCTION public.create_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.create_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid) IS
  'MJ1: Cria request queued idempotente por prompt_message_id. Backend-only, service_role. Não conectada ao runtime.';

-- ============================================================
-- 2) PROMOTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.promote_whatsapp_km_prompt_request_to_pending(
  p_prompt_message_id uuid
)
RETURNS TABLE(result text, request_id uuid, pending_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_req record;
  v_msg record;
  v_now timestamptz;
BEGIN
  SELECT * INTO v_req
    FROM public.whatsapp_km_prompt_requests
    WHERE prompt_message_id = p_prompt_message_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT id, direction, status, contact_id, user_id, vehicle_id
    INTO v_msg
    FROM public.whatsapp_messages
    WHERE id = p_prompt_message_id;
  IF NOT FOUND
     OR v_msg.direction <> 'outbound'
     OR v_msg.contact_id IS DISTINCT FROM v_req.contact_id
     OR v_msg.user_id IS DISTINCT FROM v_req.user_id
     OR v_msg.vehicle_id IS DISTINCT FROM v_req.vehicle_id THEN
    RETURN QUERY SELECT 'prompt_context_mismatch'::text, v_req.id, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_req.status = 'pending' THEN
    IF v_msg.status <> 'sent' THEN
      RETURN QUERY SELECT 'prompt_message_not_sent'::text, v_req.id, NULL::timestamptz, NULL::timestamptz;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'already_pending'::text, v_req.id, v_req.pending_at, v_req.expires_at;
    RETURN;
  END IF;

  IF v_req.status <> 'queued' THEN
    RETURN QUERY SELECT 'not_queued'::text, v_req.id, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_msg.status <> 'sent' THEN
    RETURN QUERY SELECT 'prompt_message_not_sent'::text, v_req.id, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  v_now := now();
  UPDATE public.whatsapp_km_prompt_requests
    SET status = 'pending',
        pending_at = v_now,
        expires_at = v_now + interval '7 days'
    WHERE id = v_req.id;

  RETURN QUERY SELECT 'promoted'::text, v_req.id, v_now, v_now + interval '7 days';
END;
$fn$;

ALTER FUNCTION public.promote_whatsapp_km_prompt_request_to_pending(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.promote_whatsapp_km_prompt_request_to_pending(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_whatsapp_km_prompt_request_to_pending(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.promote_whatsapp_km_prompt_request_to_pending(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.promote_whatsapp_km_prompt_request_to_pending(uuid) TO service_role;
COMMENT ON FUNCTION public.promote_whatsapp_km_prompt_request_to_pending(uuid) IS
  'MJ1: Promove queued→pending após outbound sent. Validade = 7 dias. Backend-only, service_role.';

-- ============================================================
-- 3) RESERVE
-- ============================================================

CREATE OR REPLACE FUNCTION public.reserve_whatsapp_km_prompt_request(
  p_prompt_message_id uuid,
  p_contact_id uuid,
  p_user_id uuid,
  p_vehicle_id uuid,
  p_draft_id uuid
)
RETURNS TABLE(result text, request_id uuid, reserved_draft_id uuid, reserved_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_req record;
  v_msg record;
  v_draft record;
  v_now timestamptz;
BEGIN
  SELECT * INTO v_req
    FROM public.whatsapp_km_prompt_requests
    WHERE prompt_message_id = p_prompt_message_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'prompt_not_found'::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT id, direction, status, contact_id, user_id, vehicle_id
    INTO v_msg
    FROM public.whatsapp_messages
    WHERE id = p_prompt_message_id;
  IF NOT FOUND
     OR v_msg.direction <> 'outbound'
     OR v_msg.contact_id IS DISTINCT FROM p_contact_id
     OR v_msg.user_id IS DISTINCT FROM p_user_id
     OR v_msg.vehicle_id IS DISTINCT FROM p_vehicle_id
     OR v_req.contact_id IS DISTINCT FROM p_contact_id
     OR v_req.user_id IS DISTINCT FROM p_user_id
     OR v_req.vehicle_id IS DISTINCT FROM p_vehicle_id THEN
    RETURN QUERY SELECT 'prompt_context_mismatch'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_msg.status <> 'sent' THEN
    RETURN QUERY SELECT 'prompt_message_not_sent'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT id, direction, contact_id, user_id, vehicle_id
    INTO v_draft
    FROM public.whatsapp_messages
    WHERE id = p_draft_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'draft_message_not_found'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_draft.direction <> 'inbound' THEN
    RETURN QUERY SELECT 'draft_message_not_inbound'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_draft.contact_id IS DISTINCT FROM p_contact_id
     OR v_draft.user_id IS DISTINCT FROM p_user_id
     OR (v_draft.vehicle_id IS NOT NULL AND v_draft.vehicle_id IS DISTINCT FROM p_vehicle_id) THEN
    RETURN QUERY SELECT 'draft_context_mismatch'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  v_now := now();

  IF v_req.status = 'queued' THEN
    RETURN QUERY SELECT 'prompt_not_pending'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_req.status = 'cancelled' THEN
    RETURN QUERY SELECT 'prompt_cancelled'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_req.status = 'expired' THEN
    RETURN QUERY SELECT 'prompt_expired'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_req.status = 'reserved' THEN
    IF v_req.reserved_draft_id = p_draft_id THEN
      RETURN QUERY SELECT 'replayed'::text, v_req.id, v_req.reserved_draft_id, v_req.reserved_at;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'prompt_reserved_by_other_draft'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_req.status = 'consumed' THEN
    IF v_req.reserved_draft_id = p_draft_id THEN
      RETURN QUERY SELECT 'replayed'::text, v_req.id, v_req.reserved_draft_id, v_req.reserved_at;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'prompt_consumed'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- status = 'pending'
  IF v_req.expires_at <= v_now THEN
    UPDATE public.whatsapp_km_prompt_requests
      SET status = 'expired', expired_at = v_now
      WHERE id = v_req.id;
    RETURN QUERY SELECT 'prompt_expired'::text, v_req.id, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE public.whatsapp_km_prompt_requests
    SET status = 'reserved',
        reserved_draft_id = p_draft_id,
        reserved_at = v_now
    WHERE id = v_req.id;

  RETURN QUERY SELECT 'reserved'::text, v_req.id, p_draft_id, v_now;
END;
$fn$;

ALTER FUNCTION public.reserve_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid,uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.reserve_whatsapp_km_prompt_request(uuid,uuid,uuid,uuid,uuid) IS
  'MJ1: Reserva prompt pending para uma T1. Serialização por lock da request. Replay do mesmo draft; conflito de outro. Backend-only, service_role.';

-- ============================================================
-- 4) CANCEL
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_whatsapp_km_prompt_request(
  p_prompt_message_id uuid
)
RETURNS TABLE(result text, request_id uuid, cancelled_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_req record;
  v_now timestamptz;
BEGIN
  SELECT * INTO v_req
    FROM public.whatsapp_km_prompt_requests
    WHERE prompt_message_id = p_prompt_message_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_req.status IN ('consumed','expired','cancelled') THEN
    RETURN QUERY SELECT 'already_terminal'::text, v_req.id, v_req.cancelled_at;
    RETURN;
  END IF;

  v_now := now();
  UPDATE public.whatsapp_km_prompt_requests
    SET status = 'cancelled', cancelled_at = v_now
    WHERE id = v_req.id;

  RETURN QUERY SELECT 'cancelled'::text, v_req.id, v_now;
END;
$fn$;

ALTER FUNCTION public.cancel_whatsapp_km_prompt_request(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_whatsapp_km_prompt_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_whatsapp_km_prompt_request(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_whatsapp_km_prompt_request(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_whatsapp_km_prompt_request(uuid) TO service_role;
COMMENT ON FUNCTION public.cancel_whatsapp_km_prompt_request(uuid) IS
  'MJ1: Cancela request preservando marcos anteriores. Terminal (consumed/expired/cancelled) → already_terminal. Backend-only, service_role.';

-- ============================================================
-- 5) EXPIRE
-- ============================================================

CREATE OR REPLACE FUNCTION public.expire_whatsapp_km_prompt_requests(
  p_batch integer DEFAULT 500
)
RETURNS TABLE(expired_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_now timestamptz;
  v_count integer;
BEGIN
  IF p_batch IS NULL OR p_batch <= 0 OR p_batch > 5000 THEN
    RAISE EXCEPTION 'invalid_batch: %', p_batch USING ERRCODE = '22023';
  END IF;

  v_now := now();

  WITH candidates AS (
    SELECT id
    FROM public.whatsapp_km_prompt_requests
    WHERE status = 'pending' AND expires_at <= v_now
    ORDER BY expires_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch
  ),
  updated AS (
    UPDATE public.whatsapp_km_prompt_requests t
      SET status = 'expired', expired_at = v_now
      FROM candidates
      WHERE t.id = candidates.id
      RETURNING t.id
  )
  SELECT count(*)::integer INTO v_count FROM updated;

  RETURN QUERY SELECT COALESCE(v_count, 0);
END;
$fn$;

ALTER FUNCTION public.expire_whatsapp_km_prompt_requests(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.expire_whatsapp_km_prompt_requests(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_whatsapp_km_prompt_requests(integer) FROM anon;
REVOKE ALL ON FUNCTION public.expire_whatsapp_km_prompt_requests(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_whatsapp_km_prompt_requests(integer) TO service_role;
COMMENT ON FUNCTION public.expire_whatsapp_km_prompt_requests(integer) IS
  'MJ1: Expira em lote (SKIP LOCKED) somente pending com expires_at <= now(). Backend-only, service_role. Sem cron.';
