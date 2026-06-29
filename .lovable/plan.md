Build 6.41B — Ajuste cirúrgico dos intervalos dos cards de saúde

Objetivo
Ajustar somente os intervalos padrão em `ITEM_DEFAULTS` dentro de `src/lib/maintenance.ts`, deixando todo o restante do sistema inalterado.

Alteração esperada (único arquivo: src/lib/maintenance.ts)
- `filtros`: `validade_km` 15000 → 20000; `validade_meses` 12 → 24
- `pastilhas`: `validade_meses` 36 → 18 (`validade_km` permanece 30000)
- `oleo` e `arrefecimento`: sem alteração

Garantias preservadas
- Fluxo de lançamentos, overrides por `km_ultima_troca_*`, semáforo, MaintenancePanel, OCR/manual, trigger `atualizar_revisao_veiculo`, NextRevisionCard e payload 6.40/6.41 permanecem intactos.
- Nenhum arquivo além de `src/lib/maintenance.ts` será alterado.
- Zero banco, zero migration, zero IA, zero OCR, zero Shopping, zero links Mercado Livre.

Verificação
- `bunx tsgo --noEmit` após a alteração.

Arquivos envolvidos
- src/lib/maintenance.ts (2 linhas alteradas)