-- Allow current vehicle owner to SELECT despesas (Carfax Reverso: history follows the car)
DROP POLICY IF EXISTS "Users select own despesas" ON public.despesas;

CREATE POLICY "Users select despesas of owned vehicle"
ON public.despesas
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.veiculos v
    WHERE v.id = despesas.vehicle_id
      AND v.user_id = auth.uid()
  )
);