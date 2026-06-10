ALTER TABLE public.veiculos
  ADD COLUMN IF NOT EXISTS fipe_historico jsonb,
  ADD COLUMN IF NOT EXISTS fipe_ultima_atualizacao timestamptz;