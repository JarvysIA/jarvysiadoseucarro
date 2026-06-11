
-- 1) Tabela de pagamentos PIX
CREATE TABLE public.pagamentos_pix (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  veiculo_id UUID NOT NULL REFERENCES public.veiculos(id) ON DELETE CASCADE,
  valor NUMERIC(10,2) NOT NULL CHECK (valor >= 0),
  codigo_cupom TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  txid_efi TEXT,
  pix_copia_cola TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pagamentos_pix TO authenticated;
GRANT ALL ON public.pagamentos_pix TO service_role;

ALTER TABLE public.pagamentos_pix ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own payments"
  ON public.pagamentos_pix
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own payments"
  ON public.pagamentos_pix
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_pagamentos_pix_user ON public.pagamentos_pix(user_id);
CREATE INDEX idx_pagamentos_pix_veiculo ON public.pagamentos_pix(veiculo_id);

-- 2) Remover coluna legada plan_tier (modelo antigo Free/VIP/Super VIP por conta)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS plan_tier;
