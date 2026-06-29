# Build 6.41A — Auditoria dos cards de saúde atuais x Plano Jarvys

> Build **100% documental e read-only**. Nenhum código funcional, banco, IA, OCR, embedding, link Mercado Livre ou persistência foi tocado. Único arquivo criado: este markdown.

---

## 1. Resumo executivo

Os "cards de saúde" do veículo na Home (`/app`) **não são apenas um cronograma estático**: eles refletem um **estado vivo** composto por:

1. **Intervalo técnico hardcoded** em `src/lib/maintenance.ts` (`ITEM_DEFAULTS`).
2. **Último KM de troca real** vindo da tabela `veiculos` (colunas `km_ultima_troca_*`), mantidas por trigger Postgres a cada lançamento em `despesas`.
3. **Cálculo de semáforo** em `computeStatus()` que considera o pior caso entre dimensão `km` e dimensão `tempo`.

Existem **4 cards de item** na Home (óleo, filtros agrupados, pastilhas, arrefecimento) + **1 card de próxima revisão** (`NextRevisionCard`) baseado em marcos redondos de 10.000 km — totalmente desconectado do novo `maintenance_plan_json` gerado pelo pipeline Jarvys (Builds 6.39 / 6.40 / 6.41).

**Principais achados:**

- Intervalos atuais são **hardcoded** e **genéricos** (não dependem de marca/modelo/versão).
- A grade da Home cobre apenas **4 sistemas**. Bateria, correias, fluido de freio, câmbio e filtro de combustível isolado **não existem** como card nem como coluna no banco.
- O `NextRevisionCard` usa exclusivamente `nextMilestone(km)` — **não lê** o `maintenance_plan_json` nem o payload do Build 6.41.
- **Divergência relevante** com Jarvys: o card "Filtros" usa 15.000 km, mas o Plano Jarvys recomenda baseline em revisões pares (20.000 km).
- A integração futura **não deve substituir** os cards: o Plano Jarvys deve **alimentar** os candidatos da próxima revisão; o histórico do usuário (despesas + trigger) deve **filtrar** itens já feitos; os cards de saúde continuam mostrando estado vivo por sistema.

---

## 2. Inventário dos cards/componentes encontrados

| # | Componente / bloco | Arquivo | Renderizado em | Entrada | Tabelas/campos | Helper | Intervalo | Considera histórico do usuário? |
|---|---|---|---|---|---|---|---|---|
| 1 | `NextRevisionCard` | `src/components/NextRevisionCard.tsx` | `src/routes/app.tsx` (Home, abaixo do card do veículo ativo) | `{ kmAtual }` | `veiculos.km_atual` | `nextMilestone`, `kmUntilMilestone`, `isApproachingMilestone` de `src/lib/predictive-maintenance.ts` | Marco redondo a cada **10.000 km**, alerta dentro de **3.000 km** | **Não** — só usa o KM atual. Ignora despesas, ignora `km_ultima_troca_*`, ignora `maintenance_plan_json`. |
| 2 | Grade de 4 itens de saúde | `src/routes/app.tsx` (constante `ITEMS` + render do veículo selecionado) | Home `/app` | KM atual + overrides do banco | `veiculos.km_atual`, `veiculos.km_ultima_troca_oleo / filtros / pastilhas / arrefecimento` | `buildMaintenanceItems()` + `computeStatus()` de `src/lib/maintenance.ts` | Hardcoded em `ITEM_DEFAULTS` (ver §4) | **Sim** — via overrides reais; fallback determinístico só quando `null`. |
| 3 | `MaintenancePanel` (sheet de detalhe) | `src/components/MaintenancePanel.tsx` | Abre ao tocar em um item da grade da Home | `MaintComputed`, `expenses[]`, `kmAtual` | `despesas` (lista filtrada por item) | Reusa `MaintComputed` da Home; chama `parseReceiptFn` (OCR) e `onSave` (insert em `despesas`) | Mesmo do item correspondente | **Sim** — exibe histórico e dispara nova despesa, que aciona a trigger. |
| 4 | (admin-only) painel dry-run IA + payload próxima revisão | `src/routes/_authenticated/admin-corpus-smoke.tsx` | Apenas rota admin | Plano IA gerado em memória | — (não persiste) | `getNextMilestone`, `buildNextRevisionPayload` | Plano Jarvys 10k–200k + recurring | **Não** — ainda não cruza com `despesas`/`km_ultima_troca_*`. |

