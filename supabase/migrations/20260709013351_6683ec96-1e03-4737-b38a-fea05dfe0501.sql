
-- =========================================================================
-- Build 5.2 — Schema base WhatsApp (Fase 5)
-- Namespace: whatsapp_* + ocr_whatsapp_jobs
-- Sem conexão Z-API, sem webhook, sem secrets, sem bucket, sem UI.
-- =========================================================================

-- Função genérica de updated_at (idempotente)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================================
-- 4.1 whatsapp_provider_instances
-- =========================================================================
CREATE TABLE public.whatsapp_provider_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'zapi',
  instance_id text NOT NULL,
  instance_name text,
  phone_number_e164 text,
  status text NOT NULL DEFAULT 'active',
  is_default boolean NOT NULL DEFAULT false,
  max_users integer,
  current_users integer NOT NULL DEFAULT 0,
  daily_message_limit integer,
  daily_media_limit integer,
  health_status text NOT NULL DEFAULT 'unknown',
  last_health_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wpi_provider_chk CHECK (provider IN ('zapi','meta_cloud','other')),
  CONSTRAINT wpi_status_chk CHECK (status IN ('active','paused','failed')),
  CONSTRAINT wpi_health_chk CHECK (health_status IN ('unknown','ok','degraded','failed')),
  CONSTRAINT wpi_current_users_chk CHECK (current_users >= 0),
  CONSTRAINT wpi_max_users_chk CHECK (max_users IS NULL OR max_users >= 0),
  CONSTRAINT wpi_daily_msg_chk CHECK (daily_message_limit IS NULL OR daily_message_limit >= 0),
  CONSTRAINT wpi_daily_media_chk CHECK (daily_media_limit IS NULL OR daily_media_limit >= 0),
  CONSTRAINT wpi_provider_instance_unique UNIQUE (provider, instance_id)
);

GRANT ALL ON public.whatsapp_provider_instances TO service_role;

ALTER TABLE public.whatsapp_provider_instances ENABLE ROW LEVEL SECURITY;

CREATE INDEX wpi_provider_status_idx ON public.whatsapp_provider_instances(provider, status);
CREATE INDEX wpi_provider_instance_idx ON public.whatsapp_provider_instances(provider, instance_id);
CREATE UNIQUE INDEX wpi_default_partial_idx ON public.whatsapp_provider_instances(is_default) WHERE is_default = true;

CREATE TRIGGER wpi_set_updated_at
  BEFORE UPDATE ON public.whatsapp_provider_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 4.2 whatsapp_contacts
-- =========================================================================
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  display_name text,
  assigned_provider text,
  assigned_instance_id text,
  assigned_whatsapp_number text,
  opt_in boolean NOT NULL DEFAULT false,
  opt_out boolean NOT NULL DEFAULT false,
  opt_in_source text,
  opt_in_at timestamptz,
  opt_out_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wc_provider_chk CHECK (assigned_provider IS NULL OR assigned_provider IN ('zapi','meta_cloud','other')),
  CONSTRAINT wc_phone_chk CHECK (phone_e164 LIKE '+%'),
  CONSTRAINT wc_user_phone_unique UNIQUE (user_id, phone_e164)
);

GRANT SELECT ON public.whatsapp_contacts TO authenticated;
GRANT ALL ON public.whatsapp_contacts TO service_role;

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY wc_select_own ON public.whatsapp_contacts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX wc_user_idx ON public.whatsapp_contacts(user_id);
CREATE INDEX wc_phone_idx ON public.whatsapp_contacts(phone_e164);
CREATE INDEX wc_instance_idx ON public.whatsapp_contacts(assigned_instance_id);
CREATE INDEX wc_user_opt_idx ON public.whatsapp_contacts(user_id, opt_in, opt_out);
CREATE INDEX wc_last_inbound_idx ON public.whatsapp_contacts(last_inbound_at DESC);

CREATE TRIGGER wc_set_updated_at
  BEFORE UPDATE ON public.whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 4.3 whatsapp_consents (append-only)
-- =========================================================================
CREATE TABLE public.whatsapp_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  consent_type text NOT NULL,
  source text NOT NULL,
  consent_text text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wcs_type_chk CHECK (consent_type IN ('geral','ocr','jarvys','notificacoes','comercial')),
  CONSTRAINT wcs_source_chk CHECK (source IN ('app_signup','app_settings','whatsapp_reply','onboarding','checkout','activation','system')),
  CONSTRAINT wcs_phone_chk CHECK (phone_e164 LIKE '+%'),
  CONSTRAINT wcs_at_chk CHECK (accepted_at IS NOT NULL OR revoked_at IS NOT NULL)
);

