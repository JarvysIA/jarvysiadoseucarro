ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS asaas_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_asaas_customer_id_key
  ON public.profiles (asaas_customer_id)
  WHERE (asaas_customer_id IS NOT NULL);
