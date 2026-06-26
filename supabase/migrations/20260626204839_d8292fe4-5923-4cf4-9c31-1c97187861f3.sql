ALTER TABLE public.veiculos
  ADD COLUMN IF NOT EXISTS modelo_fipe text,
  ADD COLUMN IF NOT EXISTS combustivel_fipe text,
  ADD COLUMN IF NOT EXISTS cilindradas integer,
  ADD COLUMN IF NOT EXISTS ano_modelo integer,
  ADD COLUMN IF NOT EXISTS codigo_marca text,
  ADD COLUMN IF NOT EXISTS codigo_modelo text,
  ADD COLUMN IF NOT EXISTS vehicle_signature text;

CREATE INDEX IF NOT EXISTS idx_veiculos_vehicle_signature
  ON public.veiculos (vehicle_signature);