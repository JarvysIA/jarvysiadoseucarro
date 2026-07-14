
-- ============================================================
-- FASE 2.1 BUILD 1 — Sistema de Indicação + Carteira
-- ============================================================

-- ============ 1) TABELA carteiras_indicacao ============
CREATE TABLE public.carteiras_indicacao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  saldo_disponivel numeric(12,2) NOT NULL DEFAULT 0,
  saldo_pendente   numeric(12,2) NOT NULL DEFAULT 0,
  saldo_reservado  numeric(12,2) NOT NULL DEFAULT 0,
  total_indicacoes integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.carteiras_indicacao TO authenticated;
GRANT ALL    ON public.carteiras_indicacao TO service_role;

ALTER TABLE public.carteiras_indicacao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carteira_select_own"
  ON public.carteiras_indicacao FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

CREATE TRIGGER trg_carteiras_indicacao_updated_at
  BEFORE UPDATE ON public.carteiras_indicacao
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ 2) TABELA movimentacoes_indicacao ============
CREATE TABLE public.movimentacoes_indicacao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  padrinho_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  afilhado_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  pagamento_id uuid,  -- sem FK rígida (bônus futuros podem não vir de PIX)
  referencia   text,
  valor        numeric(12,2) NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('credito_indicacao','saque','cancelamento','bonus')),
  status       text NOT NULL CHECK (status IN ('pendente','disponivel','reservado','pago','cancelado')),
  descricao    text,
  liberado_em  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Idempotência: nunca duas movimentações de crédito para o mesmo pagamento
CREATE UNIQUE INDEX uniq_mov_credito_pagamento
  ON public.movimentacoes_indicacao (pagamento_id)
  WHERE tipo = 'credito_indicacao' AND pagamento_id IS NOT NULL;

CREATE INDEX idx_mov_padrinho_status ON public.movimentacoes_indicacao (padrinho_id, status);
CREATE INDEX idx_mov_padrinho_created ON public.movimentacoes_indicacao (padrinho_id, created_at DESC);

GRANT SELECT ON public.movimentacoes_indicacao TO authenticated;
GRANT ALL    ON public.movimentacoes_indicacao TO service_role;

ALTER TABLE public.movimentacoes_indicacao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mov_select_own_padrinho"
  ON public.movimentacoes_indicacao FOR SELECT
  TO authenticated
  USING (auth.uid() = padrinho_id);

-- ============ 3) TABELA notificacoes_indicacao ============
CREATE TABLE public.notificacoes_indicacao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('nova_comissao_indicacao','comissao_liberada','saque_solicitado','saque_pago')),
  titulo     text NOT NULL,
  mensagem   text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  lida       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_user_created ON public.notificacoes_indicacao (user_id, created_at DESC);

GRANT SELECT, UPDATE ON public.notificacoes_indicacao TO authenticated;
GRANT ALL            ON public.notificacoes_indicacao TO service_role;

ALTER TABLE public.notificacoes_indicacao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select_own"
  ON public.notificacoes_indicacao FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "notif_update_own_lida"
  ON public.notificacoes_indicacao FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============ 4) CONSTANTES CONFIGURÁVEIS ============
CREATE OR REPLACE FUNCTION public.get_indicacao_dias_bloqueio()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 7 $$;

CREATE OR REPLACE FUNCTION public.get_indicacao_valor_comissao()
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 5.00::numeric $$;

CREATE OR REPLACE FUNCTION public.get_indicacao_saque_minimo()
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT 20.00::numeric $$;

