
CREATE TABLE public.despesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES public.veiculos(id) ON DELETE CASCADE,
  data timestamptz NOT NULL DEFAULT now(),
  valor numeric(12,2) NOT NULL DEFAULT 0,
  categoria text NOT NULL CHECK (categoria IN ('Revisão','Manutenção','Lavagem','Combustível')),
  descricao text NOT NULL DEFAULT '',
  km_registro integer,
  receipt_image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX despesas_vehicle_idx ON public.despesas(vehicle_id, data DESC);
CREATE INDEX despesas_user_idx ON public.despesas(user_id, data DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.despesas TO authenticated;
GRANT ALL ON public.despesas TO service_role;

ALTER TABLE public.despesas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own despesas" ON public.despesas
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own despesas" ON public.despesas
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own despesas" ON public.despesas
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own despesas" ON public.despesas
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Storage policies for receipts bucket: path layout = {user_id}/{vehicle_id}/{file}
CREATE POLICY "Users read own receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own receipts" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
