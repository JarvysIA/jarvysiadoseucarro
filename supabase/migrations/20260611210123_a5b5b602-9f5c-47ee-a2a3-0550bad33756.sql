
ALTER TABLE public.pagamentos_pix
  ADD COLUMN IF NOT EXISTS tipo_produto text NOT NULL DEFAULT 'ativacao',
  ADD COLUMN IF NOT EXISTS produto_ref_id uuid;

ALTER TABLE public.pagamentos_pix
  DROP CONSTRAINT IF EXISTS pagamentos_pix_tipo_produto_check;
ALTER TABLE public.pagamentos_pix
  ADD CONSTRAINT pagamentos_pix_tipo_produto_check
  CHECK (tipo_produto IN ('ativacao','historico'));

CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_tipo ON public.pagamentos_pix(tipo_produto);
