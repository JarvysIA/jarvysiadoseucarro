-- Audit-Log (item 15): registra as ações administrativas/sensíveis do
-- sistema. Hoje só 2 ações existem: updateUserStatusFn (super admin muda
-- o plano/status_usuario de outro usuário) e deactivateAccountFn (usuário
-- desativa a própria conta). Sem UI de visualização ainda (item 17, build
-- futuro) — este build só registra.

CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- Sem policy pra usuário comum — só service_role acessa (mesmo padrão de
-- outras tabelas internas do projeto: logs_erro_bonificacao, ai_usage_events).

CREATE INDEX idx_audit_log_actor ON public.audit_log (actor_id, created_at);
CREATE INDEX idx_audit_log_target ON public.audit_log (target_id, created_at) WHERE target_id IS NOT NULL;
