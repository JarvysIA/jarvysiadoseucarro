-- Build C5 — Ledger at-most-once do Conversation Handoff (Dr. Jarvys via
-- WhatsApp). Tabela + 4 RPCs SECURITY DEFINER (service_role). Nenhuma
-- policy cliente. Não conectada ao worker/sender/core — apenas infra de
-- persistência. Garante que cada (source_message_id, segment) seja
-- executado no máximo uma vez via reserva CAS + transições CAS
-- (reserved -> invoking -> completed|failed), independente de reentrega
-- de webhook ou retry do chamador.

CREATE TABLE public.whatsapp_conversation_handoff_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_message_id uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE RESTRICT,
  segment text NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  vehicle_id uuid NULL REFERENCES public.veiculos(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'reserved',
  result_status text NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  invoking_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wchl_segment_valid CHECK (segment IN ('primary', 'supplemental')),
  CONSTRAINT wchl_status_valid CHECK (status IN ('reserved', 'invoking', 'completed', 'failed')),
  CONSTRAINT wchl_result_status_valid CHECK (
    result_status IS NULL
    OR result_status IN ('success', 'blocked', 'transient_failure', 'permanent_failure')
  ),
  CONSTRAINT wchl_expires_after_reserved CHECK (expires_at > reserved_at),
  CONSTRAINT wchl_shape_check CHECK (
    (status = 'reserved'
      AND invoking_at IS NULL AND completed_at IS NULL AND result_status IS NULL)
    OR (status = 'invoking'
      AND invoking_at IS NOT NULL AND invoking_at >= reserved_at
      AND completed_at IS NULL AND result_status IS NULL)
    OR (status = 'completed'
      AND invoking_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= invoking_at
      AND result_status IS NOT NULL)
    OR (status = 'failed'
      AND invoking_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= invoking_at
      AND result_status IS NOT NULL AND result_status <> 'success')
  ),
  UNIQUE (source_message_id, segment)
);

ALTER TABLE public.whatsapp_conversation_handoff_ledger OWNER TO postgres;

CREATE INDEX wchl_expiry_idx
  ON public.whatsapp_conversation_handoff_ledger (status, expires_at)
  WHERE status IN ('reserved', 'invoking');

ALTER TABLE public.whatsapp_conversation_handoff_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_conversation_handoff_ledger FROM PUBLIC;
REVOKE ALL ON public.whatsapp_conversation_handoff_ledger FROM anon;
REVOKE ALL ON public.whatsapp_conversation_handoff_ledger FROM authenticated;

COMMENT ON TABLE public.whatsapp_conversation_handoff_ledger IS
  'Build C5 — Ledger at-most-once do handoff conversation (Dr. Jarvys). UNIQUE por (source_message_id, segment): garante uma única execução efetiva por mensagem/segmento, mesmo sob reentrega ou retry. Transições CAS via RPC (reserve/mark_invoking/complete/fail). Acesso exclusivo service_role; ainda desconectada do runtime.';
COMMENT ON COLUMN public.whatsapp_conversation_handoff_ledger.segment IS
  'primary (comando principal) ou supplemental (comando complementar) — mesma mensagem pode gerar os dois, cada um com sua própria reserva.';
COMMENT ON COLUMN public.whatsapp_conversation_handoff_ledger.status IS
  'Lifecycle fechado: reserved -> invoking -> completed|failed. Toda transição é CAS (WHERE status=<esperado>).';
COMMENT ON COLUMN public.whatsapp_conversation_handoff_ledger.result_status IS
  'Resultado da execução: success|blocked|transient_failure|permanent_failure. NULL enquanto reserved/invoking. Nunca success quando status=failed.';

-- ============================================================
-- 1) RESERVE
-- ============================================================