> Nenhum outro componente/rota relevante (`/dashboard`, `/revisoes`, `/despesas`, `/shopping`) renderiza "card de saúde" no sentido desta auditoria. `/revisoes` e `/despesas` listam transações, não estado.

---

## 3. `NextRevisionCard` atual

- **Arquivo:** `src/components/NextRevisionCard.tsx`.
- **Props:** `{ kmAtual?: number | null }`. Renderiza `null` se `kmAtual` ausente/`<=0`.
- **Helper:** `src/lib/predictive-maintenance.ts`.
- **Constantes:** `MILESTONE_STEP = 10_000`, `ALERT_WINDOW = 3_000`.
- **Cálculo da próxima revisão:**
  - `nextMilestone(km)`: se `km` cai exatamente em um múltiplo de 10k, mira o **seguinte** (`k + 10000`). Caso contrário, `ceil(km / 10000) * 10000`.
  - `kmUntilMilestone(km) = nextMilestone(km) - floor(km)`.
  - `isApproachingMilestone(km, 3000)` decide se entra no estado "alerta".
- **Teto de km:** **não há**. A função aceita qualquer KM e sempre devolve o próximo múltiplo de 10k. Não há modo "recurring" como no Build 6.40.
- **Status pós-revisão:** **não existe**. Assim que o KM ultrapassa o marco, o card já mira o próximo — sem janela `due_grace`, sem "última chamada".
- **Dismissal / não lembrar:** **não existe**. Não há `dismissedRevisionKms` aqui (existe apenas no painel admin do Build 6.40).
- **Itens listados:** **não**. O card mostra apenas o número do marco (`50.000 km`) e o "Faltam X km". Nenhum item técnico (óleo, filtros, etc.) é exibido — totalmente desacoplado do `maintenance_plan_json`.
- **Estado visual:** dois modos — `alert` (borda/fundo `--status-warn`) quando dentro de 3.000 km; senão card neutro (`bg-card`, ícone `Wrench`).

---

## 4. Cards de saúde por item / sistema

Fonte canônica: `src/lib/maintenance.ts` → `ITEM_DEFAULTS`.

