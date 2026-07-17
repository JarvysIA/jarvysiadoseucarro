-- Build 5.7F2E1A.5-CLEANUP — Hardening de grants nas filas WhatsApp.
-- As duas tabelas têm RLS habilitado com ZERO policies, então anon/authenticated
-- já estão bloqueados por padrão-nega. Mas os grants default do Supabase pra
-- tabela nova (arwdDxtm pra anon/authenticated) ainda estão lá, inertes hoje mas
-- viram risco real se alguém desabilitar RLS ou adicionar uma policy permissiva
-- sem perceber esse excesso por trás. Removemos apenas o excesso; service_role,
-- postgres e sandbox_exec continuam intactos. RLS não é alterado. Nenhuma
-- policy é adicionada.

REVOKE ALL ON public.whatsapp_processing_queue FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_outbound_queue FROM anon, authenticated;