GRANT SELECT ON public.whatsapp_consents TO authenticated;
GRANT ALL ON public.whatsapp_consents TO service_role;

ALTER TABLE public.whatsapp_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY wcs_select_own ON public.whatsapp_consents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX wcs_user_created_idx ON public.whatsapp_consents(user_id, created_at DESC);
CREATE INDEX wcs_phone_created_idx ON public.whatsapp_consents(phone_e164, created_at DESC);
CREATE INDEX wcs_type_created_idx ON public.whatsapp_consents(consent_type, created_at DESC);

-- =========================================================================
-- 4.4 whatsapp_events (service_role only)
-- =========================================================================
CREATE TABLE public.whatsapp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'zapi',
  instance_id text,
  event_type text NOT NULL,
  provider_event_id text,
  provider_message_id text,
  direction text NOT NULL,
  phone_e164 text,
  raw_payload_sanitized jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'received',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT we_provider_chk CHECK (provider IN ('zapi','meta_cloud','other')),
  CONSTRAINT we_direction_chk CHECK (direction IN ('inbound','outbound','status')),
  CONSTRAINT we_status_chk CHECK (status IN ('received','processed','ignored','failed')),
  CONSTRAINT we_phone_chk CHECK (phone_e164 IS NULL OR phone_e164 LIKE '+%')
);

GRANT ALL ON public.whatsapp_events TO service_role;

