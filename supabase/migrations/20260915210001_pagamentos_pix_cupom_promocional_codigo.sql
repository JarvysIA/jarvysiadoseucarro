-- Fix-Cupom-Promocional-Timing (achado M2): coluna própria pra registrar
-- qual cupom promocional foi usado em cada pagamento — hoje isso só ia
-- pra dentro de metadata jsonb (cupom_codigo no caminho de 100%,
-- cupom_promocional no caminho normal). A partir desta migration essa
-- coluna é a fonte de verdade, usada em confirmar_uso_cupom_promocional
-- pra saber qual cupom confirmar/incrementar na hora do pagamento real.
ALTER TABLE public.pagamentos_pix ADD COLUMN IF NOT EXISTS cupom_promocional_codigo text;
