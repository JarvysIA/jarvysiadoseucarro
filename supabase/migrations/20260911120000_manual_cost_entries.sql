-- Financial-Dashboard: lançamentos manuais de custo mensal (Hostinger,
-- Lovable, Z-API etc.) que hoje não têm integração automática de cobrança.
-- Sem UI própria de edição — só criação/exclusão pela aba "Financeiro" do
-- master-admin.

CREATE TABLE public.manual_cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  amount numeric NOT NULL,
  competencia date NOT NULL,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manual_cost_entries ENABLE ROW LEVEL SECURITY;
-- Sem policy pra usuário comum — só service_role acessa (mesmo padrão de
-- audit_log/ai_usage_events).

CREATE INDEX idx_manual_cost_entries_competencia ON public.manual_cost_entries (competencia);
