CREATE TABLE IF NOT EXISTS public.vehicle_images_blob (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.veiculos(id) ON DELETE CASCADE,
  image_data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_images_blob_vehicle_id_key UNIQUE (vehicle_id)
);

GRANT ALL ON public.vehicle_images_blob TO service_role;

ALTER TABLE public.vehicle_images_blob ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_vehicle_images_blob_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_vehicle_images_blob_updated_at ON public.vehicle_images_blob;
CREATE TRIGGER update_vehicle_images_blob_updated_at
BEFORE UPDATE ON public.vehicle_images_blob
FOR EACH ROW
EXECUTE FUNCTION public.update_vehicle_images_blob_updated_at();