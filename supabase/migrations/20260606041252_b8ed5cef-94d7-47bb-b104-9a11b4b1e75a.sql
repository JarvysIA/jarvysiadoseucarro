ALTER TABLE public.veiculos ADD COLUMN IF NOT EXISTS image_url text;
CREATE INDEX IF NOT EXISTS idx_veiculos_image_cache_lookup
  ON public.veiculos (lower(marca), lower(modelo), lower(ano), lower(cor))
  WHERE image_url IS NOT NULL;