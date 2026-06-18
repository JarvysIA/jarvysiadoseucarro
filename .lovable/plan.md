## Problema

Após pagamento, o carro some da lista do app. Causa:

- A lista de veículos (`src/routes/app.tsx` linha 180) filtra por `status = "active"` (inglês), que é o valor usado em `src/lib/vehicles.functions.ts` ao cadastrar.
- O pipeline pós-pagamento (`supabase/functions/_shared/pagamento-pipeline.ts`) marca o veículo como `status = "ativo"` (português).
- Resultado: o veículo passa de `active` → `ativo` e desaparece do filtro, mesmo continuando no banco.

## Correção

1. **Pipeline** (`supabase/functions/_shared/pagamento-pipeline.ts`): trocar `update({ status: "ativo" })` por `update({ status: "active" })` no passo de ativação. Mantém a convenção já usada no cadastro do veículo, sem mexer em nenhuma outra parte do fluxo.

2. **Redeploy** das funções que importam o pipeline: `asaas-webhook` e `verificar-pagamentos-asaas`.

3. **Backfill** do veículo do usuário que pagou agora (placa LMA2270, hoje com `status = "ativo"`): UPDATE pontual para `status = "active"`, devolvendo-o à lista. Nenhum outro veículo é afetado (os demais já estão em `active`/`archived`).

Nada mais é alterado: status do perfil, liberação de indicação, comissão, banner e webhook continuam exatamente como estão hoje.
