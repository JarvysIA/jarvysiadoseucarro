import type {
  ConceptRecognitionSource,
  ExpenseSemanticOccurrence,
  RecognizedAutomotiveConcept,
  SemanticFinancialValue,
} from "../concept-event-contract.ts";
import type { ExpenseSemanticConceptKey } from "../registry.ts";
import type { ExpenseSemanticCategory, ExpenseSemanticItemKey } from "../types.ts";

const declared = {
  status: "declared_positive",
  declaredAmount: 120,
} as const satisfies SemanticFinancialValue;
const zero = {
  status: "confirmed_zero_cost",
  declaredAmount: 0,
} as const satisfies SemanticFinancialValue;
const notInformed = { status: "not_informed" } as const satisfies SemanticFinancialValue;

const engineOil = {
  conceptKey: "engine_oil",
  recognitionSource: "deterministic_core",
  relatedItemKeys: ["oleo_motor"],
} as const satisfies RecognizedAutomotiveConcept;
const engineOilFilter = {
  conceptKey: "engine_oil_filter",
  recognitionSource: "explicit_user_statement",
  relatedItemKeys: ["filtro_oleo"],
} as const satisfies RecognizedAutomotiveConcept;

const valid: ExpenseSemanticOccurrence = {
  contractVersion: "p0_3b_s3_3",
  concepts: [engineOil, engineOilFilter],
  category: "Revisão",
  description: "Compra de óleo e filtro",
  financialValue: declared,
  aiAuthority: "none",
  runtimeIntegration: "disconnected",
};
const emptyConcepts = { ...valid, concepts: [] } as const satisfies ExpenseSemanticOccurrence;

type FinancialStatus = SemanticFinancialValue["status"];
type AcceptFinancialStatus<T extends FinancialStatus> = T;
type AcceptCategory<T extends ExpenseSemanticCategory> = T;
type AcceptRecognitionSource<T extends ConceptRecognitionSource> = T;
type AcceptConceptKey<T extends ExpenseSemanticConceptKey> = T;
type AcceptItemKey<T extends ExpenseSemanticItemKey> = T;

type AllStatuses = [
  AcceptFinancialStatus<"declared_positive">,
  AcceptFinancialStatus<"confirmed_zero_cost">,
  AcceptFinancialStatus<"not_informed">,
];
type AllCategories = [
  AcceptCategory<"Revisão">,
  AcceptCategory<"Manutenção">,
  AcceptCategory<"Lavagem">,
  AcceptCategory<"Combustível">,
  AcceptCategory<"IPVA">,
  AcceptCategory<"Multas">,
  AcceptCategory<"Seguro">,
  AcceptCategory<"Acessórios">,
];

// @ts-expect-error status financeiro é uma união fechada.
type InvalidStatus = AcceptFinancialStatus<"pending">;
// @ts-expect-error categoria é uma união fechada com exatamente oito membros.
type InvalidCategory = AcceptCategory<"Diversos">;
// @ts-expect-error fonte de reconhecimento não concede autoridade à IA.
type InvalidRecognitionSource = AcceptRecognitionSource<"ai_suggestion">;
// @ts-expect-error conceitos pertencem à união canônica do registry.
type InvalidConceptKey = AcceptConceptKey<"unknown_concept">;
// @ts-expect-error item keys também permanecem fechadas no registry.
type InvalidItemKey = AcceptItemKey<"inventada">;

const zeroWithPositiveAmountSource = {
  status: "confirmed_zero_cost",
  declaredAmount: 1,
} as const;
// @ts-expect-error confirmed_zero_cost exige o literal zero.
const zeroWithPositiveAmount: SemanticFinancialValue = zeroWithPositiveAmountSource;

const notInformedWithAmountSource = {
  status: "not_informed",
  declaredAmount: 0,
} as const;
// @ts-expect-error not_informed não carrega declaredAmount.
const notInformedWithAmount: SemanticFinancialValue = notInformedWithAmountSource;

const declaredWithoutAmountSource = { status: "declared_positive" } as const;
// @ts-expect-error declared_positive exige declaredAmount.
const declaredWithoutAmount: SemanticFinancialValue = declaredWithoutAmountSource;

