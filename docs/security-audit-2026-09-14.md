# Auditoria de Segurança Adversarial — Jarvys (pré-lançamento)

Data: 2026-09-14. Escopo: código do repositório (React/TanStack Start, server functions, Supabase migrations, edge functions Deno, integrações Z-API e Asaas). Segunda opinião independente; nada foi corrigido — só reportado.

**Ressalva importante:** o repositório admite que algumas correções foram aplicadas "via SQL direto sem migration" (ver `20260909180000` e `20260909180001`). Tudo abaixo reflete o estado das migrations + código. Os itens marcados com ⚠️ devem ser confirmados no banco de produção antes de descartar (ex.: existe algum trigger em `auth.users` criando `profiles`? a policy de INSERT em `pagamentos_pix` ainda existe? `proteger_cadastro_veiculo` está anexada?).

Premissa de grants (confirmada pelos próprios comentários do repo em `20260717220110` e `20260807020600`): Supabase concede por padrão acesso total em tabelas novas e EXECUTE em funções novas para `anon`/`authenticated`. `REVOKE ... FROM PUBLIC` sozinho **não** remove esses grants.

---

## CRÍTICO

### C1. Qualquer usuário "paga" sem pagar e fabrica comissões reais — `pagamentos_pix` aceita INSERT do cliente
- **Onde:** `supabase/migrations/20260611025900_...sql` — `GRANT SELECT, INSERT ON pagamentos_pix TO authenticated` + policy `"Users can insert own payments" WITH CHECK (auth.uid() = user_id)`. Sem trigger, sem restrição de coluna, sem checagem de posse de `veiculo_id`. Consumidores que confiam em `status='pago'`: `src/lib/use-activated-vehicle-ids.ts`, `src/lib/use-current-plan.ts`, `src/lib/fipe.functions.ts:111`, orquestrador WhatsApp (`_shared/whatsapp/orchestrator/repository.ts:756`), relatório financeiro do admin.
- **Exploit 1 (ativação grátis):**
  ```http
  POST /rest/v1/pagamentos_pix   (Authorization: Bearer <JWT do usuário>)
  {"user_id":"<eu>","veiculo_id":"<meu veículo>","valor":0,"status":"pago","tipo_produto":"ativacao","data_pagamento":"2026-09-14T00:00:00Z"}
  ```
  O veículo passa a contar como ativado (R$29,90) em todo o app e no WhatsApp.
- **Exploit 2 (fábrica de comissão, dinheiro real):** insira uma linha `status:"pendente"`, `metadata:{"gateway":"asaas"}`, `txid_efi:"<id de um pagamento Asaas realmente pago — o próprio, lido via SELECT>"`, `codigo_cupom:"<código do cúmplice>"`. Em até 5 min o cron `verificar-pagamentos-asaas` consulta a Asaas, vê RECEIVED e chama `confirmarPagamento` com service_role: marca pago, ativa veículo, seta `status_usuario='ativo'` e chama `registrar_comissao_indicacao` (R$5,00 ao cúmplice). A idempotência é por `pagamento_id`, e cada linha forjada é um id novo → ilimitado. Um único PIX real de R$29,90 vira uma impressora de comissões.
- **Bônus:** `txid_efi`/`metadata.asaas_payment_id` iguais ao de uma vítima quebram o `.maybeSingle()` do webhook (`asaas-webhook/index.ts:52-62`) e podem impedir a confirmação legítima dela.
- **Impacto:** perda direta de receita + saída de dinheiro real via saque.

### C2. Auto-promoção a super admin / VIP no