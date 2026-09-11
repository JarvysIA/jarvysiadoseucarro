-- Plate-Api-Counter: registra cada chamada bem-sucedida às APIs externas de
-- placa/FIPE (placafipe.com.br), pra acompanhar consumo frente ao limite do
-- plano contratado (50 chamadas/dia hoje). Cobre os 3 cenários de consumo
-- (placa em cadastro novo, histórico FIPE em cadastro novo, atualização
-- mensal via cron) porque todos passam por consultar-placa/index.ts ou
-- consultar-historico-fipe/index.ts — instrumentar só esses 2 arquivos
-- captura tudo. Sem conversão pra R$ — só contagem.

CREATE TABLE public.plate_api_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plate_api_calls ENABLE ROW LEVEL SECURITY;
-- Sem policy pra usuário comum — só service_role acessa (mesmo padrão de
-- audit_log/ai_usage_events/manual_cost_entries).

CREATE INDEX idx_plate_api_calls_created_at ON public.plate_api_calls (created_at);
