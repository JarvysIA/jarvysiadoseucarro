
# Build 6.42A — Helper puro `maintenance-shopping-search`

## Arquivo
- **Criar**: `src/lib/maintenance-shopping-search.ts` (único arquivo).
- Nenhum outro arquivo será tocado. Zero UI, zero URL, zero afiliado, zero banco, zero IA, zero persistência.

## Exports
- Tipos: `MaintenanceShoppingGroupType`, `MaintenanceShoppingGroup`, `MaintenanceShoppingSearchPayload` exatamente como especificado.
- Função: `buildMaintenanceShoppingSearchPayload(revisionPayload: unknown): MaintenanceShoppingSearchPayload`.

## Helpers defensivos (locais, sem `as any`)
- `isRecord`, `asArray`, `asString`, `asNumber`, `normalizeText` (lowercase + remoção de acentos + colapso de espaços, usado só para matching de keywords).

## Fluxo
1. Validar `revisionPayload`: se não for record, ou `ok !== true`, retornar payload vazio com warning `"payload_invalido_ou_nao_ok"` e `vehicleSearchName=""`.
2. Montar `vehicleSearchName` a partir de `vehicleSummary.{marca, modeloFipe, motorTextual, anoModelo}` — omitir faltantes, colapsar espaços duplicados.
3. Ler `itemsShoppingCandidates` e `itemsServiceOnly` (cada item já tem `itemKey/label/category/shoppingClassification/kind`).
4. Aplicar regras de agrupamento na ordem abaixo, marcando cada `itemKey` como consumido (no máximo um grupo de link por item):
   1. **engine_oil_kit** — exige `oleo_motor` + `filtro_oleo` simultaneamente.
   2. **filters_kit** — ≥2 de `filtro_ar_motor`, `filtro_cabine`, `filtro_combustivel`. Se só 1, cai para fallback.
   3. **transmission_oil_kit** — detecta por substring normalizada (`oleo_cambio`, `fluido_cambio`, `filtro_cambio`, `kit_cambio_automatico`, `transmissao`, `cambio_automatico`, `cambio_cvt`). Só candidatos. Query ramifica para CVT / ATF-automático / fallback. Não criar se item veio em `itemsServiceOnly` (e-CVT já marcado serviço fica de fora).
   4. **timing_kit** — `kit_sincronismo`, `correia_dentada`, `kit_correia_dentada`, `sincronismo`.
   5. **water_pump** — `bomba_agua`, `bomba_dagua`, `bomba d'agua` (após normalize).
   6. **accessory_belt** — `correia_acessorios`, `poly`, `poly-v`, `poly v`, `correia alternador`, `correia ar condicionado`, `correia ar-condicionado`, `correia acessorios`.
   7. **spark_plugs** — `velas`, `vela_ignicao`, `velas_ignicao`, `ignicao`.
   8. **brake_parts** — `pastilha`, `pastilhas`, `freio`. Fluido de freio em `itemsServiceOnly` não vira link (já filtrado pela origem).
   9. **single_part fallback** — qualquer candidato remanescente.
5. Para `itemsServiceOnly` gerar grupos `service_only` com `searchQuery=null`, `shouldCreateLink=false`, `userNote` fixo.
6. Compor saída:
   - `groups` = link groups + service groups (na ordem das regras).
   - `linkGroups` = subset com `shouldCreateLink=true`.
   - `serviceGroups` = subset `type==="service_only"`.
   - `footerMessages` literais conforme spec.
   - `debug.warnings`, `debug.groupedItemKeys`, `debug.ungroupedItemKeys` (não deve haver ungrouped quando há fallback, mas mantido para segurança).

## Detalhes técnicos
- Matching de keywords usa `normalizeText(itemKey + " " + label + " " + category)` e `includes` em tokens já normalizados.
- Queries de busca usam o `vehicleSearchName` cru (com acentos/casing preservados); não passar pelo normalize.
- Sem viscosidade, norma, marca ou quantidade nas queries — confirmado.
- Sem "flush", sem troca parcial, sem inventar CVT para e-CVT/serviço.
- Funções e tipos puros; sem efeitos colaterais; sem imports de runtime além de tipos.

## Verificação
- `bunx tsgo --noEmit` → 0 erros.

## Retorno ao usuário
- Arquivo criado, tipos exportados, regras implementadas, confirmação de zero UI/URL/afiliado/banco/IA, resultado do typecheck.
