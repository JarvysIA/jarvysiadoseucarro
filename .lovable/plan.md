## Objetivo
Exibir QR Code real escaneável no checkout PIX Asaas, mantendo copia e cola e tudo mais intacto.

## Arquivos tocados (3)
1. `supabase/functions/gerar-pix-asaas/index.ts` — propagar `encodedImage` da resposta `/pixQrCode` do Asaas para o retorno da function.
2. `src/components/CheckoutPremiumModal.tsx` — renderizar `<img>` do QR Code acima do copia e cola.
3. `src/components/PaywallModal.tsx` — idem (cobre R$19,90 com cupom e R$49,90 do histórico, ambos usam este modal/CheckoutPremium).

Sem alteração em: banco/schema, webhook, pipeline, carteira de indicação, ativação, OCR, IA, veículos, valores, RPCs, RLS.

## Mudanças

### Edge function `gerar-pix-asaas`
- Ler também `encodedImage` (e `expirationDate`) do JSON de `/v3/payments/{id}/pixQrCode`.
- Incluir `qr_code_base64: encodedImage ?? null` no JSON de resposta (além do `pix_copia_cola` já existente).
- Não persistir nada novo no banco (o `encodedImage` pode ser regerado; mantém schema intacto).
- Não falhar se faltar `encodedImage` — apenas omitir o campo.

### Componentes de checkout
Em ambos os modais, quando `pixCopiaCola` estiver preenchido:
- Armazenar `qrCodeBase64` retornado pela function (novo state).
- Renderizar acima do bloco de copia e cola:
  - Se `qrCodeBase64` existir: `<img src={qrCodeBase64.startsWith("data:") ? qrCodeBase64 : \`data:image/png;base64,${qrCodeBase64}\`} alt="QR Code PIX" />` centralizado, ~220px.
  - Fallback: se a function não devolver `qr_code_base64`, gerar localmente a partir do `pix_copia_cola` usando a lib `qrcode` (adicionar `bun add qrcode` + `@types/qrcode`) renderizando em `<canvas>` ou `<img>` com `QRCode.toDataURL`.
- Manter intactos: botão Copiar, texto copia e cola, polling de status, valores.

## Critério de aceite
- R$29,90 (CheckoutPremium): QR aparece + copia e cola funciona.
- R$19,90 com cupom: idem.
- R$49,90 histórico (Paywall): idem.
- Pagamento via QR confirma normalmente (webhook/pipeline inalterados).