| Item (`MaintItemKey`) | Nome exibido | Intervalo KM | Intervalo tempo | Hardcoded? | Coluna no banco | Atualizado por histórico? | Card próprio na Home? | Conflito com Plano Jarvys |
|---|---|---:|---:|---|---|---|---|---|
| `oleo` | Óleo e Filtro do Motor | 10.000 km | 12 meses | Sim | `veiculos.km_ultima_troca_oleo` | Sim (override real) | Sim | **Sem divergência** — baseline Jarvys também exige óleo+filtro em todas as 20 milestones (passo 10k). |
| `filtros` | Filtros (Ar/Cabine/Combustível) — **agrupados** | 15.000 km | 12 meses | Sim | `veiculos.km_ultima_troca_filtros` | Sim | Sim | **Divergência relevante** — Plano Jarvys trata os 3 filtros **separados** e recomenda em revisões **pares (20k em 20k)**. Card atual mistura tudo num único intervalo de 15k. |
| `pastilhas` | Pastilhas de Freio | 30.000 km | 36 meses | Sim | `veiculos.km_ultima_troca_pastilhas` | Sim | Sim | **Divergência leve** — Plano Jarvys posiciona em milestones específicas dentro do ciclo 10k–200k (depende da curva por veículo). 30k é uma aproximação razoável, mas não vem do plano. |
| `arrefecimento` | Arrefecimento | 40.000 km | 24 meses | Sim | `veiculos.km_ultima_troca_arrefecimento` | Sim | Sim | **Divergência leve** — Plano Jarvys posiciona conforme `system_profile.coolant_*`. 40k/24m é genérico. |
| `pneus` | Pneus | 50.000 km | 60 meses | Sim | — (sem coluna) | **Não** — fallback determinístico só | **Não** está na grade da Home (`ITEMS` em `app.tsx`) | Plano Jarvys não trata pneus como item de revisão programada; **sem conflito**. |
| `filtro de óleo` (separado) | — | — | — | — | — | — | **Não existe como card** (agrupado em "óleo") | Plano Jarvys trata como item próprio `filtro_oleo`; **divergência semântica**. |
| `filtro de ar do motor` | — | — | — | — | — | — | **Não existe** (agrupado em "filtros") | Plano Jarvys: `filtro_ar_motor` em pares; **divergência relevante**. |
| `filtro de cabine` | — | — | — | — | — | — | **Não existe** (agrupado em "filtros") | Plano Jarvys: `filtro_cabine` em pares; **divergência relevante**. |
| `filtro de combustível` | — | — | — | — | — | — | **Não existe** (agrupado em "filtros") | Plano Jarvys: `filtro_combustivel` em pares com label "confirmar aplicação"; **divergência relevante**. |
| `fluido de freio` | — | — | — | — | — | — | **Não existe** | Plano Jarvys trata; **pendência de produto**. |
| `correia dentada` / `poly-v` | — | — | — | — | — | — | **Não existe** | Plano Jarvys trata; **pendência de produto**. |
| `câmbio` (óleo de câmbio) | — | — | — | — | — | — | **Não existe** | Plano Jarvys trata via `system_profile.transmission_*` (inclui regra e-CVT do Build 6.34); **pendência de produto**. |
| `bateria` | — | — | — | — | — | — | **Não existe** como card (existe como categoria OCR em `CATEGORY_LABEL` do `MaintenancePanel`) | Plano Jarvys não trata como item de revisão programada; **sem conflito direto**. |
| `velas` | — | — | — | — | — | — | **Não existe** | Plano Jarvys trata em milestones altas; **pendência**. |

**Observações importantes:**

- Os intervalos são **idênticos para todo veículo** (Fiat Uno e BYD Song têm os mesmos 10k/15k/30k/40k). O sistema atual **não diferencia por marca/modelo/versão**.
- A escolha pelo "pior caso" (`km` vs `tempo`) em `computeStatus()` significa que um carro de baixa quilometragem **ainda pode acusar `warn`/`bad` por tempo decorrido** — útil para o usuário.

---

## 5. Tabelas e campos envolvidos

### `veiculos`

Campos lidos por `app.tsx`/cards de saúde:

- `id`, `placa`, `marca`, `modelo`, `ano`, `cor`, `chassi`, `foto_url` — identidade.
- `km_atual` — base de **todos** os cálculos de semáforo e do `NextRevisionCard`.
- `km_ultima_troca_oleo` — override real para o card "Óleo".
- `km_ultima_troca_filtros` — override real para o card "Filtros".
- `km_ultima_troca_pastilhas` — override real para o card "Pastilhas".
- `km_ultima_troca_arrefecimento` — override real para o card "Arrefecimento".

Esses 4 últimos campos são mantidos pela trigger Postgres `atualizar_revisao_veiculo` (citada em `src/lib/maintenance.ts` comentário) que dispara em `INSERT` na tabela `despesas`.

### `despesas`

Campos relevantes (ver `src/lib/despesas.ts` → tipo `Despesa`):

- `vehicle_id`, `data`, `valor`, `categoria` (PT-BR: `Revisão | Manutenção | Lavagem | Combustível | IPVA | Multas | Seguro | Acessórios` + categorias OCR `Óleo | Filtros | Pneus | Freios | Bateria | Outro` via `CATEGORY_LABEL` no `MaintenancePanel`), `descricao`, `km_registro`, `receipt_image_url`.
- Mapeamento card → categoria em `ITEM_TO_CATEGORIA` (`src/lib/maintenance.ts`): `oleo→"Óleo"`, `filtros→"Filtros"`, `pastilhas→"Pastilhas"`, `arrefecimento→"Arrefecimento"`.

