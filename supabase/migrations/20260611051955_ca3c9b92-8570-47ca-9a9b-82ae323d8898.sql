
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pix_recebimento text;

CREATE TABLE IF NOT EXISTS public.logs_erro_bonificacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pagamento_id uuid REFERENCES public.pagamentos_pix(id) ON DELETE SET NULL,
  padrinho_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  codigo_cupom text,
  valor numeric(10,2),
  chave_pix text,
  erro text,
  efi_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.logs_erro_bonificacao TO authenticated;
GRANT ALL ON public.logs_erro_bonificacao TO service_role;

ALTER TABLE public.logs_erro_bonificacao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view bonificacao logs"
  ON public.logs_erro_bonificacao FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));
