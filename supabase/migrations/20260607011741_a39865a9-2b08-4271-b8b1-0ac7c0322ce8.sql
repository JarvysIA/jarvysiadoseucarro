
-- FIPE cache columns
ALTER TABLE public.veiculos
  ADD COLUMN IF NOT EXISTS codigo_fipe text,
  ADD COLUMN IF NOT EXISTS fipe_valor numeric,
  ADD COLUMN IF NOT EXISTS fipe_mes_referencia text,
  ADD COLUMN IF NOT EXISTS fipe_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS veiculos_placa_fipe_idx ON public.veiculos (placa) WHERE codigo_fipe IS NOT NULL;

-- FIPE history table for line chart
CREATE TABLE IF NOT EXISTS public.fipe_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.veiculos(id) ON DELETE CASCADE,
  codigo_fipe text NOT NULL,
  mes_referencia text NOT NULL,
  valor numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, mes_referencia)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fipe_history TO authenticated;
GRANT ALL ON public.fipe_history TO service_role;

ALTER TABLE public.fipe_history ENABLE ROW LEVEL SECURITY;

-- Users can view fipe_history for any vehicle they own (current owner of the vehicle row)
CREATE POLICY "Owners can view fipe history" ON public.fipe_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.veiculos v
    WHERE v.id = fipe_history.vehicle_id AND v.user_id = auth.uid()
  ));

CREATE POLICY "Owners can insert fipe history" ON public.fipe_history
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.veiculos v
    WHERE v.id = fipe_history.vehicle_id AND v.user_id = auth.uid()
  ));
