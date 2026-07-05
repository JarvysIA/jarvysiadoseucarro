ALTER TABLE public.veiculos
  DROP CONSTRAINT IF EXISTS veiculos_jarvys_tp_source_check;

ALTER TABLE public.veiculos
  ADD CONSTRAINT veiculos_jarvys_tp_source_check
  CHECK (
    jarvys_technical_profile_source IS NULL
    OR jarvys_technical_profile_source IN (
      'corpus_curado',
      'corpus_ia',
      'derivado_fipe',
      'desconhecido',
      'manual_admin',
      'ia_resolvida'
    )
  );