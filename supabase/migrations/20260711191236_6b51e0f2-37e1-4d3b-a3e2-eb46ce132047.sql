
-- Build 5.7F2B1 — Schema de concorrência, lease, idempotência e rollout do orquestrador WhatsApp
-- Somente schema. Sem RPCs, sem triggers, sem dados. Sem alteração de RLS/grants existentes.

-- ============================================================
-- 1) whatsapp_processing_queue — lease + marca durável
-- ============================================================
ALTER TABLE public.whatsapp_processing_queue
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN claimed_by text,
  ADD COLUMN orchestrator_processed_at timestamptz,
  ADD COLUMN orchestrator_result jsonb,
  ADD COLUMN orchestrator_version text;

ALTER TABLE public.whatsapp_processing_queue
  ADD CONSTRAINT wpq_claimed_by_valid
    CHECK (claimed_by IS NULL OR (btrim(claimed_by) <> '' AND char_length(claimed_by) <= 64));

ALTER TABLE public.whatsapp_processing_queue
  ADD CONSTRAINT wpq_lease_fields_consistent
    CHECK (
      (lease_token IS NULL AND lease_expires_at IS NULL AND claimed_at IS NULL AND claimed_by IS NULL)
      OR
      (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND claimed_at IS NOT NULL AND claimed_by IS NOT NULL)
    );

ALTER TABLE public.whatsapp_processing_queue
  ADD CONSTRAINT wpq_lease_expires_after_claim
    CHECK (
      lease_token IS NULL
      OR lease_expires_at > claimed_at
    );

ALTER TABLE public.whatsapp_processing_queue
  ADD CONSTRAINT wpq_orchestrator_result_object
    CHECK (orchestrator_result IS NULL OR jsonb_typeof(orchestrator_result) = 'object');

ALTER TABLE public.whatsapp_processing_queue
  ADD CONSTRAINT wpq_orchestrator_version_valid
    CHECK (orchestrator_version IS NULL OR (btrim(orchestrator_version) <> '' AND char_length(orchestrator_version) <= 32));

ALTER TABLE public.whatsapp_processing_queue
  ADD CONSTRAINT wpq_orchestrator_fields_consistent
    CHECK (
      (orchestrator_processed_at IS NULL AND orchestrator_result IS NULL AND orchestrator_version IS NULL)
      OR
      (orchestrator_processed_at IS NOT NULL AND orchestrator_result IS NOT NULL AND orchestrator_version IS NOT NULL)
    );

CREATE UNIQUE INDEX wpq_message_unique
  ON public.whatsapp_processing_queue(message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX wpq_lease_expiry_idx
  ON public.whatsapp_processing_queue(lease_expires_at)
  WHERE status = 'running' AND lease_expires_at IS NOT NULL;

-- ============================================================
-- 2) whatsapp_outbound_queue — idempotência + origem
-- ============================================================
ALTER TABLE public.whatsapp_outbound_queue
  ADD COLUMN idempotency_key text,
  ADD COLUMN source_message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL;

ALTER TABLE public.whatsapp_outbound_queue
  ADD CONSTRAINT woq_idempotency_key_valid
    CHECK (idempotency_key IS NULL OR (btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 255));

CREATE UNIQUE INDEX woq_idempotency_unique
  ON public.whatsapp_outbound_queue(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX woq_source_message_idx
  ON public.whatsapp_outbound_queue(source_message_id)
  WHERE source_message_id IS NOT NULL;

-- ============================================================
-- 3) whatsapp_conversation_states — versionamento + fallback_count
-- ============================================================
ALTER TABLE public.whatsapp_conversation_states
  ADD COLUMN state_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN fallback_count smallint NOT NULL DEFAULT 0;

ALTER TABLE public.whatsapp_conversation_states
  ADD CONSTRAINT wcs_state_version_nonnegative
    CHECK (state_version >= 0);

ALTER TABLE public.whatsapp_conversation_states
  ADD CONSTRAINT wcs_fallback_count_valid
    CHECK (fallback_count BETWEEN 0 AND 3);

-- ============================================================
-- 4) whatsapp_provider_instances — modo de rollout
-- ============================================================
ALTER TABLE public.whatsapp_provider_instances
  ADD COLUMN orchestrator_mode text NOT NULL DEFAULT 'off';

ALTER TABLE public.whatsapp_provider_instances
  ADD CONSTRAINT wpi_orchestrator_mode_valid
    CHECK (orchestrator_mode IN ('off','shadow','test','active'));
