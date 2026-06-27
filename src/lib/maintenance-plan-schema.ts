/**
 * maintenance-plan-schema.ts
 *
 * Contrato canônico (TypeScript) do campo
 * `vehicle_maintenance_profiles.maintenance_plan_json`.
 *
 * Princípios:
 * - O plano preventivo é gerado UMA vez (IA/curadoria/manual) e salvo no cache
 *   técnico global (`vehicle_maintenance_profiles`), indexado por `signature`.
 * - O app deve CONSUMIR o JSON salvo. Nunca chamar IA repetidamente em runtime
 *   para o mesmo veículo.
 * - Este arquivo é puro: apenas tipos, constantes e comentários. Sem I/O, sem
 *   React, sem Supabase, sem Zod, sem funções runtime.
 *
 * Regras de negócio embutidas no schema:
 * - `shopping_classification` controla se um item pode virar link de compra.
 * - `purchase_bundles` definem kits/pacotes; o Shopping DEVE preferir bundles
 *   sobre links individuais quando um bundle seguro existir para o marco.
 * - `not_applicable_items` (e itens com `applies: false`) devem aparecer no
 *   checklist técnico para gerar confiança, mas NUNCA virar link de compra.
 * - `confidence` em itens, bundles e metadata é esperado no range 0–100.
 *
 * A validação Zod deste schema será introduzida no Build 5.2 e DEVE espelhar
 * este arquivo. Qualquer mudança de campo aqui exige bump de
 * `MAINTENANCE_PLAN_SCHEMA_VERSION` e atualização do schema Zod correspondente.
 */

export const MAINTENANCE_PLAN_SCHEMA_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Enums de domínio
// ---------------------------------------------------------------------------

/** Sistema de distribuição do motor. */
export type TimingSystem =
  | "correia_dentada"
  | "corrente"
  | "correia_banhada"
  | "desconhecido";

/** Tipo de transmissão. */
export type TransmissionType =
  | "manual"
  | "automatico"
  | "cvt"
  | "automatizado"
  | "dupla_embreagem"
  | "desconhecido";

/**
 * Política de serviço da transmissão.
 *
 * - `troca_programada`: manual prevê troca em marco específico.
 * - `preventiva_recomendada`: manual diz "sealed for life" ou similar, mas o
 *   Jarvys recomenda troca preventiva.
 * - `sem_troca_programada`: nenhum serviço programado.
 * - `verificar_manual`: política depende de revisão do manual.
 * - `desconhecido`: sem dados confiáveis.
 */
export type TransmissionServicePolicy =
  | "troca_programada"
  | "preventiva_recomendada"
  | "sem_troca_programada"
  | "verificar_manual"
  | "desconhecido";

/**
 * Tipo de serviço de fluido/filtro da transmissão. Crítico para decidir se um
 * bundle de câmbio é seguro para virar link de compra.
 */
export type TransmissionFluidServiceType =
  | "somente_fluido"
  | "fluido_e_um_filtro"
  | "fluido_e_dois_filtros"
  | "fluido_filtro_junta"
  | "filtro_interno_nao_servicavel"
  | "sem_troca_programada"
  | "desconhecido";

/** Categoria funcional do item de manutenção. */
export type MaintenanceCategory =
  | "motor"
  | "filtros"
  | "ignicao"
  | "arrefecimento"
  | "freios"
  | "suspensao"
  | "direcao"
  | "pneus"
  | "transmissao"
  | "eletrica"
  | "carroceria"
  | "diagnostico"
  | "conforto"
  | "outros";

/** Ação técnica a ser executada no item. */
export type MaintenanceAction =
  | "trocar"
  | "verificar"
  | "inspecionar"
  | "limpar"
  | "regular"
  | "completar"
  | "diagnosticar"
  | "resetar_aviso"
  | "troca_preventiva_recomendada"
  | "nao_aplicavel";

/**
 * Tipo de recomendação do item.
 *
 * - `required`: item do plano base/manual para aquele marco.
 * - `recommended`: recomendado pelo plano.
 * - `preventive_recommended`: recomendação preventiva inteligente além do básico.
 * - `inspect_only`: apenas verificar/inspecionar.
 * - `condition_based`: depende de estado/desgaste/contaminação.
 * - `not_applicable`: não se aplica a este veículo.
 * - `unknown`: sem confiança suficiente.
 */
export type MaintenanceRecommendationType =
  | "required"
  | "recommended"
  | "preventive_recommended"
  | "inspect_only"
  | "condition_based"
  | "not_applicable"
  | "unknown";

/**
 * Classificação para o Shopping. Controla se um item pode virar link de compra.
 *
 * - `safe_to_buy`: pode gerar link de compra futuramente.
 * - `service_only`: é serviço, não peça.
 * - `inspect_before_buy`: verificar antes de comprar.
 * - `bundle_preferred`: pode ser comprado, mas Shopping deve preferir bundle.
 * - `do_not_link`: não deve virar link.
 * - `not_applicable`: não se aplica.
 * - `unknown`: dados insuficientes.
 */
