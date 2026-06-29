# Build 6.42C — Camada determinística Jarvys no dry-run IA

## Escopo

Alterar **somente** `src/lib/maintenance-plan-ai-dry-run.functions.ts`. Nenhum outro arquivo é tocado. Sem UI, sem banco, sem Shopping, sem ML, sem IA extra, sem OCR, sem persistência.

## Onde encaixa

No fluxo atual do handler (linhas ~1171–1212):

```
safeParseMaintenancePlanJson(parsedJson)
  → validation.success
    → validateMilestoneSchedule(validation.data)
    → validateBaselineItems(validation.data)
    → return valid:true / errors
```

A camada determinística entra **entre** o `safeParseMaintenancePlanJson` bem-sucedido e o `validateMilestoneSchedule`:

```
safeParseMaintenancePlanJson
  ↓
applyJarvysDeterministicMaintenanceRules(plan)   ← NOVO
  ↓
validateMilestoneSchedule
  ↓
validateBaselineItems
  ↓
valid / invalid (plano = retorno determinístico)
```

Os `warnings` retornados pela nova função são concatenados ao `baseWarnings` já usado em todos os `return` paths posteriores ao parse, de modo que aparecem mesmo quando schedule/baseline falham depois.

## Nova função

Adicionar ao mesmo arquivo, abaixo de `validateBaselineItems`:

```ts
function applyJarvysDeterministicMaintenanceRules(
  plan: MaintenancePlanJson,
): { plan: MaintenancePlanJson; warnings: string[] }
```

- Usa o tipo real já importado `MaintenancePlanJson` (não há tipo `MaintenancePlan` separado no arquivo). Sem schema paralelo, sem `as any`.
- Trabalha sobre um clone raso por milestone (`milestones.map(m => ({ ...m, items: [...m.items] }))`) para não mutar a entrada.
- Reutiliza helpers existentes: `normalizeText`, `isECvtTransmission`, `isPureElectricVehicle`, `normalizeForBaseline`.

## Detecção de elegibilidade

Helpers locais determinísticos baseados em `plan.vehicle_summary` + `plan.system_profile`:

- `isElectricOnly = isPureElectricVehicle(plan)` (reuso direto).
- `hasCombustionEngine`:
  - `false` se `isElectricOnly`;
  - `true` se `combustivel`/`motor_textual` contiver qualquer token combustão/híbrido: `flex`, `gasolina`, `etanol`, `alcool`, `diesel`, `hibrido`, `hybrid`, `hev`, `phev`, `dm-i`, `dmi`, `hsd`, `mhev`;
  - fallback `true` quando há `cilindradas > 0` e não é elétrico puro.
- `isECvt = isECvtTransmission(plan.vehicle_summary.transmissao) || normalizeText(motor_textual).includes("e-cvt"|"ecvt"|"hsd"|"dm-i")`.
- `isConventionalAutomatic`: `transmission_type` em `{automatico, cvt, automatizado, dupla_embreagem}` **e** `!isECvt`.
- `timingSystem = plan.system_profile.timing_system` (`correia_dentada` | `corrente` | `correia_banhada` | `desconhecido`).

## Regras aplicadas (somente se `hasCombustionEngine`)

### Parte 1 — Baseline em todas as milestones

- Garantir `oleo_motor` e `filtro_oleo` em **todas** as milestones do plano.
- Garantir `filtro_ar_motor`, `filtro_cabine`, `filtro_combustivel` nas milestones cujo `km ∈ {20000, 40000, …, 200000}`.
- Itens inseridos exatamente com os payloads do brief (campos `item_key`, `label`, `category`, `action`, `recommendation_type`, `shopping_classification`, `applies`, `confidence`, `source_type: "regra_jarvys"`).
- Inserir apenas no **final** de `milestone.items`; não sobrescrever existentes; não tocar `km`/`label`/`revision_number`.

### Parte 2 — Câmbio automático convencional

Se `isConventionalAutomatic`, garantir `oleo_cambio_automatico` (payload do brief, label sem "parcial"/"flush", orienta troca completa com equipamento especializado) em milestones com `km ∈ {40000, 80000, 120000, 160000, 200000}`.

Se `isECvt`, **não** inserir óleo CVT convencional. Se ainda não existir item de diagnóstico e-CVT no plano (busca global por `item_key` equivalentes), inserir `diagnostico_e_cvt` (payload do brief) nas milestones 100000 e 200000.

### Parte 3 — Sincronismo / correia

