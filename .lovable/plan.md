# Fase 1 — Migração Efí → Asaas (plano final aprovado nos ajustes)

## Pré-checagens confirmadas
- `pagamentos_pix.metadata jsonb` existe e está vazio nos 7 registros — disponível.
- `profiles.asaas_customer_id` **existe** — reutilizada (sem migration).
- RPC `validar_cupom_indicacao(text) → uuid` existe — usada como fonte autoritativa do padrinho.
- Secrets `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` já cadastrados.

## Princípios desta fase
1. **Sem cópia literal do código Efí.** A lógica de pós-pagamento atual é re-expressa em um módulo novo, contendo **apenas o necessário ao fluxo Asaas**. Nenhuma refatoração fora de escopo.
2. **Pipeline pós-pagamento idempotente único.** `asaas-webhook` e `verificar-pagamentos-asaas` chamam a mesma função interna.
3. **`logs_erro_bonificacao` não é gravado nesta fase** — não há tentativa de PIX ao padrinho, logo não há falha de transferência a registrar.
4. **Zero migrations.** Sem novas tabelas, colunas ou policies.

## Regra comercial (sem recriar lógica no frontend)
- Sem cupom: R$ 29,90.
- Com cupom válido: R$ 19,90.
- Comissão padrinho: R$ 5,00 registrada em `metadata.comissao_padrinho` com `status='pendente'`. Nenhum pagamento ao padrinho nesta fase.
- Validação/desconto seguem `validar_cupom_indicacao` no backend.

---

## A. Arquivos a criar

### A.1 `supabase/functions/_shared/pagamento-pipeline.ts` (NOVO)
Função única **`confirmarPagamento({ supabase, pagamento_id })`** — escopo restrito ao fluxo Asaas:

1. Carrega `pagamentos_pix` por `id`. Se já `status='pago'`, retorna `{ ok:true, already:true }` (idempotente).
2. Marca `status='pago'`, `data_pagamento=now()`.
3. **Histórico** (`tipo_produto='historico'`): `veiculos.history_locked=false` em `produto_ref_id ?? veiculo_id`.
4. **Ativação** (`tipo_produto='ativacao'`):
   - `veiculos.status='ativo'`,
   - `profiles.status_usuario='ativo'`, `profiles.permite_indicacao=true`.
5. **Indicação** (somente `ativacao` com `codigo_cupom`):
   - `padrinho_id` ← RPC `validar_cupom_indicacao(codigo_cupom)`.
   - Se válido e ≠ `user_id`: vincula `profiles.referrer_id`.
   - Grava `metadata.comissao_padrinho` se ainda não existir:
     ```json
     { "padrinho_id", "afilhado_id": user_id, "pagamento_id": id,
       "codigo_cupom", "valor": 5.00, "chave_pix": <snapshot pix_recebimento>,
       "status": "pendente", "registrada_em": "<iso>" }
     ```
   - **Sem PIX, sem WhatsApp, sem `logs_erro_bonificacao`.**

Todas as escritas verificam estado prévio. Função **não** altera nada fora desses 5 passos.

### A.2 `supabase/functions/gerar-pix-asaas/index.ts` (NOVO)
Mesma assinatura I/O de `gerar-pix-efi` (`{ user_id, veiculo_id, valor, codigo_cupom?, tipo_produto?, produto_ref_id? }` → `{ success, id, pix_copia_cola, txid_efi }`).
- Customer: lê `profiles.asaas_customer_id`; se vazio, `POST /v3/customers` e atualiza.
- `POST /v3/payments` (`billingType:"PIX"`, `value`, `dueDate=hoje`).
- `GET /v3/payments/{id}/pixQrCode` → `payload`.
- Insere em `pagamentos_pix` reusando colunas: `txid_efi ← asaas_payment_id`, `pix_copia_cola ← payload`, `metadata ← { gateway:"asaas", asaas_payment_id, asaas_customer_id }`.

### A.3 `supabase/functions/asaas-webhook/index.ts` (NOVO)
- Valida header `asaas-access-token == ASAAS_WEBHOOK_TOKEN`.
- Eventos `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`.
- Localiza `pagamentos_pix` por `metadata->>'asaas_payment_id'` (fallback `txid_efi`).
- Chama **`confirmarPagamento`**. Responde 200.

