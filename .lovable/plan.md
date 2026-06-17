# Plano de Recuperação: Asaas Operacional (Vendas + Bonificação de Padrinhos)

## Conselho honesto antes do plano

Você não precisa de outra IA. O problema dos últimos dias **não foi de modelo**, foi de **escopo por prompt**. Aquele mega-prompt de 5 passos teria quebrado com qualquer IA — ele mistura banco + 3 edge functions + frontend + regras condicionais, tudo com dependências entre si. Quando algo dá errado no Passo 1, os Passos 2-5 constroem em cima de fundação torta e o bug fica invisível.

**Como vamos trabalhar daqui pra frente (regra de ouro):**
- 1 prompt = 1 mudança verificável.
- Sempre testar antes de seguir.
- Eu te aviso quando um passo está pronto pra teste, e só avanço com seu OK.
- Você **gasta menos crédito no total** assim, porque não precisa reverter coisas grandes.

Gemini/Claude são bons como "consultores de arquitetura" se você quiser uma 2ª opinião antes de me passar a tarefa. Mas a execução é mais barata e segura aqui, porque eu vejo seu código, banco, logs e secrets em tempo real.

## Estado atual após o rollback (verificado no código)

Edge functions presentes hoje:
- `gerar-pix-asaas` ✅
- `asaas-webhook` ✅
- `gerar-pix-efi` + `setup-webhook-efi` + `efi-webhook` ⚠️ (legado EFI, ainda no projeto)
- `verificar-pagamentos-pix`, `consultar-placa`, `consultar-historico-fipe` ✅

Frontend já chama `gerar-pix-asaas` em `CheckoutPremiumModal`, `MensalidadeVeiculoModal`, `PaywallModal`.

Secrets configurados: `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` ✅

## Roteiro incremental (cada etapa = 1 prompt = 1 teste)

### Etapa 1 — Validar o que JÁ funciona no Asaas hoje
Antes de mexer em qualquer linha, eu leio as 2 edge functions Asaas atuais e te entrego um diagnóstico curto: o que está ok, o que pode falhar, e o que falta. **Sem editar nada ainda.** Você confirma a lista de correções antes de qualquer escrita.

### Etapa 2 — Garantir geração de Pix de venda funcionando ponta-a-ponta
- Verificar `gerar-pix-asaas`: preço hardcoded no servidor (29,90 / 19,90 com cupom / 9,90 mensalidade / 49,90 histórico), criação de customer com CPF just-in-time, retorno de `encodedImage` + `payload`.
- Teste real: você gera um Pix de R$ 0,01 (modo teste) ou de ativação, paga, e confirma que aparece no painel Asaas.

### Etapa 3 — Garantir webhook Asaas recebendo e ativando conta
- Validar header `asaas-access-token` contra `ASAAS_WEBHOOK_TOKEN`.
- Idempotência: só processa `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` uma vez.
- Atualiza `pagamentos_pix.status = 'pago'`, `profiles.status_usuario = 'ativo'`, `assinaturas` conforme o tipo (ativacao / mensalidade / historico).
- Teste real: pagar um Pix e ver a conta ativar sozinha.

### Etapa 4 — Pagamento de bonificação ao padrinho (R$ 5 via Pix Asaas)
Esse é o motivo principal do seu desconforto com EFI (PF). Vamos:
- Criar/ajustar a função que dispara transferência Pix ao padrinho quando o afilhado paga uma ativação.
- Travas de segurança: anti-auto-referral (referrer ≠ usuário), anti-pagamento-duplo (só quando era trial antes), idempotência por `pagamento_id`.
- Se padrinho não tiver chave Pix cadastrada → log em `logs_erro_bonificacao` e segue sem quebrar.
- Teste real: simular indicação completa e ver R$ 5 saindo da conta Asaas.

### Etapa 5 — Limpeza do legado EFI
Remover `gerar-pix-efi`, `setup-webhook-efi`, `efi-webhook` e secrets EFI (`EFI_CERTIFICATE_BASE64`, `EFI_CLIENT_ID`, `EFI_CLIENT_SECRET`, `EFI_PIX_KEY`) **só depois** das etapas 2-4 testadas e aprovadas. Antes disso, EFI fica como rede de segurança.

### Etapa 6 — Configuração final no painel Asaas (você faz)
Eu te passo a URL exata do webhook e o token a colar. Você cola no painel Asaas e a integração fica viva.

## Próximo passo

Se você concordar com essa abordagem, eu começo pela **Etapa 1 (diagnóstico apenas, sem editar nada)** assim que você aprovar este plano. Aí você vê o que está bom e o que precisa mudar antes de gastar crédito em edição.

## Como você ajuda a economizar crédito daqui pra frente

1. **Sempre que possível, cole o erro exato** (mensagem do console, log da edge function) — eu vou direto na causa em vez de adivinhar.
2. **Diga o resultado do teste** depois de cada etapa ("paguei e ativou" ou "paguei e não ativou, log diz X").
3. **Não junte 3 pedidos em 1 prompt.** Se aparecerem 3 bugs, manda 1 por vez.

Topa começar pela Etapa 1?