const unknownConceptSource = {
  conceptKey: "unknown_concept",
  recognitionSource: "deterministic_core",
  relatedItemKeys: [],
} as const;
// @ts-expect-error conceito desconhecido não entra na união canônica.
const unknownConcept: RecognizedAutomotiveConcept = unknownConceptSource;

const mismatchedRelatedItemsSource = {
  ...engineOil,
  relatedItemKeys: ["filtro_oleo"],
} as const;
// @ts-expect-error relatedItemKeys deve corresponder exatamente ao conceito no registry.
const mismatchedRelatedItems: RecognizedAutomotiveConcept = mismatchedRelatedItemsSource;

const invalidSourceConceptSource = {
  ...engineOil,
  recognitionSource: "ai_suggestion",
} as const;
// @ts-expect-error recognitionSource é uma união fechada.
const invalidSourceConcept: RecognizedAutomotiveConcept = invalidSourceConceptSource;

const missingRecognitionSourceSource = {
  conceptKey: "engine_oil",
  relatedItemKeys: ["oleo_motor"],
} as const;
// @ts-expect-error recognitionSource é obrigatório em cada conceito reconhecido.
const missingRecognitionSource: RecognizedAutomotiveConcept = missingRecognitionSourceSource;

const missingConceptKeySource = {
  recognitionSource: "deterministic_core",
  relatedItemKeys: ["oleo_motor"],
} as const;
// @ts-expect-error conceptKey é obrigatório em cada conceito reconhecido.
const missingConceptKey: RecognizedAutomotiveConcept = missingConceptKeySource;

const oldVersionSource = { ...valid, contractVersion: "p0_3b_s3_1" } as const;
// @ts-expect-error S3.1 foi substituído definitivamente.
const oldVersion: ExpenseSemanticOccurrence = oldVersionSource;

const connectedRuntimeSource = { ...valid, runtimeIntegration: "connected" } as const;
// @ts-expect-error o contrato permanece desconectado.
const connectedRuntime: ExpenseSemanticOccurrence = connectedRuntimeSource;

const aiAuthorizedSource = { ...valid, aiAuthority: "persist_expense" } as const;
// @ts-expect-error nenhuma autoridade da IA é permitida.
const aiAuthorized: ExpenseSemanticOccurrence = aiAuthorizedSource;

const legacyAuthoritySource = { ...valid, operationalAuthority: "none" } as const;
// @ts-expect-error operationalAuthority não pertence ao contrato aprovado.
const legacyAuthority: ExpenseSemanticOccurrence = legacyAuthoritySource;

const missingAiAuthoritySource = {
  contractVersion: valid.contractVersion,
  concepts: valid.concepts,
  category: valid.category,
  description: valid.description,
  financialValue: valid.financialValue,
  runtimeIntegration: valid.runtimeIntegration,
} as const;
// @ts-expect-error aiAuthority é obrigatório.
const missingAiAuthority: ExpenseSemanticOccurrence = missingAiAuthoritySource;

const forbiddenEventSource = { ...valid, events: [{ kind: "purchase" }] } as const;
// @ts-expect-error eventos estruturados não pertencem ao S3.3.
const forbiddenEvent: ExpenseSemanticOccurrence = forbiddenEventSource;

const forbiddenKmSource = { ...valid, km: 89_000 } as const;
// @ts-expect-error KM não pertence ao S3.3.
const forbiddenKm: ExpenseSemanticOccurrence = forbiddenKmSource;

const forbiddenQuantitySource = { ...valid, quantity: 4 } as const;
// @ts-expect-error quantidade permanece somente na descrição.
const forbiddenQuantity: ExpenseSemanticOccurrence = forbiddenQuantitySource;

const forbiddenTitleSource = { ...valid, title: "Óleo" } as const;
// @ts-expect-error title foi substituído por description obrigatória.
const forbiddenTitle: ExpenseSemanticOccurrence = forbiddenTitleSource;

const forbiddenEffectSource = { ...valid, technicalEffect: { status: "none" } } as const;
// @ts-expect-error efeitos técnicos não pertencem ao contrato.
const forbiddenEffect: ExpenseSemanticOccurrence = forbiddenEffectSource;

