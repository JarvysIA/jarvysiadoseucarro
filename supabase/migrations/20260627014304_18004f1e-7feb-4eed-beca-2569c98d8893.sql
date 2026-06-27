-- Build 4: criar tabela técnica global vehicle_maintenance_profiles
-- Cache técnico compartilhado por assinatura técnica do veículo.
-- Não contém dados pessoais (sem user_id/placa/chassi/numero_motor).

CREATE TABLE public.vehicle_maintenance_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  signature text NOT NULL UNIQUE,
  maintenance_family text,

  marca text,
  modelo_fipe text,
  versao text,
  ano_modelo integer,
  combustivel text,
  cilindradas integer,
  valvulas integer,
  motor_textual text,
  transmissao text,

  sistema_distribuicao text NOT NULL DEFAULT 'desconhecido',

  maintenance_plan_json jsonb,
  parts_profile_json jsonb,

  source text NOT NULL DEFAULT 'manual',
  confidence smallint NOT NULL DEFAULT 0,

  reviewed_by_admin boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vmp_sistema_distribuicao_check
    CHECK (sistema_distribuicao IN ('correia_dentada','corrente','correia_banhada','desconhecido')),
  CONSTRAINT vmp_confidence_check
    CHECK (confidence >= 0 AND confidence <= 100),
  CONSTRAINT vmp_source_check
    CHECK (source IN ('manual','ia','fornecedor','catalogo','curadoria'))
);

-- Grants (signature UNIQUE já cria índice; não duplicar).
GRANT SELECT ON public.vehicle_maintenance_profiles TO authenticated;
GRANT ALL    ON public.vehicle_maintenance_profiles TO service_role;

-- RLS: apenas leitura para autenticados. Escrita só via service_role (bypassa RLS).
ALTER TABLE public.vehicle_maintenance_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read maintenance profiles"
  ON public.vehicle_maintenance_profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Índices auxiliares.
CREATE INDEX idx_vmp_maintenance_family
  ON public.vehicle_maintenance_profiles (maintenance_family);

CREATE INDEX idx_vmp_sistema_distribuicao
  ON public.vehicle_maintenance_profiles (sistema_distribuicao);

-- Trigger updated_at — reaproveita public.set_updated_at() já existente.
CREATE TRIGGER trg_vmp_updated_at
  BEFORE UPDATE ON public.vehicle_maintenance_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();