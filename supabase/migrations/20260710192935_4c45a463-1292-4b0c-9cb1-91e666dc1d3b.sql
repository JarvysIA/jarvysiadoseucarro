
-- Ampliar whatsapp_contacts com ciclo de vida do vínculo
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS unlinked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT true;

-- Índices parciais de vínculo ativo (tabela vazia, sem conflitos)
CREATE UNIQUE INDEX IF NOT EXISTS wc_unique_active_user
  ON public.whatsapp_contacts(user_id)
  WHERE unlinked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wc_unique_active_phone
  ON public.whatsapp_contacts(phone_e164)
  WHERE unlinked_at IS NULL;

CREATE INDEX IF NOT EXISTS wc_user_unlinked_idx
  ON public.whatsapp_contacts(user_id, unlinked_at);

CREATE INDEX IF NOT EXISTS wc_phone_unlinked_idx
  ON public.whatsapp_contacts(phone_e164, unlinked_at);

CREATE INDEX IF NOT EXISTS wc_verified_at_idx
  ON public.whatsapp_contacts(verified_at);

-- Tabela de verificação de posse
CREATE TABLE public.whatsapp_link_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  purpose text NOT NULL DEFAULT 'link',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz,
  verified_at timestamptz,
  requested_ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wlv_phone_e164_format CHECK (phone_e164 ~ '^\+[0-9]{8,20}$'),
  CONSTRAINT wlv_status_valid CHECK (status IN ('pending','verified','expired','blocked','cancelled')),
  CONSTRAINT wlv_purpose_valid CHECK (purpose IN ('link','relink','reactivate')),
  CONSTRAINT wlv_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT wlv_max_attempts_pos CHECK (max_attempts >= 1),
  CONSTRAINT wlv_attempts_le_max CHECK (attempts <= max_attempts),
  CONSTRAINT wlv_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT wlv_code_hash_nonempty CHECK (length(code_hash) > 0),
  CONSTRAINT wlv_verified_requires_status CHECK (verified_at IS NULL OR status = 'verified')
);

-- Grants: service_role only. Sem acesso para anon/authenticated (code_hash é sensível).
REVOKE ALL ON public.whatsapp_link_verifications FROM PUBLIC;
REVOKE ALL ON public.whatsapp_link_verifications FROM anon;
REVOKE ALL ON public.whatsapp_link_verifications FROM authenticated;
GRANT ALL ON public.whatsapp_link_verifications TO service_role;

ALTER TABLE public.whatsapp_link_verifications ENABLE ROW LEVEL SECURITY;
-- Sem policies para authenticated; escrita/leitura só via service_role.

-- Índices
CREATE UNIQUE INDEX wlv_unique_pending
  ON public.whatsapp_link_verifications(user_id, phone_e164)
  WHERE status = 'pending';

CREATE INDEX wlv_user_created_idx
  ON public.whatsapp_link_verifications(user_id, created_at DESC);

CREATE INDEX wlv_phone_created_idx
  ON public.whatsapp_link_verifications(phone_e164, created_at DESC);

CREATE INDEX wlv_status_expires_idx
  ON public.whatsapp_link_verifications(status, expires_at);

CREATE INDEX wlv_user_status_idx
  ON public.whatsapp_link_verifications(user_id, status);

CREATE INDEX wlv_phone_status_idx
  ON public.whatsapp_link_verifications(phone_e164, status);

-- Trigger updated_at (reutilizando função existente)
CREATE TRIGGER wlv_set_updated_at
  BEFORE UPDATE ON public.whatsapp_link_verifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
