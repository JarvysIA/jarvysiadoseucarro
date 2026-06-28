# Build 6.35 — Relatório consolidado dry-run IA (documental, sem efeitos colaterais)

Relatório documental de auditoria. Nenhum código, banco, schema, corpus, profile, policy, bucket, UI ou flag será alterado. Será criado apenas o arquivo markdown `.lovable/build-6.35-dry-run-ia-report.md`, sem efeitos colaterais no app ou banco. Nenhuma IA, OCR ou embedding será chamado neste build. A validação é baseada nos resultados manuais já informados dos Builds 6.31–6.34.

## 1. Resumo executivo

Pipeline dry-run IA validado nos 7 presets manuais do `/admin-corpus-smoke`, seção "Dry-run IA do Plano de Manutenção". Cadeia confirmada:

`technical_context → prompt IA (6.32/6.33/6.34) → JSON puro → JSON.parse → safeParseMaintenancePlanJson → resultado validado na UI admin`.

Resultado agregado: **7/7 `valid=true`**, 0 errors, 1 warning operacional esperado (BYD Song Plus DM-i, `schema_sem_e_cvt_transmission_type`). Pipeline apto para a próxima fase controlada (revisão admin), ainda sem persistência.

## 2. Tabela consolidada dos 7 presets

| # | Veículo | expectedSlug / top | Status top | valid | errors | warnings | Observação técnica |
|---|---|---|---|---|---|---|---|
| 1 | Fiat Argo | fiat-argo-v1-2 | ok | true | 0 | 0 | Plano válido; corrente; manual; histórico desconhecido considerado. |
| 2 | Peugeot 208 | peugeot-208-v1-2 | ok | true | 0 | 0 | Plano válido; correia_banhada identificada; manual. |
| 3 | Chevrolet Onix | chevrolet-onix-v1-2 | ok | true | 0 | 0 | Plano válido após Build 6.33; `transmission_service_policy` corrigido para `preventiva_recomendada`. |
| 4 | Toyota Hilux | toyota-hilux-v1-2 | ok | true | 0 | 0 | Plano válido; diesel; automático; corrente. |
| 5 | Toyota Corolla Cross | toyota-corolla-cross-v1-2 | ok | true | 0 | 0 | Híbrido validado no dry-run; manter atenção futura para diferenciar e-CVT Toyota de CVT convencional quando o input técnico indicar e-CVT/Hybrid Synergy Drive. |
| 6 | BYD Song Plus DM-i | byd-song-plus-dm-i-v1-2 | ok | true | 0 | 1 | Plano válido após Build 6.34; warning `schema_sem_e_cvt_transmission_type`; e-CVT/DM-i não normalizado como CVT; fallback para `desconhecido`; recomendações voltadas a diagnóstico/scanner, sem troca preventiva padrão de óleo/filtro de câmbio. |
| 7 | BMW Série 3 | bmw-serie-3-v1-2 | ok | true | 0 | 0 | Plano válido; automático premium; recomendação de transmissão veio como diagnóstico/inspeção antes de compra/serviço, coerente com alta km e histórico desconhecido. |

## 3. Segurança validada

- Dry-run total — zero persistência em qualquer tabela.
- `upsertMaintenanceProfileFn` não chamado em nenhum dos 7 testes.
- `jarvys_maintenance_corpus` intocado: `reviewed_by_admin`, `published`, `quality_score`, `coverage_json`, `summary_json`, `version` inalterados.
- `vehicle_maintenance_profiles` intocado.
- FIPE, OCR, pagamentos, gates, Shopping, Home, signup, AddVehicleModal, WhatsApp e Push não acionados.
- `raw_preview` exibido truncado em bloco `<details>` na UI.
- `technical_context_debug` exibido apenas com metadados e scores; sem `extracted_text` completo, sem `storage_path`, `file_name`, `notes` ou signed URLs.
- Prompt completo do sistema não exibido na UI.
- `LOVABLE_API_KEY` lida apenas em `.handler()` no servidor; nunca exposta ao cliente.
- `requireSupabaseAuth` + `assertSuperAdmin` preservados em todas as funções admin envolvidas no fluxo dry-run.

## 4. Qualidade técnica observada

- Top match correto em 7/7 casos (slug esperado = slug retornado).
- Schema real do `maintenance_plan_json` respeitado após os ajustes 6.32–6.34.
- IA passou a obedecer `schema_version = "1.0.0"` de forma consistente.
- Campos obrigatórios sempre presentes: `vehicle_summary`, `base_rules`, `system_profile`, `milestones`, `metadata`.
- Enums de transmissão corrigidos: português em `system_profile.transmission_service_policy` e inglês em `items[].recommendation_type`, sem mistura.
- e-CVT tratado separadamente de CVT convencional (warning + fallback `desconhecido`).
- Regra de câmbio automático/CVT respeitada — sem troca parcial recomendada.
- Para perfis premium/alta km (BMW Série 3) houve tendência correta de diagnóstico antes de compra/serviço.
- Para correia banhada (Peugeot 208, Chevrolet Onix) houve destaque técnico apropriado.

## 5. Riscos e pendências antes de persistir

Ainda **não** é hora de salvar automaticamente em `vehicle_maintenance_profiles`. Pendências confirmadas:

- `coverage_json` vazio em 100% do corpus — seleção ainda fortemente dependente de `brand` + `model_group` + keywords; desambiguação fina entre versões/motorizações está cega.
- `quality_score = 0` em 100% do corpus — sem desempate por qualidade; empates caem em ordem alfabética.
- `reviewed_by_admin = false` e `published = false` em 100% do corpus — seletor público (RLS) continua retornando vazio por design; gate destrava por curadoria, não por código.
- Schema do plano ainda **não** possui `e_cvt` nativo em `transmission_type`; fallback atual é `desconhecido` + warning.
- Milestones gerados precisam de revisão de profundidade e consistência antes de virarem perfil oficial.
- Curadoria humana obrigatória antes de qualquer publicação/persistência.
- Granularidade do perfil salvo ainda não decidida: `model_group` vs versão vs motorização vs assinatura mecânica.
- Necessária UI de diff/review antes de qualquer upsert real.

## 6. Decisão de avanço

**APTO** para avançar ao Build 6.36, mantendo modo admin/dry-run ou review-only. **Não recomendado** liberar para usuário final nem habilitar persistência automática neste estágio.

## 7. Próximo build recomendado

**Build 6.36 — Tela admin de revisão do plano IA**

Escopo proposto:

- Renderização legível do plano validado, com seções:
  - resumo do veículo;
  - perfil de sistemas;
  - regras base;
  - milestones;
  - itens de manutenção;
  - alertas;
  - bundles;
  - JSON completo.
- Sem botões com persistência real — no máximo um botão "copiar JSON".
- Mantém `requireSupabaseAuth` + `assertSuperAdmin`, PII guards e dry-run total.

Persistência real fica para **Build 6.37 ou posterior**, com upsert controlado e revisão humana explícita (diff/aprovação).

## 8. Encerramento

- Nenhum código alterado.
- Nenhum dado alterado.
- Nenhum novo teste de IA executado.
- Validação consolidada com base nos resultados manuais informados dos Builds 6.31–6.34.
