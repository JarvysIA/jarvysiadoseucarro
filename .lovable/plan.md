## Diagnóstico

O cupom é gerado em MAIÚSCULAS, mas o problema **não é caixa alta vs. minúscula** — a função `resolveReferrerId` (em `src/lib/referral.ts`) já usa `ILIKE`, que é case-insensitive.

O motivo real do "cupom inválido" é **RLS da tabela `profiles`**: as policies atuais só permitem ao usuário logado ler o próprio perfil. Quando ele tenta aplicar um cupom de outro usuário (padrinho), o `SELECT` em `profiles` não retorna nada — independente de maiúsculas/minúsculas.

Já existe a função `validar_cupom_indicacao(_codigo text)` no banco, `SECURITY DEFINER` e usando `ILIKE`, que retorna o `id` do padrinho ignorando RLS e ignorando caixa. Basta usá-la.

## Mudança

**Arquivo:** `src/lib/referral.ts` — função `resolveReferrerId`

1. Substituir a query direta em `profiles` por uma chamada RPC:
   ```ts
   const { data, error } = await supabase.rpc("validar_cupom_indicacao", { _codigo: code });
   if (data) return data as string;
   ```
2. Manter o fallback legado (prefixo de UUID) só se ainda houver usuários antigos — também usar RPC ou remover. Vou manter, mas só roda se o RPC não retornar nada.
3. Normalização: aplicar `trim()` (já existe). Não precisa `toUpperCase()` porque o `ILIKE` no SQL já é case-insensitive.

## Resultado esperado

- Cupom digitado em qualquer caixa (`joao-jarvys-1234`, `JOAO-JARVYS-1234`, `Joao-Jarvys-1234`) é aceito.
- Não há mais bloqueio por RLS, pois a validação ocorre dentro de uma função `SECURITY DEFINER`.
- Nenhuma alteração no banco, no PaywallModal, no pipeline de pagamento ou nas policies.
