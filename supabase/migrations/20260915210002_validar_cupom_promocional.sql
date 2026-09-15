-- Fix-Cupom-Promocional-Timing (achado M2, parte 1/2): substitui
-- validar_e_reservar_cupom_promocional por uma função só de LEITURA.
--
-- Problema da função antiga: incrementava usos_atuais no momento de gerar
-- o PIX, não na confirmação do pagamento — permitia esgotar um cupom de N
-- usos gerando N PIX nunca pagos, sem gastar nada. A partir de agora,
-- validação (aqui) e reserva/confirmação real (confirmar_uso_cupom_promocional,
-- migration seguinte) são dois passos separados: validar_cupom_promocional
-- só checa se o cupom e a pessoa (p_user_id, novo parâmetro) estão
-- elegíveis, sem reservar nada; confirmar_uso_cupom_promocional é quem
-- efetivamente credita o uso, e só é chamada na confirmação real do
-- pagamento (pagamento-pipeline.ts).
--
-- Elegibilidade por pessoa: além das checagens de sempre (existe, ativo,
-- não expirado, não esgotado), agora também exige que a pessoa nunca
-- tenha uma linha em cupons_promocionais_resgates — decisão de produto:
-- 1 ativação promocional NO TOTAL por pessoa, para sempre, não importa o
-- código usado.
CREATE OR REPLACE FUNCTION public.validar_cupom_promocional(p_codigo text, p_user_id uuid)
RETURNS TABLE(valido boolean, desconto_percentual integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.cupons_promocionais%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM public.cupons_promocionais
   WHERE upper(codigo) = upper(p_codigo);

  IF NOT FOUND
     OR v_row.ativo IS NOT TRUE
     OR (v_row.max_usos IS NOT NULL AND v_row.usos_atuais >= v_row.max_usos)
     OR (v_row.expira_em IS NOT NULL AND v_row.expira_em <= now())
     OR EXISTS (SELECT 1 FROM public.cupons_promocionais_resgates WHERE user_id = p_user_id)
  THEN
    RETURN QUERY SELECT false, NULL::integer;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_row.desconto_percentual;
END;
$$;

REVOKE ALL ON FUNCTION public.validar_cupom_promocional(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validar_cupom_promocional(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.validar_cupom_promocional(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.validar_cupom_promocional(text, uuid) TO service_role;

COMMENT ON FUNCTION public.validar_cupom_promocional(text, uuid) IS
  'Cupom-Promocional: valida (case-insensitive) se um código está ativo/não expirado/não esgotado E se a pessoa (p_user_id) nunca teve um resgate promocional antes (1 por pessoa, no total, pra sempre). NÃO incrementa nem insere nada — pura leitura. Chamada por gerar-pix-asaas/index.ts. Reserva/confirmação real do uso é feita separadamente por confirmar_uso_cupom_promocional, só na confirmação de pagamento.';

-- Descontinua a função antiga, que reservava (incrementava usos_atuais) no
-- momento de gerar o PIX em vez de na confirmação do pagamento — era a
-- causa raiz do achado M2. Nenhum código do projeto a chama mais após
-- esta build (gerar-pix-asaas/index.ts migrado para validar_cupom_promocional
-- + confirmar_uso_cupom_promocional).
DROP FUNCTION IF EXISTS public.validar_e_reservar_cupom_promocional(text);
