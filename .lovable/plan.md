## Objetivo
Confirmar que `ASAAS_ENV=production` está ativo e forçar redeploy das 3 Edge Functions Asaas para garantir que os secrets atuais (ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN, ASAAS_ENV) estejam carregados no runtime.

## Observação importante
Não é possível ler o **valor** de um secret — apenas confirmar que existe. O valor `production` foi definido por você ao salvar o secret. A auditoria anterior já confirmou que `ASAAS_ENV` está listado nos secrets do projeto.

## Passos

1. **Confirmar presença dos 3 secrets** via `fetch_secrets`:
   - `ASAAS_API_KEY` ✓
   - `ASAAS_WEBHOOK_TOKEN` ✓
   - `ASAAS_ENV` ✓ (valor definido por você como `production`)

2. **Redeploy das 3 Edge Functions Asaas** via `supabase--deploy_edge_functions`:
   - `gerar-pix-asaas`
   - `asaas-webhook`
   - `verificar-pagamentos-asaas`

3. **Validar deploy** chamando `gerar-pix-asaas` com payload inválido (ex.: sem auth) e verificando nos logs que o runtime carregou a função sem erro de boot/secret faltando.

## Não será feito
- Nenhuma alteração de código.
- Nenhum redeploy das funções Efí (já retornam 410 Gone).
- Nenhuma alteração de regra de negócio.