ALTER TABLE public.whatsapp_events ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX we_provider_event_unique_idx
  ON public.whatsapp_events(provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX we_provider_msg_idx ON public.whatsapp_events(provider_message_id);
CREATE INDEX we_phone_received_idx ON public.whatsapp_events(phone_e164, received_at DESC);
CREATE INDEX we_status_received_idx ON public.whatsapp_events(status, received_at);
CREATE INDEX we_instance_received_idx ON public.whatsapp_events(instance_id, received_at DESC);

-- =========================================================================
-- 4.5 whatsapp_messages
-- =========================================================================
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.veiculos(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.whatsapp_contacts(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'zapi',
  instance_id text,
  provider_message_id text,
  direction text NOT NULL,
  message_type text NOT NULL,
  text_body text,
  media_url text,
  media_storage_path text,
  media_mime_type text,
  status text NOT NULL DEFAULT 'received',
  plan_decision jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wm_provider_chk CHECK (provider IN ('zapi','meta_cloud','other')),
  CONSTRAINT wm_direction_chk CHECK (direction IN ('inbound','outbound','system')),
  CONSTRAINT wm_type_chk CHECK (message_type IN ('text','image','pdf','audio','video','file','system','unknown')),
  CONSTRAINT wm_status_chk CHECK (status IN ('received','queued','processing','processed','sent','ignored','failed','cancelled')),
  CONSTRAINT wm_text_len_chk CHECK (text_body IS NULL OR char_length(text_body) <= 4000)
);

GRANT SELECT ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY wm_select_own ON public.whatsapp_messages
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE UNIQUE INDEX wm_provider_msg_unique_idx
  ON public.whatsapp_messages(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX wm_user_created_idx ON public.whatsapp_messages(user_id, created_at DESC);
CREATE INDEX wm_contact_created_idx ON public.whatsapp_messages(contact_id, created_at DESC);
CREATE INDEX wm_vehicle_created_idx ON public.whatsapp_messages(vehicle_id, created_at DESC);
CREATE INDEX wm_status_created_idx ON public.whatsapp_messages(status, created_at);

CREATE TRIGGER wm_set_updated_at
  BEFORE UPDATE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 4.6 whatsapp_processing_queue (service_role only)
-- =========================================================================
CREATE TABLE public.whatsapp_processing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.whatsapp_events(id) ON DELETE SET NULL,
  queue_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wpq_type_chk CHECK (queue_type IN ('parse','ocr','jarvys','command','notification','plan_gate','unknown')),
  CONSTRAINT wpq_status_chk CHECK (status IN ('queued','running','done','failed','cancelled')),
  CONSTRAINT wpq_attempts_chk CHECK (attempts >= 0),
  CONSTRAINT wpq_max_attempts_chk CHECK (max_attempts >= 1)
);

GRANT ALL ON public.whatsapp_processing_queue TO service_role;

ALTER TABLE public.whatsapp_processing_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX wpq_status_sched_idx ON public.whatsapp_processing_queue(status, scheduled_at);
CREATE INDEX wpq_type_status_idx ON public.whatsapp_processing_queue(queue_type, status);
CREATE INDEX wpq_message_idx ON public.whatsapp_processing_queue(message_id);
CREATE INDEX wpq_event_idx ON public.whatsapp_processing_queue(event_id);

-- =========================================================================
-- 4.7 whatsapp_outbound_queue (service_role only)
-- =========================================================================
CREATE TABLE public.whatsapp_outbound_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.whatsapp_contacts(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.veiculos(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'zapi',
  instance_id text,
  phone_e164 text,
  message_type text NOT NULL DEFAULT 'text',
  text_body text,
  media_storage_path text,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  provider_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT woq_provider_chk CHECK (provider IN ('zapi','meta_cloud','other')),
  CONSTRAINT woq_type_chk CHECK (message_type IN ('text','image','pdf','audio','video','file','system')),
  CONSTRAINT woq_status_chk CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  CONSTRAINT woq_phone_chk CHECK (phone_e164 IS NULL OR phone_e164 LIKE '+%'),
  CONSTRAINT woq_text_len_chk CHECK (text_body IS NULL OR char_length(text_body) <= 4000),
  CONSTRAINT woq_attempts_chk CHECK (attempts >= 0),
  CONSTRAINT woq_max_attempts_chk CHECK (max_attempts >= 1)
);

GRANT ALL ON public.whatsapp_outbound_queue TO service_role;

ALTER TABLE public.whatsapp_outbound_queue ENABLE ROW LEVEL SECURITY;

CREATE INDEX woq_status_priority_idx ON public.whatsapp_outbound_queue(status, priority DESC, scheduled_at);
CREATE INDEX woq_user_created_idx ON public.whatsapp_outbound_queue(user_id, created_at DESC);
CREATE INDEX woq_contact_created_idx ON public.whatsapp_outbound_queue(contact_id, created_at DESC);
CREATE INDEX woq_provider_msg_idx ON public.whatsapp_outbound_queue(provider_message_id);
CREATE INDEX woq_instance_status_idx ON public.whatsapp_outbound_queue(instance_id, status, scheduled_at);

-- =========================================================================
-- 4.8 ocr_whatsapp_jobs
-- =========================================================================
CREATE TABLE public.ocr_whatsapp_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.veiculos(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.whatsapp_contacts(id) ON DELETE SET NULL,
  media_storage_path text,
  original_media_type text,
  ocr_status text NOT NULL DEFAULT 'queued',
  ocr_result_json jsonb,
  classification_json jsonb,
  confidence_score numeric,
  needs_user_confirmation boolean NOT NULL DEFAULT true,
  confirmation_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owj_media_type_chk CHECK (original_media_type IS NULL OR original_media_type IN ('image','pdf')),
  CONSTRAINT owj_ocr_status_chk CHECK (ocr_status IN ('queued','running','done','failed','cancelled')),
  CONSTRAINT owj_confirm_chk CHECK (confirmation_status IN ('pending','confirmed','corrected','cancelled')),
  CONSTRAINT owj_confidence_chk CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1))
);

GRANT SELECT ON public.ocr_whatsapp_jobs TO authenticated;
GRANT ALL ON public.ocr_whatsapp_jobs TO service_role;

ALTER TABLE public.ocr_whatsapp_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY owj_select_own ON public.ocr_whatsapp_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX owj_user_created_idx ON public.ocr_whatsapp_jobs(user_id, created_at DESC);
CREATE INDEX owj_vehicle_created_idx ON public.ocr_whatsapp_jobs(vehicle_id, created_at DESC);
CREATE INDEX owj_message_idx ON public.ocr_whatsapp_jobs(message_id);
CREATE INDEX owj_contact_created_idx ON public.ocr_whatsapp_jobs(contact_id, created_at DESC);
CREATE INDEX owj_ocr_status_created_idx ON public.ocr_whatsapp_jobs(ocr_status, created_at);
CREATE INDEX owj_confirm_status_created_idx ON public.ocr_whatsapp_jobs(confirmation_status, created_at);

CREATE TRIGGER owj_set_updated_at
  BEFORE UPDATE ON public.ocr_whatsapp_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
