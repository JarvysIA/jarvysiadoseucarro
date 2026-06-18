## Problema

Webhook da Asaas chegou (pagamento confirmado), mas o pipeline pós-pagamento quebra com:

```
Could not find the 'data_pagamento' column of 'pagamentos_pix' in the schema cache
```

O código em `supabase/functions/_shared/pagamento-pipeline.ts` tenta gravar `data_pagamento` no UPDATE, mas a tabela `pagamentos_pix` nunca teve essa coluna. Como o UPDATE falha logo no passo 2, nada depois roda: o status não vira `pago`, o veículo não vira `ativo`, o `profiles.status_usuario` não vai para `ativo`, `permite_indicacao` continua falso e a comissão de indicação não é registrada. Por isso o usuário continua em trial mesmo após pagar.

## Correção (mínima, sem mexer no que funciona)

1. **Migration** — adicionar a coluna ausente na tabela `pagamentos_pix`:
   ```sql
   ALTER TABLE public.pagamentos_pix
     ADD COLUMN IF NOT EXISTS data_pagamento timestamptz;
   ```
   Sem novos grants/policies (a tabela já tem RLS e o webhook usa service role).

2. **Backfill dos pagamentos órfãos** — para cada linha em `pagamentos_pix` que está com `status != 'pago'` mas cujo Asaas já confirmou (caso atual do usuário), reprocessar via pipeline. Fluxo seguro:
   - Listar pagamentos recentes em status `pendente` com `metadata->>asaas_payment_id` preenchido.
   - Chamar `verificar-pagamentos-asaas` (ou reexecutar `confirmarPagamento` no shared) para cada um — o pipeline é idempotente (`if status === 'pago' return already`) e agora rodará até o fim, ativando o usuário, o veículo e disparando a indicação.
   - Como alternativa mais simples para o caso reportado: identificar o `pagamento_id` afetado por SQL e invocar `verificar-pagamentos-asaas` uma vez; ele consulta a Asaas e chama `confirmarPagamento`.

3. **Redeploy** das funções `asaas-webhook` e `verificar-pagamentos-asaas` (apenas para garantir cache do schema atualizado no PostgREST do Edge).

## O que NÃO muda

- Nenhuma alteração em `gerar-pix-asaas`, `CpfRequiredModal`, `CheckoutPremiumModal`, `PaywallModal`, `ProfileSettingsModal`.
- Nenhuma alteração em RLS, grants, policies, secrets ou config.
- Nenhuma alteração no fluxo de CPF que acabou de funcionar.
- Nenhuma alteração no contrato dos webhooks/respostas.

## Resultado esperado

- Próximos pagamentos: webhook grava `status='pago'` + `data_pagamento`, ativa veículo, ativa usuário (`status_usuario='ativo'`, `permite_indicacao=true`) e registra a comissão do padrinho — banner de trial some e a indicação é liberada.
- Usuário atual: depois do backfill, mesmo efeito retroativamente.
