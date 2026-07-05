ALTER TABLE public.veiculos
  ADD COLUMN IF NOT EXISTS jarvys_technical_profile jsonb,
  ADD COLUMN IF NOT EXISTS jarvys_technical_profile_confidence text,
  ADD COLUMN IF NOT EXISTS jarvys_technical_profile_source text,
  ADD COLUMN IF NOT EXISTS jarvys_technical_profile_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'veiculos_jarvys_tp_confidence_check'
  ) THEN
    ALTER TABLE public.veiculos
      ADD CONSTRAINT veiculos_jarvys_tp_confidence_check
      CHECK (
        jarvys_technical_profile_confidence IS NULL
        OR jarvys_technical_profile_confidence IN ('high', 'medium', 'low')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'veiculos_jarvys_tp_source_check'
  ) THEN
    ALTER TABLE public.veiculos
      ADD CONSTRAINT veiculos_jarvys_tp_source_check
      CHECK (
        jarvys_technical_profile_source IS NULL
        OR jarvys_technical_profile_source IN (
          'corpus_curado', 'corpus_ia', 'derivado_fipe', 'desconhecido', 'manual_admin'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.veiculos.jarvys_technical_profile IS
  'Snapshot final do JarvysVehicleProfile (fuelKind, timingSystem, transmissionKind, steeringKind). Preenchido por resolveAndSaveVehicleTechnicalProfileFn no cadastro do veículo. Nunca inferido no runtime da Home.';