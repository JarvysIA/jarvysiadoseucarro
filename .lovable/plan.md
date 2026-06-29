
# Build 6.42B — Preview admin das buscas de Shopping

## Escopo

Alterar **somente** `src/routes/_authenticated/admin-corpus-smoke.tsx`. Nenhum outro arquivo é tocado. Sem URL Mercado Livre, sem afiliado, sem banco, sem IA, sem OCR, sem persistência.

## Onde encaixa

O arquivo já tem, no final, o componente `NextRevisionPayloadSubPanel` (linhas ~3200–3375) que calcula `payload = buildNextRevisionPayload(plan, km, { dismissed })` via `useMemo`. Logo abaixo dele (antes do `</section>` final desse sub-painel) será renderizado o novo sub-painel, recebendo o mesmo `payload` como prop para evitar recalcular.

## Mudanças

1. **Import novo** no topo do arquivo:
   - `import { buildMaintenanceShoppingSearchPayload } from "@/lib/maintenance-shopping-search";`

2. **Renderização do novo sub-painel** dentro de `NextRevisionPayloadSubPanel`, logo após o `<details>` final e antes do `</section>`:
   - `<ShoppingSearchPreviewPanel revisionPayload={payload} />`

3. **Novo componente local** `ShoppingSearchPreviewPanel`, definido logo abaixo de `NextRevisionPayloadSubPanel`:
   - Assinatura: `function ShoppingSearchPreviewPanel({ revisionPayload }: { revisionPayload: unknown })`.
   - `const shoppingPayload = useMemo(() => buildMaintenanceShoppingSearchPayload(revisionPayload), [revisionPayload]);`
   - Sem `as any`. Tipos vêm do próprio helper exportado.

## Conteúdo do painel

Card/section com borda tracejada, mesmo visual dos outros sub-painéis admin.

- **Cabeçalho**:
  - Título: `Buscas de Shopping — Build 6.42`
  - Descrição: `Prévia das buscas que futuramente serão convertidas em links do Mercado Livre. Nenhuma URL ou afiliado é gerado neste build.`

- **Resumo** (grid de `Stat`):
  - `ok` (`shoppingPayload.ok ? "true" : "false"`)
  - `vehicleSearchName` (ou "—")
  - `groups` (`shoppingPayload.groups.length`)
  - `linkGroups` (`shoppingPayload.linkGroups.length`)
  - `serviceGroups` (`shoppingPayload.serviceGroups.length`)

- **Estado vazio**: se `shoppingPayload.ok === false`, exibir aviso `Payload de Shopping indisponível para esta revisão.` + lista de `debug.warnings` (se houver), e parar por aí (manter footer/debug visíveis).

- **Link groups**:
  - Cabeçalho `Grupos com link futuro (Mercado Livre — Build 6.43)`.
  - Se vazio: `Nenhum grupo de peça/link futuro encontrado.`
  - Para cada grupo em `shoppingPayload.linkGroups`: bloco com
    - `title` (negrito)
    - `type` e `groupKey` (badges pequenos)
    - `Query: {searchQuery}` em fonte mono
    - `Itens: itemKey1, itemKey2…` (a partir de `items.map(i => i.itemKey).join(", ")`)
    - `compatibilityNote` (se não null)
    - `userNote`
  - Sem botão "Abrir Mercado Livre". Sem transformar query em link. Sem botão de copiar (não obrigatório).

- **Service groups**:
  - Cabeçalho `Grupos de serviço (sem link)`.
  - Se vazio: `Nenhum grupo de serviço encontrado.`
  - Para cada grupo em `shoppingPayload.serviceGroups`: `title`, `type`, `groupKey`, `userNote`. **Nunca** renderizar `searchQuery` para serviço.

- **Footer messages** (exatamente como vêm do payload):
  - `🛒 Adicione os itens ao seu carrinho e garanta as melhores ofertas para revisar seu carro.`
  - `🔎 Confirme a compatibilidade das peças antes de finalizar a compra.`

- **Debug** em `<details>` discreto:
  - `warnings` (lista)
  - `groupedItemKeys` (lista)
  - `ungroupedItemKeys` (lista)

## Garantias

- Não removo nem altero: `PlanReviewPanel`, painel de "Próxima revisão calculada", `NextRevisionPayloadSubPanel` (Payload limpo) e o `<details>` "Plano validado (JSON)".
- Não toco em nenhum dos arquivos listados como fora de escopo.
- `buildMaintenanceShoppingSearchPayload` é chamado uma vez via `useMemo` por render do sub-painel pai.

## Verificação

- `bunx tsgo --noEmit` → 0 erros.
- Teste manual no `/admin-corpus-smoke` com presets Fiat Argo (60.000 km), Chevrolet Onix 1.0 Turbo e BYD Song Plus DM-i, conferindo:
  - Argo: `kit óleo e filtro Fiat ARGO 1.0 Firefly 2023`, `kit filtros …`, `correia poly v acessórios …`.
  - Onix: `kit óleo e filtro …`, `kit filtros …`, `jogo velas ignição Chevrolet ONIX 1.0 turbo 2023`.
  - BYD e-CVT: diagnóstico aparece em `serviceGroups`, não em `linkGroups`, e nenhuma query de óleo CVT convencional é gerada.
