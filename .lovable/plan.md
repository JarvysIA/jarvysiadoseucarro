## Objetivo
Antes de gerar o PIX no Asaas, garantir que o usuário tenha CPF cadastrado. Se não tiver, abrir um modal pedindo o CPF (informando que é exigência do Banco Central), salvar no perfil e prosseguir com a geração do PIX. Se já tiver, usar direto.

## O que já existe (não será alterado)
- Coluna `cpf` em `public.profiles` já existe.
- Edge function `gerar-pix-asaas` já lê `profile.cpf` e envia como `cpfCnpj` para o Asaas.
- Modal de perfil (`ProfileSettingsModal`) já existe — adicionaremos apenas um novo campo.

## Mudanças

### 1. Backend — `supabase/functions/gerar-pix-asaas/index.ts`
- Em `ensureCustomer`, se `profile.cpf` estiver vazio/nulo **e** ainda não existir `asaas_customer_id`, retornar erro estruturado:
  ```json
  { "error": "CPF_REQUIRED", "message": "CPF é obrigatório para gerar o PIX (exigência do Banco Central)." }
  ```
  com status 400, sem chamar a Asaas.
- Nenhuma outra regra é alterada. Fluxo de quem já tem CPF continua idêntico.

### 2. Novo componente — `src/components/CpfRequiredModal.tsx`
Modal pequeno com:
- Título: "Informe seu CPF"
- Texto explicativo: "Para gerar o PIX, o Banco Central exige o CPF do pagador. Ele será salvo no seu perfil e usado apenas para emissão da cobrança."
- Input com máscara `000.000.000-00`, validação de dígitos verificadores.
- Botões: Cancelar / Salvar e continuar.
- Ao salvar: `UPDATE profiles SET cpf = ... WHERE id = auth.uid()`, então chama callback `onConfirmed(cpf)`.

### 3. Integração em `CheckoutPremiumModal.tsx` e `PaywallModal.tsx`
Em ambos, na função `gerarPix`:
1. Antes de invocar a edge function, ler `profiles.cpf` do usuário (uma query rápida).
2. Se `cpf` estiver presente → fluxo atual inalterado.
3. Se `cpf` estiver vazio → abrir `CpfRequiredModal`. Após confirmação (CPF salvo), continuar automaticamente para `supabase.functions.invoke("gerar-pix-asaas", ...)`.
4. Fallback defensivo: se a edge function retornar `error === "CPF_REQUIRED"` (cobertura de borda), abrir o mesmo modal e repetir.

### 4. Campo CPF no `ProfileSettingsModal.tsx`
Adicionar novo input "CPF" (com máscara e validação), gravando em `profiles.cpf`. Opcional preencher; obrigatório apenas no momento da compra. Assim o usuário pode preencher antes e pular o modal no checkout.

## O que NÃO muda
- Schema do banco (coluna já existe).
- Webhook Asaas, `verificar-pagamentos-asaas`, `pagamento-pipeline.ts`.
- Fluxo de polling, liberação de histórico/ativação.
- Secrets, deploy de edge functions (apenas redeploy de `gerar-pix-asaas` pela mudança).
- Qualquer outra tela/comportamento.

## Validação
- Usuário novo sem CPF → clica gerar PIX → modal CPF abre → preenche → PIX é gerado.
- Usuário com CPF já no perfil → clica gerar PIX → PIX gerado sem modal.
- CPF inválido → bloqueado no front antes de salvar.