ALTER TABLE public.veiculos
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS history_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL;

ALTER TABLE public.veiculos ALTER COLUMN user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS veiculos_placa_status_idx ON public.veiculos (placa, status);