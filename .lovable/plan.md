# Build 6.41A — Auditoria dos cards de saúde atuais x Plano Jarvys

## Escopo

Build 100% documental. Único arquivo criado:
`.lovable/build-6.41A-health-cards-vs-jarvys-plan-audit.md`.

Zero alteração de código funcional, zero banco, zero migration, zero IA, zero OCR, zero embedding, zero link Mercado Livre.

## Exploração já feita

Confirmei os componentes/helpers que alimentam os cards atuais:

- `src/lib/maintenance.ts` — `ITEM_DEFAULTS` (intervalos hardcoded: óleo 10k/12m, filtros 15k/12m, pneus 50k/60m, pastilhas 30k/36m, arrefecimento 40k/24m), `buildMaintenanceItems()` (usa overrides reais do banco + fallback determinístico), `computeStatus()` (km vs tempo, pior caso).
- `src/lib/predictive-maintenance.ts` — `nextMilestone`, `MILESTONE_STEP=10_000`, `ALERT_WINDOW=3_000`, sem teto, sem dismissal, sem itens.
- `src/components/NextRevisionCard.tsx` — apenas alerta, props `{ kmAtual }`.
- `src/components/MaintenancePanel.tsx` — sheet de detalhe por item, lê `MaintComputed`, lista `expenses`, dispara OCR/`parseReceiptFn` e save de despesa.
- `src/routes/app.tsx` — Home renderiza grade de 4 itens (`oleo`, `filtros`, `pastilhas`, `arrefecimento`) consumindo `km_ultima_troca_*` da tabela `veiculos` + `NextRevisionCard`.
- Tabela `veiculos`: colunas `km_atual`, `km_ultima_troca_oleo|filtros|pastilhas|arrefecimento` mantidas pela trigger `atualizar_revisao_veiculo` a cada nova despesa.
- Tabela `despesas`: categoria PT (Revisão, Manutenção, Óleo, Filtros, Pastilhas, Arrefecimento via `ITEM_TO_CATEGORIA`).

Restantes (correia, bateria, fluido de freio, câmbio, filtro de combustível isolado) não têm card próprio nem coluna no banco — entram como pendência no relatório.

## Estrutura do relatório

Seguir exatamente a estrutura solicitada:

1. Resumo executivo
2. Inventário dos cards/componentes encontrados (NextRevisionCard, grade de 4 itens em `app.tsx`, MaintenancePanel)
3. NextRevisionCard atual (props, helper, MILESTONE_STEP=10k, ALERT_WINDOW=3k, sem teto/dismissal/itens)
4. Cards de saúde por item/sistema (tabela: item × intervalo × fonte × hardcoded? × usa histórico? × conflito com Jarvys)
5. Tabelas e campos envolvidos (`veiculos.km_atual`, `veiculos.km_ultima_troca_*`, `despesas.categoria/data/valor`, trigger `atualizar_revisao_veiculo`)
6. Como lançamentos do usuário afetam os cards (OCR → `parseReceiptFn` → `despesas` → trigger atualiza `veiculos.km_ultima_troca_*` → `buildMaintenanceItems` lê override → `computeStatus` recalcula semáforo)
7. Divergências com o Plano Jarvys (filtros 15k vs pares/20k = relevante; óleo 10k = sem divergência; pastilhas 30k e arrefecimento 40k vs base 10k–200k = média; correia/bateria/fluido freio ausentes; câmbio ausente; filtro combustível agrupado)
8. Recomendação de arquitetura futura (Plano Jarvys como fonte técnica → cruzar com `km_ultima_troca_*` e despesas recentes → cards de saúde mantêm estado vivo; payload de próxima revisão filtra itens já feitos)
9. Riscos (quebrar Home autenticada, perder atualização via trigger, duplicar alertas, links para item recém-trocado)
10. Próximos builds recomendados (6.41B integração Plano×Histórico×Saúde; 6.42 search queries; 6.43 helper URL ML com afiliado)
11. Garantias do build (lista das 11 garantias confirmadas)

## Verificação

Como o único arquivo é markdown, sem typecheck. Mensagem final curta confirmando criação do relatório, zero alterações de código/banco/IA/OCR/embedding/links, e resumo dos principais achados (intervalos hardcoded em `maintenance.ts`, fluxo OCR→trigger→override, divergência relevante em filtros).
