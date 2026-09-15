-- Fix-Cupom-Promocional-Timing (achado M2, parte 2/2): confirmar_uso_cupom_promocional
-- é quem de fato credita o uso de um cupom promocional — chamada só na
-- confirmação real de pagamento (pagamento-pipeline.ts), nunca na geração
-- do PIX.
--
-- Revalida tudo de novo (ativo/não expirado/não esgotado) por defesa em
-- profundidade, mesmo já validado antes em validar_cupom_promocional — o
-- SELECT ... FOR UPDATE aqui trava a linha do cupom contra outra
-- confirmação concorrente do mesmo código estourar max_usos.
--
-- A garantia real de "1 resgate por pessoa, no total, pra sempre" não vem
-- dessa checagem por linha de cupom (duas confirmações concorrentes pra
-- CÓDIGOS DIFERENTES não travam a mesma linha) — vem da constraint UNIQUE
-- em cupons_promocionais_resgates.user_id: o INSERT só um dos concorrentes
-- consegue completar, o outro recebe unique_violation e devolve false sem
-- incrementar usos_atuais de coupon nenhum.
CREATE OR REPLACE FUNCTION public.confirmar_uso_cupom_promocional(
  p_codigo text,
  p_user_id uuid,
  p_pagamento_id uuid
)
RETURNS boolean
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
    RETURN false;
  END IF;

  BEGIN
    INSERT INTO public.cupons_promocionais_resgates (user_id, cupom_id, pagamento_id)
    VALUES (p_user_id, v_row.id, p_pagamento_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN false;
  END;

  UPDATE public.cupons_promocionais
     SET usos_atuais = usos_atuais + 1
   WHERE id = v_row.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_uso_cupom_promocional(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirmar_uso_cupom_promocional(text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.confirmar_uso_cupom_promocional(text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_uso_cupom_promocional(text, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.confirmar_uso_cupom_promocional(text, uuid, uuid) IS
  'Cupom-Promocional: credita atomicamente o uso de um cupom promocional na confirmação real de pagamento. Revalida ativo/expiração/limite (defesa em profundidade) e tenta inserir em cupons_promocionais_resgates — a constraint UNIQUE em user_id garante 1 resgate promocional por pessoa, no total, pra sempre; se o INSERT falhar por unique_violation, devolve false sem incrementar usos_atuais. Chamada só por pagamento-pipeline.ts (confirmarPagamento), nunca na geração do PIX.';
