# Build 6.37 — Auditoria do óleo do motor no corpus técnico Jarvys (documental, sem efeitos colaterais)

Relatório documental de auditoria read-only. Nenhum código, banco, schema, corpus, profile, policy, bucket, UI ou flag foi alterado. Nenhuma IA, OCR ou embedding foi chamado. O corpus foi consultado apenas com SELECT/read-only via a ferramenta segura disponível no ambiente Lovable/Supabase, sem INSERT/UPDATE/DELETE, sem signed URL e sem download de PDFs. Não há exposição de `extracted_text` completo, `storage_path`, `file_name`, `notes`, signed URL, JWT ou service_role.

Único arquivo criado: `.lovable/build-6.37-engine-oil-corpus-audit.md`.

## 1. Resumo executivo

**Veredicto: NÃO APTO** para montar hoje um `engine_oil_profile` estruturado e confiável a partir exclusivamente do corpus atual.

- O corpus tem boa cobertura estrutural (cronogramas, intervalos km, uso severo, filtros), mas é **pobre em dados de óleo de motor de granularidade fina** (viscosidade, normas API/ACEA/Dexos/Fiat, capacidade em litros).
- Persistir um `engine_oil_profile` neste momento implicaria inferência IA sem base textual verificável — exatamente o que o Build 6.37 quer evitar.
- É possível, com segurança, derivar apenas um **subconjunto** do perfil (intervalo de troca km/meses, `filter_required`, `requires_compatibility_confirmation=true`, `do_not_match_by_viscosity_only=true`). Viscosidade, especificações e quantidade em litros exigem nova fonte/etapa antes do Build 6.38.

## 2. Contrato-alvo (referência futura, não implementado)

```json
{
  "engine_oil_profile": {
    "viscosity": "0W-20",
    "specifications": ["API SP", "Dexos1 Gen3", "FIAT 9.55535-GSX"],
    "quantity_liters": 3.0,
    "filter_required": true,
    "replacement_interval_km": 10000,
    "replacement_interval_months": 12,
    "severe_use_interval_km": 5000,
    "severe_use_interval_months": 6,
    "requires_compatibility_confirmation": true,
    "do_not_match_by_viscosity_only": true,
    "notes": []
  }
}
```

Este bloco **não existe** no schema atual (`src/lib/maintenance-plan-schema.ts` / `maintenance-plan-validation.ts`). Hoje, óleo aparece diluído em `milestones[].items` e eventualmente `purchase_bundles`. Adicionar `engine_oil_profile` exige bump de `MAINTENANCE_PLAN_SCHEMA_VERSION` (Build 5.x futuro).

## 3. Inventário do corpus (agregado)

Tabela: `public.jarvys_maintenance_corpus`. Colunas relevantes para óleo: `extracted_text`, `summary_json`, `coverage_json`, `mechanical_families_json`, `quality_score`, `reviewed_by_admin`, `published`.

| Métrica | Valor |
|---|---|
| Total de documentos | 100 |
| `reviewed_by_admin = true` | 0 |
| `published = true` | 0 |
| `quality_score > 0` | 0 |
| `coverage_json` não vazio | 0 |
| `summary_json` não vazio | 100 |
| `extracted_text` com >100 chars | 100 |
| `extracted_text` — média de caracteres | ~12.573 |

Distribuição por marca (top 10): fiat 18, volkswagen 14, chevrolet 13, toyota 8, renault 8, hyundai 6, honda 6, ford 5, nissan 4, peugeot 3 (outras: caoa 3, jeep 3, byd 2, mitsubishi 2, citroen 2, bmw 1, gwm 1, ram 1).

`summary_json` segue um schema interno consistente (`schema_version`, `text_stats`, `generated_by`, `sections_detected`, `detected_keywords`) — útil para classificação grossa (transmissão, correia, uso severo), **não** carrega viscosidade nem normas de óleo.

## 4. Cobertura textual observada (heurística read-only em `extracted_text`)

| Termo / padrão | Documentos | % |
|---|---|---|
| Qualquer viscosidade `\d+W[- ]?\d+` (0W-20, 5W-30, 10W-40, etc.) | 0 | 0% |
| `0W-20`/`0W20` | 0 | 0% |
| `5W-30`/`5W40`/`10W-40`/`15W-40` | 0 | 0% |
| Palavra "viscosidade" | 0 | 0% |
| Tipo de óleo (sintético/semissintético/mineral) | 0 | 0% |
| `API SN/SP/SM` | 0 | 0% |
| `ACEA` | 0 | 0% |
| `Dexos` | 1 | 1% |
| Norma Fiat `9.55535` | 0 | 0% |
| Genérico "norma/API/ACEA/ILSAC" (substring) | 42 | 42% |
| "especificac…" | 11 | 11% |
| Capacidade em litros do óleo (`óleo … litros/L`) | 0 | 0% |
| "filtro de óleo" | 99 | 99% |
| Menciona "óleo" | 100 | 100% |
| Menciona "uso severo / condição severa" | 100 | 100% |
| Intervalo 10.000/15.000 km | 97 | 97% |

Leitura: o corpus atual é claramente um **texto normalizado/sanitizado** orientado a cronograma e estrutura. Ele descreve **que** existe troca de óleo + filtro e **quando** trocar, mas **não** descreve **qual** óleo (viscosidade, norma, marca-padrão) nem **quanto** (litros).

## 5. Mapeamento campo a campo do `engine_oil_profile`

