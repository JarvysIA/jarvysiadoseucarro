// Subconjunto de tipos PORTADO de src/lib/maintenance-plan-schema.ts — cópia
// deliberada, não reimportar de src/lib (Edge Functions rodam em Deno;
// src/lib usa resolução de módulos de bundler/Node). Arquivo 100% de tipos
// (apagados na compilação), sem Zod, sem lógica.
//
// Contém SOMENTE as declarações usadas por schedule-rules.ts (a porta de
// src/lib/maintenance-jarvys-schedule-rules.ts): os 7 tipos pedidos
// (TimingSystem, TransmissionType, MaintenanceCategory, MaintenanceAction,
// MaintenanceRecommendationType, ShoppingClassification, MaintenancePlanItem)
// mais MaintenanceItemKey e MaintenanceSourceType, que MaintenancePlanItem
// referencia por nome na declaração original — sem eles a cópia exata de
// MaintenancePlanItem não compila. Ambos são triviais (um alias de string,
// um union literal pequeno) e não puxam nenhuma árvore de tipos adicional,
// diferente de MaintenancePlanJson (deliberadamente NÃO portado — as únicas
// 4 funções que o usavam, ligadas à inferência de perfil a partir de um
// MaintenancePlanJson completo, foram cortadas do arquivo portado por não
// serem usadas pelo renderer de marco, que já recebe o perfil pronto).

/** Sistema de distribuição do motor. */
export type TimingSystem =
  | "correia_dentada"
  | "corrente"
  | "correia_banhada"
  | "nao_aplicavel"
  | "desconhecido";

/** Tipo de transmissão. */
export type TransmissionType =
  | "manual"
  | "automatico"
  | "cvt"
  | "automatizado"
  | "dupla_embreagem"
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

/** Origem da recomendação (item ou plano). */
export type MaintenanceSourceType =
  | "manual"
  | "ia"
  | "curadoria"
  | "catalogo"
  | "fornecedor"
  | "experiencia_preventiva"
  | "sistema";

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