export type ShoppingClassification =
  | "safe_to_buy"
  | "service_only"
  | "inspect_before_buy"
  | "bundle_preferred"
  | "do_not_link"
  | "not_applicable"
  | "unknown";

/** Tipo de bundle/kit de compra recomendado. */
export type MaintenanceBundleType =
  | "kit_troca_oleo_motor"
  | "kit_filtros"
  | "kit_revisao_completa"
  | "kit_correia_dentada"
  | "kit_correia_acessorios"
  | "kit_cambio_manual"
  | "kit_cambio_automatico"
  | "kit_freio"
  | "kit_arrefecimento"
  | "kit_ignicao"
  | "outro";

/** Origem da recomendação (item ou plano). */
export type MaintenanceSourceType =
  | "manual"
  | "ia"
  | "curadoria"
  | "catalogo"
  | "fornecedor"
  | "experiencia_preventiva"
  | "sistema";

/** Quem gerou o plano como um todo. */
export type MaintenancePlanGeneratedBy =
  | "ia"
  | "manual"
  | "curadoria"
  | "sistema";

// ---------------------------------------------------------------------------
// Identificadores de itens
// ---------------------------------------------------------------------------

/**
 * Identificador estável do item de manutenção. Mantido como `string` aberto
 * (não union) para não engessar o catálogo. Exemplos canônicos esperados:
 *
 * - `oleo_motor`, `filtro_oleo`, `filtro_ar_motor`, `filtro_combustivel`,
 *   `filtro_cabine`
 * - `velas_ignicao`, `fluido_freio`, `fluido_arrefecimento`
 * - `correia_dentada`, `kit_correia_dentada`, `tensor_correia`, `bomba_agua`
 * - `correia_acessorios`, `corrente_comando`
 * - `oleo_cambio_manual`, `oleo_cambio_automatico`,
 *   `filtro_cambio_automatico_1`, `filtro_cambio_automatico_2`,
 *   `junta_carter_cambio`
 * - `pastilhas_freio`, `discos_freio`
 * - `pneus`, `alinhamento_balanceamento`, `suspensao`, `amortecedores`
 * - `bateria`, `palhetas`, `scanner_diagnostico`
 */
export type MaintenanceItemKey = string;

// ---------------------------------------------------------------------------
// Estruturas
// ---------------------------------------------------------------------------

/** Resumo do veículo para exibição e geração de queries de Shopping. */
export type MaintenanceVehicleSummary = {
  display_name: string;
  marca?: string | null;
  modelo_fipe?: string | null;
  ano_modelo?: number | null;
  combustivel?: string | null;
  cilindradas?: number | null;
  motor_textual?: string | null;
  valvulas?: number | null;
  transmissao?: TransmissionType | null;
};

/** Regras base de revisão (intervalos do manual). */
export type MaintenanceBaseRules = {
  revision_interval_km: number;
  revision_interval_months: number;
  max_planned_km?: number;
  severe_use_oil_interval_km?: number;
  severe_use_oil_interval_months?: number;
};

/** Perfil de sistemas críticos (distribuição, câmbio, arrefecimento). */
export type MaintenanceSystemProfile = {
  timing_system: TimingSystem;
  transmission_type: TransmissionType;
  transmission_service_policy: TransmissionServicePolicy;
  transmission_fluid_service_type: TransmissionFluidServiceType;
  /** Política livre de arrefecimento (ex.: "troca a cada 60.000 km"). */
  cooling_system_policy?: string;
};

/** Item individual do checklist técnico em um marco. */
export type MaintenancePlanItem = {
  item_key: MaintenanceItemKey;
  label: string;
  category: MaintenanceCategory;
  action: MaintenanceAction;
  recommendation_type: MaintenanceRecommendationType;
  shopping_classification: ShoppingClassification;
  /** Aplicabilidade. `false` para itens listados como "não se aplica". */
  applies: boolean;
  interval_km?: number;
  interval_months?: number;
  /** Confiança da recomendação, range 0–100. */
  confidence?: number;
  source_type?: MaintenanceSourceType;
  /** Motivo de aplicabilidade/inaplicabilidade ou justificativa técnica. */
  reason?: string;
  notes?: string[];
};

/** Item recorrente por intervalo fixo, independente de milestone específico. */
export type MaintenanceFixedIntervalItem = {
  item_key: MaintenanceItemKey;
  label: string;
  category: MaintenanceCategory;
  action: MaintenanceAction;
  interval_km?: number;
  interval_months?: number;
  shopping_classification: ShoppingClassification;
  recommendation_type: MaintenanceRecommendationType;
  applies: boolean;
  confidence?: number;
  source_type?: MaintenanceSourceType;
  notes?: string[];
};