| Campo alvo | Fonte viável hoje | Confiança | Observação |
|---|---|---|---|
| `viscosity` | Nenhuma | Muito baixa | 0/100 documentos com qualquer grade SAE. Requer nova extração (PDF original / catálogo OEM). |
| `specifications[]` | Frágil | Muito baixa | Apenas 1 menção a Dexos, 0 a API/ACEA/Fiat 9.55535. 42 "norma/API" são substring soltas, não estruturadas. |
| `quantity_liters` | Nenhuma | Muito baixa | 0/100 documentos com capacidade em litros do óleo. |
| `filter_required` | `extracted_text` + heurística | Alta | 99/100 mencionam "filtro de óleo". Default seguro: `true`. |
| `replacement_interval_km` | `extracted_text` + `summary_json.sections_detected.cronograma_km` | Alta | 97/100 mencionam 10.000/15.000 km. IA pode extrair com baixo risco. |
| `replacement_interval_months` | `extracted_text` (regras fixas) | Média-alta | Padrão 12 meses bem representado; precisa parser dedicado. |
| `severe_use_interval_km` | `extracted_text` | Média-alta | 100/100 mencionam uso severo; valores específicos precisam parser. |
| `severe_use_interval_months` | `extracted_text` | Média | Idem acima. |
| `requires_compatibility_confirmation` | Política Jarvys | Alta | Forçar `true` por padrão enquanto viscosity/specs forem inferidos. |
| `do_not_match_by_viscosity_only` | Política Jarvys | Alta | Forçar `true` por padrão (proteção do Shopping). |
| `notes[]` | `extracted_text` | Média | Manter curto, sem PII; revisão humana. |

## 6. Riscos

- **Match cego por viscosidade**: sem `specifications[]` estruturado, sugerir óleo apenas por SAE (ex.: "5W-30") quebra motorizações que exigem norma específica (Dexos, Fiat 9.55535, VW 502/505, etc.). É a falha exata que `do_not_match_by_viscosity_only=true` pretende prevenir.
- **Motorizações múltiplas no mesmo `model_group`**: o corpus agrupa por `model_group` (ex.: "argo", "onix"), mas óleo varia por motor (1.0 aspirado vs 1.0 turbo vs 1.3 vs flex). Sem coluna/sinal de motorização fina, qualquer `engine_oil_profile` salvo nessa granularidade será **ambíguo por design**.
- **Curadoria zero**: `reviewed_by_admin=false` e `published=false` em 100% do corpus, `quality_score=0` em 100%, `coverage_json={}` em 100%. Não há sinal para desempate.
- **Viscosidade ausente no texto**: 0/100. Não dá para "extrair melhor com outro prompt" — a informação simplesmente não está no `extracted_text` corrente.
- **Capacidade em litros ausente no texto**: 0/100. Mesmo problema.
- **Híbridos/PHEV (BYD, Corolla Cross, GWM)**: além de óleo, exigem distinção e-CVT × CVT já documentada no Build 6.34. Não regredir.

## 7. Gaps de schema

- Schema atual não contém `engine_oil_profile`. Óleo aparece como item livre em `milestones[].items` (`item_key` arbitrário) e opcionalmente em `purchase_bundles` (`kit_troca_oleo_motor`).
- Faltam campos de primeira classe para `viscosity`, `specifications[]`, `quantity_liters` e `do_not_match_by_viscosity_only`.
- Sem `engine_oil_profile` estruturado, o **Shopping Jarvys** continuará dependente de heurística textual — risco direto de recomendação errada.

## 8. Recomendação para o Build 6.38

Antes de qualquer persistência:

1. **6.38 (dry-run, sem persistir)** — especificar formalmente o contrato `engine_oil_profile` (Zod) como **opcional** no `MaintenancePlanJson`, sem bump de versão público ainda. Adicionar enums: viscosidades SAE comuns, conjunto inicial de normas (API SP/SN, ACEA A3/B4/C3, Dexos1 Gen3, Dexos2, Fiat 9.55535-*, VW 502 00/505 00/508 00, MB 229.x, BMW LL-01/LL-04, PSA B71 2290, etc.).
2. **6.38b (dry-run, sem persistir)** — extrator dedicado em server function (`generateEngineOilProfileFromCorpusDryRunFn`) que **só** retorna `filter_required`, `replacement_interval_km/_months`, `severe_use_*`, `requires_compatibility_confirmation=true`, `do_not_match_by_viscosity_only=true`. Viscosity / specifications / quantity_liters ficam **explicitamente `null`** até nova fonte.
3. **6.39+ (nova fonte de dados, fora deste relatório)** — ingestão paralela de viscosidade/normas/capacidade a partir de catálogo OEM ou ficha técnica estruturada (não do PDF normalizado atual). Curadoria humana obrigatória antes de `published=true`.
4. **Persistência real** segue proibida até passos 1–3 + revisão admin com diff visual.

## 9. Encerramento

- Nenhum código alterado.
- Nenhum dado alterado em `jarvys_maintenance_corpus`, `vehicle_maintenance_profiles`, `profiles`, `user_roles`, buckets ou policies.
- Nenhuma IA, OCR ou embedding executado.
- Nenhum `extracted_text` completo, `storage_path`, `file_name`, `notes`, signed URL, JWT ou service_role exposto.
- Único arquivo criado: `.lovable/build-6.37-engine-oil-corpus-audit.md`.