-- ============ 5) TRIGGER carteira automática em novos profiles ============
CREATE OR REPLACE FUNCTION public.criar_carteira_indicacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.carteiras_indicacao (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_criar_carteira_indicacao
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.criar_carteira_indicacao();

-- ============ 6) BACKFILL carteiras para usuários existentes ============
INSERT INTO public.carteiras_indicacao (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- ============ 7) RPC TRANSACIONAL — registrar comissão ============
-- Único ponto chamado pelo pipeline: cria movimentação + atualiza
-- carteira + insere notificação. Tudo em uma transação atômica.
CREATE OR REPLACE FUNCTION public.registrar_comissao_indicacao(
  _padrinho_id  uuid,
  _afilhado_id  uuid,
  _pagamento_id uuid,
  _referencia   text,
  _valor        numeric DEFAULT NULL,
  _descricao    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valor       numeric;
  v_mov_id      uuid;
  v_nome_afil   text;
BEGIN
  -- Antifraude: padrinho != afilhado
  IF _padrinho_id IS NULL OR _padrinho_id = _afilhado_id THEN
    RAISE EXCEPTION 'INDICACAO_INVALIDA: padrinho ausente ou igual ao afilhado';
  END IF;

  v_valor := COALESCE(_valor, public.get_indicacao_valor_comissao());

  -- Garante carteira do padrinho (paranoia)
  INSERT INTO public.carteiras_indicacao (user_id)
  VALUES (_padrinho_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- INSERT idempotente por (pagamento_id, tipo='credito_indicacao')
  INSERT INTO public.movimentacoes_indicacao
    (padrinho_id, afilhado_id, pagamento_id, referencia, valor, tipo, status, descricao)
  VALUES
    (_padrinho_id, _afilhado_id, _pagamento_id, _referencia, v_valor,
     'credito_indicacao', 'pendente', _descricao)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_mov_id;

  -- Se houve conflito (já existia), sai sem mexer em saldo nem notificação
  IF v_mov_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Atualiza carteira (mesma transação)
  UPDATE public.carteiras_indicacao
     SET saldo_pendente   = saldo_pendente + v_valor,
         total_indicacoes = total_indicacoes + 1
   WHERE user_id = _padrinho_id;

  -- Nome do afilhado para a notificação
  SELECT nome INTO v_nome_afil FROM public.profiles WHERE id = _afilhado_id;

  INSERT INTO public.notificacoes_indicacao (user_id, tipo, titulo, mensagem, payload)
  VALUES (
    _padrinho_id,
    'nova_comissao_indicacao',
    'Nova comissão de indicação',
    'Você ganhou R$ ' || to_char(v_valor, 'FM999990D00') ||
    ' por indicar ' || COALESCE(v_nome_afil, 'um novo usuário') || '. Liberação em ' ||
    public.get_indicacao_dias_bloqueio() || ' dias.',
    jsonb_build_object(
      'valor', v_valor,
      'afilhado_id', _afilhado_id,
      'nome_afilhado', v_nome_afil,
      'pagamento_id', _pagamento_id,
      'referencia', _referencia,
      'dias_bloqueio', public.get_indicacao_dias_bloqueio()
    )
  );

  RETURN v_mov_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_comissao_indicacao(uuid,uuid,uuid,text,numeric,text) TO service_role;

-- ============ 8) RPC liberar_comissoes_indicacao ============
CREATE OR REPLACE FUNCTION public.liberar_comissoes_indicacao()
RETURNS TABLE(liberadas integer, canceladas integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dias        integer := public.get_indicacao_dias_bloqueio();
  v_liberadas   integer := 0;
  v_canceladas  integer := 0;
  r             record;
  v_pag_status  text;
  v_afil_existe boolean;
BEGIN
  FOR r IN
    SELECT id, padrinho_id, afilhado_id, pagamento_id, valor, referencia
      FROM public.movimentacoes_indicacao
     WHERE tipo = 'credito_indicacao'
       AND status = 'pendente'
       AND created_at < now() - (v_dias || ' days')::interval
     FOR UPDATE
  LOOP
    -- Verifica fraude real
    v_pag_status := NULL;
    IF r.pagamento_id IS NOT NULL THEN
      SELECT status INTO v_pag_status FROM public.pagamentos_pix WHERE id = r.pagamento_id;
    END IF;

    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = r.afilhado_id) INTO v_afil_existe;

    IF (r.pagamento_id IS NOT NULL AND v_pag_status IS NOT NULL
        AND v_pag_status NOT IN ('pago'))
       OR NOT v_afil_existe THEN
      -- Cancela e reverte saldo pendente
      UPDATE public.movimentacoes_indicacao
         SET status = 'cancelado', liberado_em = now()
       WHERE id = r.id;

      UPDATE public.carteiras_indicacao
         SET saldo_pendente   = GREATEST(0, saldo_pendente - r.valor),
             total_indicacoes = GREATEST(0, total_indicacoes - 1)
       WHERE user_id = r.padrinho_id;

      v_canceladas := v_canceladas + 1;
    ELSE
      -- Libera: pendente -> disponivel
      UPDATE public.movimentacoes_indicacao
         SET status = 'disponivel', liberado_em = now()
       WHERE id = r.id;

      UPDATE public.carteiras_indicacao
         SET saldo_pendente   = GREATEST(0, saldo_pendente - r.valor),
             saldo_disponivel = saldo_disponivel + r.valor
       WHERE user_id = r.padrinho_id;

      INSERT INTO public.notificacoes_indicacao (user_id, tipo, titulo, mensagem, payload)
      VALUES (
        r.padrinho_id,
        'comissao_liberada',
        'Comissão liberada',
        'Sua comissão de R$ ' || to_char(r.valor, 'FM999990D00') || ' está disponível para saque.',
        jsonb_build_object(
          'valor', r.valor,
          'movimentacao_id', r.id,
          'pagamento_id', r.pagamento_id,
          'referencia', r.referencia
        )
      );

      v_liberadas := v_liberadas + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_liberadas, v_canceladas;
END;
$$;

GRANT EXECUTE ON FUNCTION public.liberar_comissoes_indicacao() TO service_role;

ALTER TABLE public.pagamentos_pix
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ============ 9) BACKFILL idempotente do legado metadata.comissao_padrinho ============
WITH inseridos AS (
  INSERT INTO public.movimentacoes_indicacao
    (padrinho_id, afilhado_id, pagamento_id, referencia, valor, tipo, status, descricao, created_at)
  SELECT
    (p.metadata->'comissao_padrinho'->>'padrinho_id')::uuid,
    (p.metadata->'comissao_padrinho'->>'afilhado_id')::uuid,
    p.id,
    'legado_metadata',
    COALESCE((p.metadata->'comissao_padrinho'->>'valor')::numeric, 5.00),
    'credito_indicacao',
    'pendente',
    'Importado de metadata.comissao_padrinho',
    COALESCE(
      (p.metadata->'comissao_padrinho'->>'registrada_em')::timestamptz,
      p.data_pagamento,
      p.created_at
    )
  FROM public.pagamentos_pix p
  WHERE p.status = 'pago'
    AND p.metadata ? 'comissao_padrinho'
    AND (p.metadata->'comissao_padrinho'->>'padrinho_id') IS NOT NULL
    AND (p.metadata->'comissao_padrinho'->>'afilhado_id') IS NOT NULL
    AND (p.metadata->'comissao_padrinho'->>'padrinho_id')::uuid IN (SELECT id FROM public.profiles)
  ON CONFLICT DO NOTHING
  RETURNING padrinho_id, valor
),
agregados AS (
  SELECT padrinho_id, SUM(valor) AS total_valor, COUNT(*) AS total_count
    FROM inseridos
   GROUP BY padrinho_id
)
UPDATE public.carteiras_indicacao c
   SET saldo_pendente   = c.saldo_pendente + a.total_valor,
       total_indicacoes = c.total_indicacoes + a.total_count
  FROM agregados a
 WHERE c.user_id = a.padrinho_id;