### `profiles`

Sem relação direta com cards de saúde, exceto `is_super_admin` (gate do painel admin do Build 6.36–6.41) e `status_usuario` (gate de OCR via `plan-capabilities`).

### Trigger Postgres

`atualizar_revisao_veiculo` (mencionada em `src/lib/maintenance.ts`): a cada nova linha em `despesas`, lê `categoria` + `km_registro` e atualiza a coluna `km_ultima_troca_*` correspondente em `veiculos`.

### Tabelas que **não** alimentam cards de saúde hoje

- `vehicle_maintenance_profiles` — destinada ao `maintenance_plan_json` validado, mas **ainda não é lida** pelos cards (toda persistência foi adiada nos Builds 6.31–6.41).
- `jarvys_maintenance_corpus` — apenas alimenta o pipeline dry-run da IA.

---

## 6. Como lançamentos do usuário afetam os cards

Fluxo completo (verificado em `MaintenancePanel.tsx` + `app.tsx` + `maintenance.ts`):

```text
Usuário toca em um card de saúde → MaintenancePanel abre
   ↓
Caminho A (OCR):          Caminho B (Manual):
  Foto da nota              Form preenchido a mão
  → parseReceiptFn          → onSave(payload)
  → ConfirmForm
  → onSave(payload)
   ↓
INSERT em `despesas` (vehicle_id, categoria, km_registro, data, valor, descricao, receipt_image_url)
   ↓
Trigger Postgres `atualizar_revisao_veiculo`
   → UPDATE veiculos SET km_ultima_troca_<X> = NEW.km_registro WHERE id = NEW.vehicle_id
   ↓
Home recarrega (`useEffect` em `app.tsx` faz SELECT em veiculos com as 4 colunas km_ultima_troca_*)
   ↓
buildMaintenanceItems(vehicleId, kmAtual, overrides)
   → para a chave com override != null, usa overrideKm como `ultima_troca_km` e marca `ultima_troca_data = new Date()`
   ↓
computeStatus(item, kmAtual)
   → pctKm = (kmAtual - ultima_troca_km) / validade_km
   → pctTime = mesesDesdeUltimaTroca / validade_meses
   → status = pct >= 1 ? "bad" : pct >= 0.8 ? "warn" : "ok"
   ↓
Semáforo do card atualiza visualmente.
```

**Identificação do item trocado:**

- Item-key padronizado: **sim**, do lado do app (`MaintItemKey`), mapeado para `DespesaCategoria` via `ITEM_TO_CATEGORIA`.
- Categoria padronizada: **sim**, lista fechada em `CATEGORIAS` (`src/lib/despesas.ts`) + categorias OCR em `CATEGORY_LABEL` (`MaintenancePanel.tsx`).
- OCR: **sim** (`parseReceiptFn` retorna categoria, valor, data e descrição).
- Lançamento manual: **sim** (`ManualForm` no `MaintenancePanel`).
- Data + KM do serviço: **sim**, ambos no payload `MaintSaveInput` (`data_servico`, `km_registrada`).

**Pendência:** o app só atualiza 4 colunas (`oleo`, `filtros`, `pastilhas`, `arrefecimento`). Lançamentos das categorias `Revisão`, `Manutenção`, `Bateria`, `Pneus`, `Freios` (OCR) **não** têm coluna `km_ultima_troca_*` correspondente — a trigger pode ou não tratar; do lado app, **não há card para refletir**.

---

## 7. Divergências com o Plano Jarvys