CREATE OR REPLACE FUNCTION public.reserve_conversation_handoff_execution(
  p_source_message_id uuid,
  p_segment text,
  p_contact_id uuid,
  p_user_id uuid,
  p_vehicle_id uuid,
  p_ttl_seconds integer
)
RETURNS TABLE(id uuid, status text, is_new_reservation boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_now timestamptz := now();
  v_expires timestamptz;
  v_new_id uuid;
  v_existing record;
BEGIN
  IF p_source_message_id IS NULL OR p_contact_id IS NULL OR p_user_id IS NULL
     OR p_segment IS NULL OR p_segment NOT IN ('primary', 'supplemental')
     OR p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'invariant_violation' USING ERRCODE = '22023';
  END IF;

  v_expires := v_now + make_interval(secs => p_ttl_seconds);

  INSERT INTO public.whatsapp_conversation_handoff_ledger
    (source_message_id, segment, contact_id, user_id, vehicle_id, status, reserved_at, expires_at)
  VALUES
    (p_source_message_id, p_segment, p_contact_id, p_user_id, p_vehicle_id, 'reserved', v_now, v_expires)
  ON CONFLICT (source_message_id, segment) DO NOTHING
  RETURNING whatsapp_conversation_handoff_ledger.id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN QUERY SELECT v_new_id, 'reserved'::text, true;
    RETURN;
  END IF;

  -- Conflito: já existe uma linha para este (source_message_id, segment).
  -- Sweep oportunista — só acontece quando alguém de fato tenta reservar
  -- de novo o mesmo par, nenhum job/cron separado é criado por este
  -- build. Os dois casos de expiração são tratados de forma DIFERENTE
  -- (Opção A — segurança acima de disponibilidade, decisão já travada):
  SELECT * INTO v_existing
    FROM public.whatsapp_conversation_handoff_ledger
    WHERE source_message_id = p_source_message_id AND segment = p_segment
    FOR UPDATE;

  -- Caso 1: 'reserved' expirado — a IA nunca chegou a ser invocada para
  -- esta reserva, então é seguro reabri-la como uma nova tentativa.
  -- invoking_at/completed_at/result_status já são NULL nesse estado (CHECK
  -- wchl_shape_check), então o UPDATE não precisa reescrevê-los.
  IF v_existing.status = 'reserved' AND v_existing.expires_at < v_now THEN
    UPDATE public.whatsapp_conversation_handoff_ledger
      SET reserved_at = v_now,
          expires_at = v_expires
      WHERE id = v_existing.id;
    RETURN QUERY SELECT v_existing.id, 'reserved'::text, true;
    RETURN;
  END IF;

  -- Caso 2: 'invoking' expirado — a IA pode ter sido invocada (não temos
  -- como saber se ela respondeu ou não), então esta reserva NUNCA é
  -- reaberta. Vira failed permanente para este (source_message_id,
  -- segment): nenhuma nova tentativa jamais chama a IA de novo para o
  -- mesmo par. result_status='transient_failure' pelo mesmo motivo
  -- genérico de "serviço indisponível" já usado no C3.
  IF v_existing.status = 'invoking' AND v_existing.expires_at < v_now THEN
    UPDATE public.whatsapp_conversation_handoff_ledger
      SET status = 'failed', result_status = 'transient_failure', completed_at = v_now
      WHERE id = v_existing.id AND status = 'invoking';
    RETURN QUERY SELECT v_existing.id, 'failed'::text, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_existing.id, v_existing.status, false;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.reserve_conversation_handoff_execution FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_conversation_handoff_execution FROM anon, authenticated;
COMMENT ON FUNCTION public.reserve_conversation_handoff_execution IS
  'C5: Reserva CAS por (source_message_id, segment). insere nova linha; se já existe: reserved expirado reabre como nova tentativa, invoking expirado NUNCA reabre (vira failed/transient_failure permanente — Opção A, segurança acima de disponibilidade), qualquer outro estado só retorna a linha existente com is_new_reservation=false.';

-- ============================================================
-- 2) MARK INVOKING
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_conversation_handoff_invoking(
  p_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_updated integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invariant_violation' USING ERRCODE = '22023';
  END IF;

  UPDATE public.whatsapp_conversation_handoff_ledger
    SET status = 'invoking', invoking_at = now()
    WHERE id = p_id AND status = 'reserved';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated = 1;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.mark_conversation_handoff_invoking FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_conversation_handoff_invoking FROM anon, authenticated;
COMMENT ON FUNCTION public.mark_conversation_handoff_invoking IS
  'C5: Transição CAS reserved -> invoking. Retorna false se a linha não existir ou não estiver mais em reserved (não lança).';

-- ============================================================
-- 3) COMPLETE
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_conversation_handoff_execution(
  p_id uuid,
  p_result_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_updated integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invariant_violation' USING ERRCODE = '22023';
  END IF;

  IF p_result_status NOT IN ('success', 'blocked', 'transient_failure', 'permanent_failure') THEN
    RAISE EXCEPTION 'invariant_violation' USING ERRCODE = '22023';
  END IF;

  UPDATE public.whatsapp_conversation_handoff_ledger
    SET status = 'completed', result_status = p_result_status, completed_at = now()
    WHERE id = p_id AND status = 'invoking';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated = 1;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.complete_conversation_handoff_execution FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_conversation_handoff_execution FROM anon, authenticated;
COMMENT ON FUNCTION public.complete_conversation_handoff_execution IS
  'C5: Transição CAS invoking -> completed. Aceita qualquer um dos 4 result_status (o executor produziu um resultado válido, seja ele success ou não). Retorna false se a linha não existir ou não estiver mais em invoking (não lança).';

-- ============================================================
-- 4) FAIL
-- ============================================================

CREATE OR REPLACE FUNCTION public.fail_conversation_handoff_execution(
  p_id uuid,
  p_result_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_updated integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invariant_violation' USING ERRCODE = '22023';
  END IF;

  IF p_result_status NOT IN ('blocked', 'transient_failure', 'permanent_failure') THEN
    RAISE EXCEPTION 'invariant_violation' USING ERRCODE = '22023';
  END IF;

  UPDATE public.whatsapp_conversation_handoff_ledger
    SET status = 'failed', result_status = p_result_status, completed_at = now()
    WHERE id = p_id AND status = 'invoking';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated = 1;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fail_conversation_handoff_execution FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fail_conversation_handoff_execution FROM anon, authenticated;
COMMENT ON FUNCTION public.fail_conversation_handoff_execution IS
  'C5: Transição CAS invoking -> failed. p_result_status nunca aceita success — só blocked|transient_failure|permanent_failure. Retorna false se a linha não existir ou não estiver mais em invoking (não lança).';