const forbiddenLinkSource = { ...valid, linkedExpenseId: "expense-1" } as const;
// @ts-expect-error ocorrências independentes não vinculam despesas.
const forbiddenLink: ExpenseSemanticOccurrence = forbiddenLinkSource;

const conceptAmountSource = { ...engineOil, amount: 120 } as const;
// @ts-expect-error o conceito reconhecido não carrega valor financeiro.
const conceptAmount: RecognizedAutomotiveConcept = conceptAmountSource;

const conceptVehicleSource = { ...engineOil, vehicleId: "vehicle-1" } as const;
// @ts-expect-error o conceito reconhecido não carrega autoridade operacional.
const conceptVehicle: RecognizedAutomotiveConcept = conceptVehicleSource;

const aliasConceptKeySource = {
  conceptKey: "oleo do motor",
  recognitionSource: "deterministic_core",
  relatedItemKeys: ["oleo_motor"],
} as const;
// @ts-expect-error alias textual não substitui a chave canônica do registry.
const aliasConceptKey: RecognizedAutomotiveConcept = aliasConceptKeySource;

const missingDescriptionSource = {
  contractVersion: valid.contractVersion,
  concepts: valid.concepts,
  category: valid.category,
  financialValue: valid.financialValue,
  aiAuthority: valid.aiAuthority,
  runtimeIntegration: valid.runtimeIntegration,
} as const;
// @ts-expect-error description é obrigatória.
const missingDescription: ExpenseSemanticOccurrence = missingDescriptionSource;

const invalidDescriptionTypeSource = { ...valid, description: 123 } as const;
// @ts-expect-error description deve ser string.
const invalidDescriptionType: ExpenseSemanticOccurrence = invalidDescriptionTypeSource;

const forbiddenPersistableSource = { ...valid, persistable: true } as const;
// @ts-expect-error persistable não pertence ao contrato S3.3.
const forbiddenPersistable: ExpenseSemanticOccurrence = forbiddenPersistableSource;

const forbiddenServiceCompletedSource = { ...valid, serviceCompleted: true } as const;
// @ts-expect-error serviceCompleted legado não pertence ao contrato S3.3.
const forbiddenServiceCompleted: ExpenseSemanticOccurrence = forbiddenServiceCompletedSource;

declare const readonlyOccurrence: ExpenseSemanticOccurrence;
declare const readonlyFinancialValue: SemanticFinancialValue;
declare const readonlyConcept: RecognizedAutomotiveConcept;
function assertReadonly(): void {
  // @ts-expect-error ocorrência é readonly.
  readonlyOccurrence.description = "alterada";
  // @ts-expect-error lista de conceitos é readonly.
  readonlyOccurrence.concepts.push(engineOil);
  // @ts-expect-error valor financeiro é readonly.
  readonlyFinancialValue.status = "not_informed";
  // @ts-expect-error estrutura reconhecida é readonly.
  readonlyConcept.conceptKey = "tires";
  // @ts-expect-error relatedItemKeys é readonly.
  readonlyConcept.relatedItemKeys.push("oleo_motor");
}

void zero;
void notInformed;
void emptyConcepts;
void zeroWithPositiveAmount;
void notInformedWithAmount;
void declaredWithoutAmount;
void unknownConcept;
void mismatchedRelatedItems;
void invalidSourceConcept;
void missingRecognitionSource;
void missingConceptKey;
void oldVersion;
void connectedRuntime;
void aiAuthorized;
void legacyAuthority;
void missingAiAuthority;
void forbiddenEvent;
void forbiddenKm;
void forbiddenQuantity;
void forbiddenTitle;
void forbiddenEffect;
void forbiddenLink;
void conceptAmount;
void conceptVehicle;
void aliasConceptKey;
void missingDescription;
void invalidDescriptionType;
void forbiddenPersistable;
void forbiddenServiceCompleted;
void assertReadonly;
declare const allStatuses: AllStatuses;
declare const allCategories: AllCategories;
void allStatuses;
void allCategories;

export {};