/** Marco de revisão por KM. */
export type MaintenanceMilestone = {
  km: number;
  label: string;
  revision_number?: number;
  /** `true` quando o manual não cobre este KM e o Jarvys está projetando. */
  projected?: boolean;
  items: MaintenancePlanItem[];
  /**
   * Chaves de bundles recomendados neste marco. Apontam para entradas em
   * `MaintenancePlanJson.purchase_bundles`.
   */
  purchase_bundle_keys?: string[];
  notes?: string[];
};

/** Regra adicional para uso severo. */
export type MaintenanceSevereUseRule = {
  item_key: MaintenanceItemKey;
  label: string;
  description?: string;
  interval_km?: number;
  interval_months?: number;
  recommendation_type: MaintenanceRecommendationType;
  source_type?: MaintenanceSourceType;
  confidence?: number;
};

/** Alerta baseado em idade do veículo (não apenas KM). */
export type MaintenanceAgeBasedAlert = {
  item_key: MaintenanceItemKey;
  label: string;
  trigger_age_years: number;
  recommendation_type: MaintenanceRecommendationType;
  shopping_classification: ShoppingClassification;
  reason?: string;
  source_type?: MaintenanceSourceType;
  confidence?: number;
};

/** Item explicitamente não aplicável ao veículo. */
export type MaintenanceNotApplicableItem = {
  item_key: MaintenanceItemKey;
  label: string;
  reason: string;
  source_type?: MaintenanceSourceType;
  confidence?: number;
};

/**
 * Bundle/kit de compra recomendado.
 *
 * Camada essencial para o Shopping: itens técnicos individuais explicam o que
 * será feito, mas a compra DEVE preferir bundles quando existir um bundle
 * seguro para o marco.
 *
 * Regras futuras de Shopping (a serem aplicadas no consumo):
 * - Se o milestone tem `purchase_bundle_keys`, usar esses bundles.
 * - Se não houver bundle, gerar links individuais apenas para itens
 *   `safe_to_buy`.
 * - Se o item é `bundle_preferred`, não gerar link individual quando houver
 *   bundle disponível.
 * - Se o item é `inspect_before_buy`, `do_not_link`, `not_applicable` ou
 *   `unknown`, não gerar compra direta.
 */
export type MaintenancePurchaseBundle = {
  bundle_key: string;
  label: string;
  description?: string;
  bundle_type: MaintenanceBundleType;
  item_keys: MaintenanceItemKey[];
  category: MaintenanceCategory;
  shopping_classification: ShoppingClassification;
  /**
   * Template de query de busca, com placeholders como `{modelo}`, `{motor}`,
   * `{ano_modelo}`, `{oil_spec}`, `{oil_capacity_liters}`.
   */
  preferred_search_query_template?: string;
  required_item_keys?: MaintenanceItemKey[];
  optional_item_keys?: MaintenanceItemKey[];
  excluded_item_keys?: MaintenanceItemKey[];
  /** Quando `true`, exige confirmação de compatibilidade antes do link. */
  requires_compatibility_confirmation?: boolean;
  /** Confiança do bundle, range 0–100. */
  confidence?: number;
  source_type?: MaintenanceSourceType;
  notes?: string[];
};

/** Metadados do plano. */
export type MaintenancePlanMetadata = {
  generated_at: string;
  generated_by: MaintenancePlanGeneratedBy;
  source: MaintenanceSourceType;
  /** Confiança geral do plano, range 0–100. */
  overall_confidence?: number;
  reviewed_by_admin?: boolean;
  schema_notes?: string[];
};

// ---------------------------------------------------------------------------
// Raiz do contrato
// ---------------------------------------------------------------------------

/**
 * Estrutura canônica salva em
 * `vehicle_maintenance_profiles.maintenance_plan_json`.
 *
 * Campo `schema_version` DEVE bater com `MAINTENANCE_PLAN_SCHEMA_VERSION` no
 * momento da escrita. Leituras tolerantes a versões anteriores ficam para o
 * Build 5.2+ junto com a validação Zod.
 */
export type MaintenancePlanJson = {
  schema_version: string;
  vehicle_summary: MaintenanceVehicleSummary;
  base_rules: MaintenanceBaseRules;
  system_profile: MaintenanceSystemProfile;
  milestones: MaintenanceMilestone[];
  fixed_intervals?: MaintenanceFixedIntervalItem[];
  severe_use_rules?: MaintenanceSevereUseRule[];
  age_based_alerts?: MaintenanceAgeBasedAlert[];
  not_applicable_items?: MaintenanceNotApplicableItem[];
  purchase_bundles?: MaintenancePurchaseBundle[];
  general_notes?: string[];
  safety_disclaimer?: string;
  metadata: MaintenancePlanMetadata;
};
