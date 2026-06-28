# Build 6.29 — Relatório de validação pré-IA

Auditoria diagnóstica somente-leitura. Nenhum dado, arquivo, policy, bucket, corpus, score ou flag de revisão foi alterado. Nenhuma IA, OCR ou embedding foi chamado.

## 1. Resultado geral

Corpus, seletor e `technical_context` estão **consistentes e seguros** para avançar para o próximo build (gerador IA em dry-run). Há um ponto de atenção real (coverage_json vazio em 100% dos registros) que **não bloqueia** o 6.30, mas precisa entrar no escopo da curadoria antes de qualquer publicação ou persistência.

## 2. Banco / corpus

Consulta a `public.jarvys_maintenance_corpus`:

| Métrica | Valor |
|---|---|
| total | 100 |
| storage_path preenchido | 100 |
| file_name preenchido | 100 |
| extracted_text preenchido | 100 |
| summary_json preenchido | 100 |
| published=false | 100 |
| reviewed_by_admin=false | 100 |
| quality_score=0 | 100 |
| version='1.2' | 100 |
| source_type='jarvys_pdf_v1' | 100 |
| texto < 200 chars | 0 |
| slugs duplicados | 0 |
| file_name duplicados | 0 |
| summary_json sem schema_version | 0 |
| summary_json.generated_by ≠ 'regex' | 0 |
| divergência text_stats.char_count vs length(extracted_text) | 0 |
| coverage_json vazio/`{}` | **100** |
| mechanical_families_json vazio | 0 |

Pipeline íntegro. **coverage_json vazio em 100%** é o achado mais relevante — ver Seção 8.

## 3. Storage

- Bucket `jarvys-corpus` existe, `public=false`.
- 100/100 paths seguem o padrão `corpus/{slug}/source.pdf`.
- Nenhum signed URL gerado nesta auditoria; nenhum PDF baixado.

## 4. Funções e segurança

Inspecionados: `src/lib/maintenance-corpus.functions.ts`, `maintenance-corpus-pdf.server.ts`, `maintenance-corpus-selection.functions.ts`, `maintenance-corpus-context.functions.ts`, `src/routes/_authenticated/admin-corpus-smoke.tsx`.

- `supabaseAdmin` aparece **somente** via `await import("@/integrations/supabase/client.server")` dentro de handlers/helpers admin. Nenhum import top-level em rota ou componente.
- `requireSupabaseAuth` presente em todas as server functions sensíveis (upsert, upload, signed download, extract, summary, seletor público, seletor admin, context admin).
- `assertSuperAdmin` presente em todas as funções admin/debug (upsert, upload, signed download, extract, summary, seletor admin, context admin).
- PII guard (`FORBIDDEN_KEYS` recursivo) presente em upsert, seletor público, seletor admin, context admin.
- Seletor público e seletor admin **não retornam** `extracted_text`, `storage_path`, `file_name`, `notes` nem signed URLs.
- `buildMaintenanceCorpusContextAdminFn` retorna apenas `text_excerpt` (limitado por `maxCharsPerDocument`, default 3000, hard cap 6000), nunca `extracted_text` completo nem caminhos/arquivos.

## 5. Seletor

- Seletor público (`selectMaintenanceCorpusForVehicleFn`) usa `context.supabase` (RLS aplicada como usuário autenticado), nunca `supabaseAdmin`, e filtra apenas registros publicados+revisados via RLS.
- Seletor admin (`selectMaintenanceCorpusForVehicleAdminFn`) exige super-admin e ignora `published`/`reviewed_by_admin` apenas para debug.
- Score determinístico: brand (+50), model_group (+40), modelo_fipe (+25), versao (+15), ano (+20/+5), coverage combustível/transmissão/cilindradas/motor/distribuição (+10 cada), keywords mecânicas (+3). Bônus de keywords é **fraco** e não decide ranking sozinho — saturação observada no 6.21 não distorce o top match.

## 6. Technical Context

Formato confirmado por leitura de código:

