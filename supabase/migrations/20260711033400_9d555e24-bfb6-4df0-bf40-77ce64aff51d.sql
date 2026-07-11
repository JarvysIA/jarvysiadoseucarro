
-- Build 5.7F1: Schema de estado conversacional WhatsApp + idempotência de ações.
-- Isolado. Sem RLS policies (service-role-only). Sem RPCs. Sem conexão com fluxos.

-- =========================================================
-- 1) whatsapp_conversation_states
-- =========================================================
CREATE TABLE public.whatsapp_conversation_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  active_vehicle_id uuid NULL REFERENCES public.veiculos(id) ON DELETE SET NULL,
  current_intent text NULL,
  state text NOT NULL DEFAULT 'idle',
  awaiting_field text NULL,
  request_source text NULL,
  draft_type text NULL,
  draft_id uuid NULL,
  draft_version integer NOT NULL DEFAULT 0,
  draft_payload jsonb NULL,
  confirmed_at timestamptz NULL,
  executed_at timestamptz NULL,
  last_message_id uuid NULL REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wcs_contact_unique UNIQUE (contact_id),
  CONSTRAINT wcs_state_valid CHECK (state IN (
    'idle','identifying_intent','awaiting_vehicle',
    'awaiting_expense_confirmation','awaiting_expense_correction',
    'awaiting_requested_km','awaiting_km_confirmation','awaiting_km_correction',
    'awaiting_media_classification','awaiting_ocr_confirmation',
    'awaiting_maintenance_confirmation',
    'processing','completed','cancelled','failed','expired'
  )),
  CONSTRAINT wcs_request_source_valid CHECK (
    request_source IS NULL OR request_source IN (
      'user_initiated','proactive_maintenance','reengagement','system'
    )
  ),
  CONSTRAINT wcs_draft_type_valid CHECK (
    draft_type IS NULL OR draft_type IN ('expense','km_update','maintenance')
  ),
  CONSTRAINT wcs_draft_version_nonnegative CHECK (draft_version >= 0),
  CONSTRAINT wcs_draft_payload_object CHECK (
    draft_payload IS NULL OR jsonb_typeof(draft_payload) = 'object'
  ),
  CONSTRAINT wcs_confirmed_requires_draft CHECK (
    confirmed_at IS NULL OR draft_id IS NOT NULL
  ),
  CONSTRAINT wcs_executed_requires_confirmed CHECK (
    executed_at IS NULL OR (draft_id IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT wcs_executed_after_confirmed CHECK (
    executed_at IS NULL OR confirmed_at IS NULL OR executed_at >= confirmed_at
  ),
  CONSTRAINT wcs_expires_after_created CHECK (
    expires_at IS NULL OR expires_at > created_at
  )
);

CREATE UNIQUE INDEX wcs_draft_id_unique
  ON public.whatsapp_conversation_states (draft_id)
  WHERE draft_id IS NOT NULL;

CREATE INDEX wcs_user_idx
  ON public.whatsapp_conversation_states (user_id);

CREATE INDEX wcs_vehicle_idx
  ON public.whatsapp_conversation_states (active_vehicle_id)
  WHERE active_vehicle_id IS NOT NULL;

CREATE INDEX wcs_expires_idx
  ON public.whatsapp_conversation_states (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX wcs_state_interaction_idx
  ON public.whatsapp_conversation_states (state, last_interaction_at);

CREATE TRIGGER wcs_set_updated_at
  BEFORE UPDATE ON public.whatsapp_conversation_states
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.whatsapp_conversation_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_conversation_states FROM PUBLIC;
REVOKE ALL ON public.whatsapp_conversation_states FROM anon;
REVOKE ALL ON public.whatsapp_conversation_states FROM authenticated;
GRANT ALL ON public.whatsapp_conversation_states TO service_role;

-- =========================================================
-- 2) whatsapp_action_executions
-- =========================================================
CREATE TABLE public.whatsapp_action_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL,
  action_type text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  vehicle_id uuid NULL REFERENCES public.veiculos(id) ON DELETE SET NULL,
  conversation_state_id uuid NULL REFERENCES public.whatsapp_conversation_states(id) ON DELETE SET NULL,
  source_message_id uuid NULL REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running',
  result_payload jsonb NULL,
  error_code text NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wae_draft_action_unique UNIQUE (draft_id, action_type),
  CONSTRAINT wae_action_type_valid CHECK (
    action_type IN ('expense_create','km_update','maintenance_register')
  ),
  CONSTRAINT wae_status_valid CHECK (
    status IN ('running','succeeded','failed','cancelled')
  ),
  CONSTRAINT wae_result_payload_object CHECK (
    result_payload IS NULL OR jsonb_typeof(result_payload) = 'object'
  ),
  CONSTRAINT wae_error_code_valid CHECK (
    error_code IS NULL OR (btrim(error_code) <> '' AND char_length(error_code) <= 120)
  ),
  CONSTRAINT wae_completed_after_started CHECK (
    completed_at IS NULL OR completed_at >= started_at
  )
);

CREATE INDEX wae_status_created_idx
  ON public.whatsapp_action_executions (status, created_at);

CREATE INDEX wae_user_created_idx
  ON public.whatsapp_action_executions (user_id, created_at DESC);

CREATE INDEX wae_contact_created_idx
  ON public.whatsapp_action_executions (contact_id, created_at DESC);

CREATE INDEX wae_vehicle_created_idx
  ON public.whatsapp_action_executions (vehicle_id, created_at DESC)
  WHERE vehicle_id IS NOT NULL;

CREATE INDEX wae_source_message_idx
  ON public.whatsapp_action_executions (source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX wae_running_started_idx
  ON public.whatsapp_action_executions (started_at)
  WHERE status = 'running';

CREATE TRIGGER wae_set_updated_at
  BEFORE UPDATE ON public.whatsapp_action_executions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.whatsapp_action_executions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_action_executions FROM PUBLIC;
REVOKE ALL ON public.whatsapp_action_executions FROM anon;
REVOKE ALL ON public.whatsapp_action_executions FROM authenticated;
GRANT ALL ON public.whatsapp_action_executions TO service_role;