### A.4 `supabase/functions/verificar-pagamentos-asaas/index.ts` (NOVO)
- Expira pendentes >1h (`status='expirado'`).
- Lista pendentes <1h com `metadata->>'gateway'='asaas'`.
- `GET /v3/payments/{asaas_payment_id}`; se `RECEIVED`/`CONFIRMED`, chama **a mesma** `confirmarPagamento`.
- Nenhuma duplicação de regra.

---

## B. Arquivos a alterar (mínimo)

### B.1 `src/components/PaywallModal.tsx`
Trocar `"gerar-pix-efi"` → `"gerar-pix-asaas"`. Nada mais.

### B.2 `src/components/CheckoutPremiumModal.tsx`
Trocar `"gerar-pix-efi"` → `"gerar-pix-asaas"`. Nada mais.

### B.3 Funções Efí (mesmo deploy)
`gerar-pix-efi`, `efi-webhook`, `verificar-pagamentos-pix`, `setup-webhook-efi` passam a responder **HTTP 410 Gone** `{ error: "gateway descontinuado" }`. Remoção de arquivos e secrets `EFI_*` em PR posterior.

---

## C. Tabelas tocadas (zero DDL)
- `pagamentos_pix` — insert/update `status`, `data_pagamento`, `metadata`.
- `profiles` — leitura `codigo_indicacao`/`pix_recebimento`; escrita `asaas_customer_id`, `status_usuario`, `permite_indicacao`, `referrer_id`.
- `veiculos` — `status`, `history_locked`.
- RPC `validar_cupom_indicacao` — leitura.
- `logs_erro_bonificacao` — **não tocada nesta fase**.

## D. Endpoints Asaas
`POST /v3/customers`, `POST /v3/payments`, `GET /v3/payments/{id}/pixQrCode`, `GET /v3/payments/{id}`.

## E. Secrets
Reusar `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN`. Adicionar `ASAAS_ENV` (`production`). `EFI_*` mantidos até a validação real concluir; removidos depois.

## F. Validação real (produção, contas controladas)
- **A** Ativação sem cupom R$ 29,90 → `veiculos.status='ativo'`, `profiles.status_usuario='ativo'`, **sem** `metadata.comissao_padrinho`.
- **B** Ativação com cupom R$ 19,90 → `metadata.comissao_padrinho` com `padrinho_id`, `afilhado_id`, `pagamento_id`, `status='pendente'`; **sem PIX enviado**, **sem `logs_erro_bonificacao`**.
- **C** Histórico R$ 49,90 → `veiculos.history_locked=false`.
- **D** Veículo extra R$ 9,90/mês → fase posterior.
- Sandbox Asaas: opcional, apenas para sanity de comunicação inicial.

## G. Riscos
1. Consolidação do pipeline padroniza `veiculos.status='ativo'` (hoje há divergência `'active'`/`'ativo'` entre polling e webhook Efí). Efeito colateral aceito.
2. Webhook Asaas mal configurado no painel — mitigado por `verificar-pagamentos-asaas` (janela 1h).
3. Comissão acumula como `pendente` sem rotina de quitação — aceito; pagamento ao padrinho é fase futura.
4. `validar_cupom_indicacao` é mais estrita que o fallback legado por `id`/prefixo do polling Efí. Alinha-se à regra oficial e ao `resolveReferrerId` do frontend.

## H. Ordem de execução
1. Criar `_shared/pagamento-pipeline.ts`.
2. Criar `gerar-pix-asaas`, `asaas-webhook`, `verificar-pagamentos-asaas`.
3. Tornar as 4 funções Efí inertes (HTTP 410).
4. Trocar nome da function nos 2 componentes do frontend.
5. Configurar `ASAAS_ENV=production` e webhook no painel Asaas (`/functions/v1/asaas-webhook`, header `asaas-access-token`).
6. Executar validações A, B, C; D depois.
7. PR de limpeza: remover arquivos e secrets `EFI_*`.

## I. Explicitamente fora de escopo
Tabela `comissoes_indicacao` dedicada; rotina/painel de pagamento ao padrinho; rename `txid_efi`; Asaas Transfer; WhatsApp ao padrinho; polling no `PaywallModal`; qualquer migration; qualquer mudança em OCR, IA, despesas, autenticação ou estrutura de veículos.
