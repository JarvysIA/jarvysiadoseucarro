ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS cidade text,
  ADD COLUMN IF NOT EXISTS uf text;