| Sistema | Card atual | Plano Jarvys (6.39 / 6.39A) | Classificação | Decisão recomendada |
|---|---|---|---|---|
| Óleo do motor | 10.000 km / 12 meses (item único) | `oleo_motor` em **todas** as 20 milestones (10k em 10k) | **Sem divergência** | Manter card; usar Plano apenas como fonte de viscosidade/quantidade quando disponível (Build 6.37 mostrou que o corpus é insuficiente — atual `engine_oil_profile` retorna `null` para esses campos). |
| Filtro de óleo | Agrupado em "Óleo" | `filtro_oleo` separado, em todas as 20 milestones | **Divergência leve (semântica)** | Manter agrupamento na UI por hora; rastrear `filtro_oleo` no payload técnico. |
| Filtro de ar do motor | Agrupado em "Filtros" (15k) | `filtro_ar_motor` em **revisões pares (20k)** | **Divergência relevante** | Não usar Plano como gatilho de notificação enquanto card disser 15k; risco de mensagens conflitantes. |
| Filtro de cabine | Agrupado em "Filtros" (15k) | `filtro_cabine` em pares (20k) | **Divergência relevante** | Idem. |
| Filtro de combustível | Agrupado em "Filtros" (15k) | `filtro_combustivel` em pares (20k), `shopping_classification="inspect_before_buy"` quando dúvida | **Divergência relevante + precisa decisão de produto** | Manter agrupamento na UI até decidir se card "Filtros" vira 3 sub-cards. |
| Pastilhas de freio | 30.000 km / 36 meses | Posicionado conforme curva do veículo | **Divergência leve** | Card atual continua útil como semáforo; Plano Jarvys vira referência técnica. |
| Arrefecimento | 40.000 km / 24 meses | `system_profile.coolant_*` define janelas específicas | **Divergência leve** | Idem pastilhas. |
| Fluido de freio | **Inexistente** | Item presente no plano | **Precisa decisão de produto** | Criar card no futuro ou expor via "próxima revisão". |
| Correia dentada / poly-v | **Inexistente** | Item presente | **Precisa decisão de produto** | Idem. |
| Câmbio (óleo de câmbio) | **Inexistente** | `transmission_service_policy` + regra e-CVT (Build 6.34) | **Precisa decisão de produto** | Crítico não recomendar troca preventiva em e-CVT — manter alerta de "diagnóstico via scanner". |
| Velas | **Inexistente** | Em milestones altas | **Sem divergência ativa** (sem card hoje) | — |
| Bateria | Existe como categoria OCR, **sem card** | Não tratado | **Sem divergência** | — |
| Pneus | Existe no `ITEM_DEFAULTS` mas **fora da grade** | Não tratado | **Sem divergência** | — |

---

## 8. Recomendação de arquitetura futura (sem executar)

Modelo proposto em **3 camadas independentes** que se cruzam por `item_key`:

```text
Camada 1 — Plano Jarvys (técnico, por veículo)
  vehicle_maintenance_profiles.maintenance_plan_json
  → milestones[10k..200k] com items[].item_key, recommendation_type, applies

Camada 2 — Histórico do usuário (estado vivo)
  despesas + trigger atualizar_revisao_veiculo
  → veiculos.km_ultima_troca_<item> + linhas em despesas (data, km, categoria)

Camada 3 — Apresentação
  3a. Cards de saúde por sistema (Home)        ← já existe, mantém
       semáforo = f(km_atual, km_ultima_troca, validade_km/meses)
  3b. NextRevisionCard (Home)                  ← já existe, evolui
       hoje: nextMilestone genérico
       futuro: buildNextRevisionPayload(plan, km_atual, { dismissedRevisionKms, historico })
  3c. Painel "Próxima revisão" detalhado       ← futuro
       lista itemsToShow do payload 6.41,
       MENOS itens já registrados recentemente (cruzar com despesas)
```

**Regras de integração (proposta, não implementada):**

```text
SE existe maintenance_plan_json validado para o veículo:
  USAR Plano Jarvys como fonte técnica principal dos itens da próxima revisão.
  PARA CADA item da próxima milestone:
    SE existe despesa recente do mesmo item_key (≤ N dias OU ≤ M km):
      MARCAR como "já registrado recentemente" → remover de candidatos de Shopping
    SENÃO:
      INCLUIR em itemsToShow + itemsShoppingCandidates conforme regras do 6.41

SE NÃO existe maintenance_plan_json:
  FALLBACK: usar ITEM_DEFAULTS (intervalos genéricos), com aviso de "estimativa".

CARDS DE SAÚDE: continuam independentes (semáforo por km/tempo desde a última troca).
  Eles NÃO devem reproduzir o cronograma 10k–200k — eles mostram saúde por sistema.
```

