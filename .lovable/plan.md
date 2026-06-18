## Problema

O usuário já tinha `asaas_customer_id` salvo no perfil (criado em tentativa anterior, antes do fluxo de CPF). O `ensureCustomer` faz early-return quando esse id existe e nunca envia o CPF para a Asaas — por isso o `/payments` continua falhando com "CPF ou CNPJ do cliente".

## Correção (somente `gerar-pix-asaas`)

Ajustar `ensureCustomer` em `supabase/functions/gerar-pix-asaas/index.ts`:

1. Ler `profile.cpf` sempre (não só quando não há customer).
2. Validar CPF (>= 11 dígitos). Se faltar → lançar `CpfRequiredError` como hoje (modal continua funcionando).
3. Se `asaas_customer_id` já existir:
   - Fazer `POST /customers/{id}` na Asaas com `{ cpfCnpj: cpfDigits, name, email, mobilePhone }` para atualizar o cadastro existente.
   - Se a Asaas responder 404 (customer apagado/desconhecido), limpar `asaas_customer_id` no perfil e cair no fluxo de criação.
   - Retornar o id existente.
4. Se não existir → criar normalmente (fluxo atual).

Depois, redeploy de `gerar-pix-asaas`.

## O que NÃO muda

- `CpfRequiredModal`, `CheckoutPremiumModal`, `PaywallModal`, `ProfileSettingsModal`, schema, webhook, `verificar-pagamentos-asaas`, pipeline, polling, secrets.
- Contrato da resposta (`success`, `pix_copia_cola`, `txid_efi`, `CPF_REQUIRED`) permanece idêntico.