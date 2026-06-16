-- 1) Tabela assinaturas
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  veiculo_id uuid NOT NULL REFERENCES public.veiculos(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ativo',
  data_vencimento timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, veiculo_id)
);

GRANT SELECT ON public.assinaturas TO authenticated;
GRANT ALL ON public.assinaturas TO service_role;

ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own assinaturas" ON public.assinaturas;
CREATE POLICY "Users view own assinaturas" ON public.assinaturas
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Super admins view all assinaturas" ON public.assinaturas;
CREATE POLICY "Super admins view all assinaturas" ON public.assinaturas
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_assinaturas_user ON public.assinaturas(user_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_veiculo ON public.assinaturas(veiculo_id);
CREATE INDEX IF NOT EXISTS idx_assinaturas_status_venc ON public.assinaturas(status, data_vencimento);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_assinaturas_updated_at ON public.assinaturas;
CREATE TRIGGER trg_assinaturas_updated_at
  BEFORE UPDATE ON public.assinaturas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Ajustes em pagamentos_pix
ALTER TABLE public.pagamentos_pix
  ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE public.pagamentos_pix
  ALTER COLUMN veiculo_id DROP NOT NULL;

ALTER TABLE public.pagamentos_pix
  DROP CONSTRAINT IF EXISTS pagamentos_pix_tipo_produto_check;

ALTER TABLE public.pagamentos_pix
  ADD CONSTRAINT pagamentos_pix_tipo_produto_check
  CHECK (tipo_produto = ANY (ARRAY['ativacao','historico','mensalidade_carro']));

-- 3) Trigger protetora em veiculos
CREATE OR REPLACE FUNCTION public.proteger_cadastro_veiculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_count int;
  v_assinaturas_ativas int;
BEGIN
  -- Bypass para service_role (webhook do Mercado Pago) e contextos sem auth
  IF auth.uid() IS NULL OR auth.uid() <> NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT status_usuario INTO v_status FROM public.profiles WHERE id = NEW.user_id;

  IF v_status IS NULL OR v_status NOT IN ('ativo') THEN
    -- trial e outros estados são tratados no frontend/edge function
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.veiculos
   WHERE user_id = NEW.user_id;

  IF v_count >= 1 THEN
    SELECT COUNT(*) INTO v_assinaturas_ativas
      FROM public.assinaturas
     WHERE user_id = NEW.user_id
       AND status = 'ativo'
       AND data_vencimento > now();

    IF v_assinaturas_ativas <= (v_count - 1) THEN
      RAISE EXCEPTION 'CADASTRO_BLOQUEADO: usuário ativo precisa de assinatura paga para veículos adicionais'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_cadastro_veiculo ON public.veiculos;
CREATE TRIGGER trg_proteger_cadastro_veiculo
  BEFORE INSERT ON public.veiculos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_cadastro_veiculo();