**Não substituir e não remover** nenhum card existente. O Plano Jarvys é um **insumo adicional**, não um concorrente da grade atual.

---

## 9. Riscos de mexer nos cards agora

1. **Quebrar a Home autenticada** — `app.tsx` é grande (1284 linhas) e o `useEffect` inicial faz join implícito entre `profiles + veiculos + pagamentos_pix`; qualquer mudança nas colunas selecionadas pode quebrar a renderização.
2. **Perder atualização via trigger** — se trocarmos `km_ultima_troca_*` por leitura direta de `despesas`, perdemos a otimização da trigger e introduzimos N queries por veículo.
3. **Duplicar alertas** — se o `NextRevisionCard` passar a listar itens do plano e a grade de cards continuar com semáforo, o usuário pode ver "Trocar óleo" em dois lugares com mensagens diferentes.
4. **Conflito de intervalos** — card "Filtros" diz "faltam 1.500 km" (base 15k) enquanto a próxima revisão Jarvys diz "filtros em 20.000 km". O usuário não saberá qual seguir.
5. **Gerar links Mercado Livre para item recém-trocado** — se o payload 6.41 não cruzar com `despesas`, o Shopping vai sugerir comprar óleo que o usuário trocou ontem. Build 6.41B precisa resolver isso antes de qualquer link sair.
6. **Afetar OCR / lançamento manual** — `MaintenancePanel` depende de `MaintComputed` e de `ITEM_TO_CATEGORIA`. Renomear ou remover chaves quebra o fluxo de OCR e o `onSave`.
7. **Confundir veículos sem histórico** — `buildMaintenanceItems` tem fallback determinístico (mock) quando `km_ultima_troca_*` é `null`. Substituir cegamente pelo Plano Jarvys pode mostrar "Atrasado" para um carro recém-cadastrado sem nenhuma troca registrada.

---

## 10. Próximos builds recomendados

- **Build 6.41B — Plano de integração** (documental). Definir contrato de cruzamento `maintenance_plan_json × despesas × km_ultima_troca_* × cards de saúde`. Especificar a regra "já registrado recentemente" (janelas de km e dias por item) sem implementar.
- **Build 6.42 — Search queries de Shopping**. Helper puro que, a partir de `itemsShoppingCandidates` do payload 6.41 **menos** itens já registrados recentemente, gera strings de busca normalizadas (ex.: `"oleo motor 5w30 fiat argo 2023"`). Sem chamada de API, sem persistência.
- **Build 6.43 — Helper de URL Mercado Livre com afiliado**. Função pura `buildMercadoLivreUrl(query, options)` que aplica código de afiliado, filtro Full, loja oficial e parcelamento sem juros. Sem rede, sem persistência, sem render — apenas montagem de URL testável.
- (Posterior) Build 6.44+ — primeira UI real de "Próxima revisão detalhada" consumindo o payload 6.41, somente após 6.41B + persistência mínima do `maintenance_plan_json`.

---

## 11. Garantias do build

Confirmado nesta execução:

- [x] Zero alteração de código funcional.
- [x] Zero alteração de Home / Dashboard.
- [x] Zero alteração de `NextRevisionCard.tsx`, `predictive-maintenance.ts`, `app.tsx`, `dashboard.tsx`.
- [x] Zero alteração de `maintenance-next-milestone.ts`, `maintenance-next-revision-payload.ts`, `maintenance-plan-ai-dry-run.functions.ts`, `maintenance-plan-schema.ts`, `maintenance-plan-validation.ts`, `maintenance-corpus-*`, `maintenance-profiles.functions.ts`.
- [x] Zero banco / zero migration / zero policy / zero bucket.
- [x] Zero persistência.
- [x] Zero chamada de IA.
- [x] Zero chamada de OCR.
- [x] Zero chamada de embedding.
- [x] Zero link Mercado Livre / zero alteração de Shopping.
- [x] Arquivo único criado em `.lovable/build-6.41A-health-cards-vs-jarvys-plan-audit.md`.