- `timingSystem === "correia_dentada"`: garantir `kit_sincronismo` nas milestones 60000, 120000, 180000.
- `timingSystem === "corrente"`: percorrer todos os itens de todas as milestones; para qualquer `item_key` equivalente a `correia_dentada`, `kit_correia_dentada`, `kit_sincronismo`, `sincronismo` → **não remover**, apenas mutar para `applies: false`, `recommendation_type: "not_applicable"`, `shopping_classification: "not_applicable"` (o schema exige `not_applicable` quando `applies=false`, e `service_only` violaria o `.superRefine`; o brief diz "padrão mais seguro do arquivo", e o padrão seguro aqui é o que o Zod aceita). Sem mexer em `not_applicable_items` (o schema permite, mas adicionar exige preencher `reason`/`label` e não é estritamente necessário para passar nas validações).
- `timingSystem === "correia_banhada"`: não gerar `kit_sincronismo`. Garantir `diagnostico_correia_banhada` nas milestones 60000, 100000, 150000, 200000. Se a IA tiver criado kit de correia dentada seca, marcar como `applies:false` + `not_applicable` (mesma mecânica do caso "corrente").
- `timingSystem === "desconhecido"`: não adicionar nem desabilitar nada de sincronismo.

### Parte 4 — Itens fora do escopo determinístico

Nunca inserir automaticamente: velas, bobinas, correia/poly V de acessórios, bomba d'água, pastilhas, fluido de freio, arrefecimento, suspensão, scanner, checklist. Continuam responsabilidade da IA/corpus.

### Parte 5 — Warnings

Formato:

- `jarvys_rule_added:{km}:{item_key}` quando insere item novo;
- `jarvys_rule_disabled:{km}:{item_key}` quando muta item existente para `not_applicable`.

## Detecção de duplicidade

Helper interno `hasEquivalentItem(milestoneItems, canonicalKey)` que normaliza `item_key` e `label` via `normalizeText` e checa contra os grupos de equivalência do brief:

- `oleo_motor`: `oleo_motor`, `oleo motor`, `oleo do motor`.
- `filtro_oleo`: `filtro_oleo`, `filtro oleo`, `filtro de oleo`.
- `filtro_ar_motor`, `filtro_cabine`, `filtro_combustivel`: por chave exata + label contendo o termo.
- `oleo_cambio_automatico`: `oleo_cambio`, `oleo cambio`, `fluido_cambio`, `fluido de cambio`, `oleo_cambio_automatico`, `kit_cambio_automatico`.
- `kit_sincronismo`: `kit_sincronismo`, `correia_dentada`, `kit_correia_dentada`, `sincronismo`.
- `diagnostico_correia_banhada`: `correia_banhada`, `diagnostico_correia_banhada`.
- `diagnostico_e_cvt`: `diagnostico_e_cvt`, `e-cvt`, `ecvt`, `sistema hibrido`/`sistema híbrido` (busca em label e item_key).

Sem `as any`; iteração com tipos do `MaintenancePlanJson`.

## Integração no handler

Substituir o bloco entre o `if (!validation.success)` e `validateMilestoneSchedule`:

```ts
const deterministic = applyJarvysDeterministicMaintenanceRules(validation.data);
const planAfterRules = deterministic.plan;
const combinedWarnings = [...baseWarnings, ...deterministic.warnings];
```

Todos os `return` posteriores (sucesso e erro de schedule/baseline) passam a usar `planAfterRules` e `combinedWarnings`. O contrato de retorno (`valid`, `plan`, `errors`, `warnings`, `ai`, `technical_context_debug`, `raw_preview`) permanece idêntico.

## Verificação

- `bunx tsgo --noEmit` → 0 erros.
- Teste manual em `/admin-corpus-smoke` cobrindo os 7 cenários do brief (BYD DM-i, Corolla híbrido, 208 PureTech, Onix 1.0 Turbo, Argo Firefly corrente, veículo com correia dentada comum, veículo automático convencional), conferindo:
  - baseline óleo+filtro em todas as milestones;
  - kit filtros nas pares;
  - kit sincronismo apenas em correia dentada;
  - diagnóstico em correia banhada;
  - itens de dentada desabilitados em motor de corrente e em correia banhada quando a IA inventar;
  - óleo/filtro câmbio automático nas milestones 40k/80k/120k/160k/200k apenas para automático convencional;
  - diagnóstico e-CVT em vez de óleo CVT para híbridos e-CVT;
  - warnings `jarvys_rule_added` / `jarvys_rule_disabled` aparecem no painel admin.

## Garantias

- Único arquivo alterado: `src/lib/maintenance-plan-ai-dry-run.functions.ts`.
- Não altera schema, validação, UI, Shopping helper, banco, edge functions.
- Não chama IA, OCR, embedding, rede, Supabase.
- Não persiste nada.
- Não adiciona velas/bobinas/poly V/bomba d'água/pastilhas/fluido de freio/arrefecimento automaticamente.