```
technical_context: {
  schema_version: "1.0.0",
  generated_by: "corpus_context_admin",
  vehicle_input: {...},
  selection: { totalCandidates, returned, limit, maxCharsPerDocument },
  documents: [ { slug, title, brand, model_group, year_*, score, reasons,
                 quality_score, reviewed_by_admin, published, version,
                 coverage_json, mechanical_families_json, summary_json,
                 text_excerpt, text_excerpt_char_count } ],
  warnings: string[]
}
```

- `documents` limitado por `limit` (1..5).
- `text_excerpt_char_count ≤ maxCharsPerDocument` por construção (corta em parágrafo/sentença respeitando hard cap).
- Sem `extracted_text` completo, sem storage/file/notes/signed URL.
- Warnings são apenas sinalização, não bloqueiam retorno.

## 7. Validação manual dos 7 casos (6.28)

Reaproveitada do Build 6.28; todos com top document correto e excerpts dentro do limite:

| Veículo | Top slug | Score | Candidates | Returned | Excerpt |
|---|---|---:|---:|---:|---:|
| Fiat Argo | fiat-argo-v1-2 | 123 | 18 | 3 | 2611 |
| Peugeot 208 | peugeot-208-v1-2 | 123 | 3 | 3 | 2994 |
| Chevrolet Onix | chevrolet-onix-v1-2 | 123 | 13 | 3 | 2854 |
| Toyota Hilux | toyota-hilux-v1-2 | 126 | 8 | 3 | 2842 |
| Toyota Corolla Cross | toyota-corolla-cross-v1-2 | 101 | 8 | 3 | 2928 |
| BYD Song Plus DM-i | byd-song-plus-dm-i-v1-2 | 98 | 2 | 2 | 2723 |
| BMW Série 3 | bmw-serie-3-v1-2 | 95 | 1 | 1 | 2777 |

Warnings esperados em todos: `corpus_em_curadoria`, `corpus_nao_publicado` (coerente com `reviewed_by_admin=false` e `published=false`).

## 8. Riscos pendentes

1. **coverage_json vazio em 100/100 registros** — os bônus de coverage do seletor (combustível, transmissão, cilindradas, motor, distribuição) nunca disparam hoje. Os top matches funcionam por brand+model_group, mas a desambiguação fina entre versões/motorizações está cega. Precisa ser preenchido na curadoria antes de publicar.
2. **quality_score=0 em 100/100** — sem desempate por qualidade; ranking cai em ordem alfabética em empates.
3. **reviewed_by_admin=false e published=false em 100/100** — seletor público (RLS) retorna vazio hoje. Esperado nesta fase, mas é o gate que precisa ser destravado por curadoria, não por código.
4. **summary_json é regex** — `cronograma_km` e `alertas_especificos` foram detectados em apenas ~10% no 6.21; é limitação do extrator, não do dado.
5. **Cobertura fora dos 100 PDFs** — qualquer veículo cujo `brand` não exista no corpus retorna 0 candidates; o 6.30 precisa tratar esse fallback antes de chamar IA.
6. **Persistência IA** — `upsertMaintenanceProfileFn` exige super-admin + Zod estrito; nada deve persistir sem dry-run + revisão humana.

## 9. Decisão de avanço

**APTO.** A fase de corpus + technical_context está consistente e segura para avançar para o primeiro gerador IA em modo dry-run, sem persistência. O risco de `coverage_json` vazio é conhecido e aceitável para um build dry-run que apenas valida o pipeline IA → schema.

## 10. Próximo build recomendado

**Build 6.30 — Gerador IA dry-run de `maintenance_plan_json` usando `technical_context`**

Escopo proposto:
- admin-only (`requireSupabaseAuth` + `assertSuperAdmin`);
- recebe os mesmos inputs do 6.27, monta `technical_context` internamente reutilizando `buildMaintenanceCorpusContextAdminFn`;
- chama Lovable AI Gateway com prompt determinístico pedindo JSON conforme `maintenance-plan-schema.ts`;
- valida via `parseMaintenancePlanJson` (Zod + superRefine do 5.x);
- retorna `{ plan | null, errors[], warnings[], usage }` para inspeção;
- **não persiste**, **não chama** `upsertMaintenanceProfileFn`, **não toca** corpus, FIPE, OCR, pagamentos, gates, Shopping, Home, signup, AddVehicleModal, `vehicle_maintenance_profiles`.
