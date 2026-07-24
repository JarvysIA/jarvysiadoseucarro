// P0-3A-S — Contratos mínimos do futuro fluxo guiado de despesas.
//
// Este módulo contém somente tipos. Não interpreta texto, não reconhece itens,
// não decide categorias e não persiste dados. As decisões pertencem aos builds
// futuros; aqui, qualquer incerteza deve resultar em clarification ou template.

import type { ExpenseCategory } from "../actions/expense-types.ts";

export type ClarificationReason =
  | "missing_vehicle"
  | "missing_km"
  | "ambiguous_filter"
  | "ambiguous_oil"
  | "ambiguous_transmission"
  | "quantity_required"
  | "ambiguous_item"
  | "complex_input";

export type TemplateReason =
  | "complex_input"
  | "multiple_ambiguities"
  | "generic_revision"
  | "generic_maintenance";

export type TechnicalAuthorization = "none";

export type GuidedExpenseTemplateKey = "maintenance_expense";

export type CommonExpenseCategory = Exclude<ExpenseCategory, "Revisão" | "Manutenção">;

/** Item adicional informado pelo usuário, sem classificação comercial. */
export type AdditionalExpenseItem = Readonly<{
  id: string;
  label: string;
  quantity?: number;
}>;

/**
 * Somente fatos já estabelecidos podem entrar nesta estrutura.
 * A ausência de um campo significa que ele ainda não é seguro.
 */
export type SafeKnownExpenseData = Readonly<{
  vehicleId?: string;
  km?: number;
  totalAmount?: number;
  commonCategory?: CommonExpenseCategory;
  description?: string;
  recognizedItemKeys?: readonly string[];
  additionalItems?: readonly AdditionalExpenseItem[];
  laborMentioned?: boolean;
  partsAmount?: number;
  laborAmount?: number;
}>;

/**
 * Lançamento totalmente compreendido, mas ainda sujeito à confirmação.
 * Um resultado reconhecido sempre representa uma única linha de despesa.
 */
export type RecognizedGuidedExpense = Readonly<{
  status: "recognized";
  category: ExpenseCategory;
  totalAmount: number;
  vehicleId: string;
  km: number;
  recognizedItemKeys: readonly string[];
  additionalItems: readonly AdditionalExpenseItem[];
  description: string;
  laborMentioned: boolean;
  partsAmount?: number;
  laborAmount?: number;
  requiresConfirmation: true;
  singleExpenseLine: true;
}>;

/** Caso resolvível por uma única pergunta objetiva. */
export type NeedsGuidedExpenseClarification = Readonly<{
  status: "needs_clarification";
  reason: ClarificationReason;
  safeKnownData: SafeKnownExpenseData;
  missingField: string;
  questionKey: string;
  technicalAuthorization: "none";
}>;

/** Caso complexo que deve ser conduzido pelo template, sem inferências. */
export type UseGuidedExpenseTemplate = Readonly<{
  status: "use_guided_template";
  reason: TemplateReason;
  safeKnownData: SafeKnownExpenseData;
  templateKey: "maintenance_expense";
  technicalAuthorization: "none";
}>;

export type GuidedExpenseContract =
  | RecognizedGuidedExpense
  | NeedsGuidedExpenseClarification
  | UseGuidedExpenseTemplate;

// Invariantes de óleo para o reconhecedor futuro:
// - oleo_motor exige filtro_oleo;
// - filtro_oleo isolado é permitido;
// - óleo genérico deve ser resolvido pelo reconhecedor futuro.
//
// Invariantes de transmissão para o reconhecedor futuro:
// - óleo de transmissão não adiciona filtro automaticamente;
// - filtro de transmissão só pode ser adicionado quando explicitamente informado;
// - a quantidade de filtros não pode ser inferida;
// - filtro_oleo do motor nunca pode representar filtro de transmissão;
// - "não sei" preservará somente o óleo da transmissão;
// - óleo de câmbio genérico será resolvido pelo reconhecedor futuro.
// Nenhuma dessas decisões é implementada neste contrato.
