## Build 6.39A — Baseline obrigatório por milestone no dry-run IA

**Arquivo único alterado:** `src/lib/maintenance-plan-ai-dry-run.functions.ts`
**Zero persistência. Zero alteração em schema/UI/banco.**

### Alteração 1 — Prompt: nova seção `REGRA CRÍTICA DE BASELINE POR MILESTONE`

Inserida em `buildSystemPrompt()` logo após a seção de cronograma 10k–200k, com 5 subseções:

1. **Combustão (flex/gasolina/etanol/diesel/híbrido com motor a combustão):** todas as 20 milestones devem conter `oleo_motor` e `filtro_oleo`. Itens maiores entram além — nunca substituem. Reforço explícito de que 100.000 km também leva óleo/filtro.
2. **Revisões pares (20k–200k):** devem conter `filtro_ar_motor`, `filtro_cabine`, `filtro_combustivel` como itens individuais (proibido colapsar em `kit_filtros`). `purchase_bundles` pode agrupar separadamente.
3. **Filtro de combustível incerto:** ainda incluir o item na milestone par, com label `"Filtro de combustível — confirmar aplicação conforme versão"` e `shopping_classification="inspect_before_buy"`. **Não tratar como erro técnico nesta fase.**
4. **Elétrico puro:** proibido emitir `oleo_motor`, `filtro_oleo`, `filtro_ar_motor`, `filtro_combustivel`, `velas`, `correia_dentada`, `kit_sincronismo`.
5. **Híbrido com motor a combustão:** elegível ao baseline; manter regra e-CVT.
6. **Óleo com `engine_oil_profile.status="insufficient"`:** label conservador, `shopping_classification="inspect_before_buy"`, `action="trocar"`, `recommendation_type="required"`, `applies=true`. Proibido inventar viscosidade/norma/litros/marca.

### Alteração 2 — Validação determinística pós-schema

Nova função `validateBaselineItems(plan)` chamada após `validateMilestoneSchedule()`, somente para veículos elegíveis (combustão).

**Heurística de elegibilidade** sobre `vehicle_summary.combustivel` + `motor_textual` (normalizados):
- Match exclusivo de `elétrico|eletrico|electric|ev|bev` sem indício de híbrido/combustão → **pular validação** (elétrico puro).
- Caso contrário (flex, gasolina, etanol, diesel, híbrido, hybrid, hev, phev, dm-i, hsd) → **aplicar baseline**.

**Constantes:**
- `EVEN_MILESTONE_KMS = [20000, 40000, 60000, 80000, 100000, 120000, 140000, 160000, 180000, 200000]`
- `BASELINE_ALL = ["oleo_motor", "filtro_oleo"]`
- `BASELINE_EVEN = ["filtro_ar_motor", "filtro_cabine", "filtro_combustivel"]`

**Erros emitidos (literais):**
- `Cronograma inválido: milestone {km} km sem oleo_motor.`
- `Cronograma inválido: milestone {km} km sem filtro_oleo.`
- `Cronograma inválido: milestone {km} km sem filtro_ar_motor.`
- `Cronograma inválido: milestone {km} km sem filtro_cabine.`
- `Cronograma inválido: milestone {km} km sem filtro_combustivel.`

Em caso de falha: `{ valid: false, plan: null, errors, warnings: baseWarnings, ai, technical_context_debug, raw_preview }` — mesmo shape já usado pelos retornos existentes.

> Observação: o item `filtro_combustivel`, quando incerto, ainda precisa estar presente (com label conservador + `inspect_before_buy`). Sua **ausência** continua sendo erro; apenas a aplicação real/SKU não é cobrada nesta fase.

### Invariantes

Sem mexer em: contrato de retorno, `safeParseMaintenancePlanJson`, `callLovableAi`, `stripJsonFences`, PII guard, `assertSuperAdmin`, `requireSupabaseAuth`, `technical_context_debug`, `raw_preview`, Shopping, banco, UI. Sem `as any`. Sem schema paralelo.

### Verificação

`bunx tsgo --noEmit` → 0 erros.

### Teste manual em `/admin-corpus-smoke`

- **Fiat Argo:** `valid=true`, 20 milestones, todas com óleo+filtro, pares com kit de filtros, 100k com óleo/filtro/kit além do checklist, óleo sem viscosidade inventada e `inspect_before_buy` quando `engine_oil_profile` insuficiente.
- **Chevrolet Onix:** baseline aplicado, kit filtros nas pares, correia banhada como inspeção/diagnóstico (não correia dentada comum).
- **BYD Song Plus DM-i:** baseline aplicado (híbrido com motor a combustão), e-CVT preservado (sem CVT convencional, sem bundle de óleo de câmbio CVT).

### Retorno ao usuário

Arquivo alterado, regras adicionadas, validação determinística, confirmação pares com kit filtros, elétrico puro como exceção, zero persistência, resultado do typecheck, instruções de teste.
