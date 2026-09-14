-- Cupom-Promocional: cupons de desconto percentual criados por admin,
-- mecanismo separado do cupom de indicação (profiles.codigo_indicacao).
-- Escopo desta v1: só tipo_produto='ativacao'.

CREATE TABLE public.cupons_promocionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  desconto_percentual integer NOT NULL CHECK (desconto_percentual BETWEEN 1 AND 100),
  max_usos integer,
  usos_atuais integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  expira_em timestamptz,
  criado_por uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cupons_promocionais ENABLE ROW LEVEL SECURITY;
-- Sem policy pra usuário comum — só service_role acessa (mesmo padrão de
-- audit_log/ai_usage_events/manual_cost_entries/plate_api_calls).

CREATE UNIQUE INDEX idx_cupons_promocionais_codigo ON public.cupons_promocionais (upper(codigo));

-- validar_e_reservar_cupom_promocional: valida E incrementa usos_atuais na
-- mesma transação (atômica). Usa SELECT ... FOR UPDATE pra travar a linha
-- do cupom durante a checagem+incremento — sem isso, duas requisições
-- simultâneas poderiam ler usos_atuais < max_usos ao mesmo tempo e ambas
-- passarem, estourando o limite numa condição de corrida. Se inválido por
-- qualquer motivo (não existe, inativo, esgotado, expirado), devolve
-- (false, null) SEM incrementar nada.
CREATE OR REPLACE FUNCTION public.validar_e_reservar_cupom_promocional(p_codigo text)
RETURNS TABLE(valido boolean, desconto_percentual integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.cupons_promocionais%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM public.cupons_promocionais
   WHERE upper(codigo) = upper(p_codigo)
   FOR UPDATE;

  IF NOT FOUND
     OR v_row.ativo IS NOT TRUE
     OR (v_row.max_usos IS NOT NULL AND v_row.usos_atuais >= v_row.max_usos)
     OR (v_row.expira_em IS NOT NULL AND v_row.expira_em <= now())
  THEN
    RETURN QUERY SELECT false, NULL::integer;
    RETURN;
  END IF;

  UPDATE public.cupons_promocionais
     SET usos_atuais = usos_atuais + 1
   WHERE id = v_row.id;

  RETURN QUERY SELECT true, v_row.desconto_percentual;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_e_reservar_cupom_promocional(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validar_e_reservar_cupom_promocional(text) FROM anon;
REVOKE ALL ON FUNCTION public.validar_e_reservar_cupom_promocional(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.validar_e_reservar_cupom_promocional(text) TO service_role;

COMMENT ON FUNCTION public.validar_e_reservar_cupom_promocional(text) IS
  'Cupom-Promocional: valida um código (case-insensitive) e, se válido, incrementa usos_atuais atomicamente (SELECT ... FOR UPDATE evita corrida entre usos simultâneos estourarem max_usos). Devolve (false, null) se não existir, estiver inativo, esgotado ou expirado — sem incrementar nada nesse caso. Chamada por gerar-pix-asaas/index.ts via supabase.rpc antes do fallback pro cupom de indicação.';
