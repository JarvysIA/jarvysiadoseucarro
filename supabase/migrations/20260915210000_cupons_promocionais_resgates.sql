-- Fix-Cupom-Promocional-Timing (achado M2): tabela que garante 1 resgate
-- promocional por pessoa, NO TOTAL, pra sempre — decisão de produto já
-- confirmada, não importa o código usado. A constraint UNIQUE em user_id
-- é quem garante isso de forma atômica contra corrida (não uma checagem
-- em código): um segundo INSERT concorrente pra mesma pessoa falha na
-- constraint, não numa janela de leitura-e-escrita.
CREATE TABLE public.cupons_promocionais_resgates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE, -- 1 resgate promocional por pessoa, no total, pra sempre
  cupom_id uuid NOT NULL REFERENCES public.cupons_promocionais(id),
  pagamento_id uuid NOT NULL REFERENCES public.pagamentos_pix(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cupons_promocionais_resgates ENABLE ROW LEVEL SECURITY;
-- Sem policy pra usuário comum — só service_role acessa (mesmo padrão já
-- maduro do projeto: cupons_promocionais, audit_log, ai_usage_events,
-- manual_cost_entries, plate_api_calls).
