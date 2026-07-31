import type { ExpenseSemanticResult } from "../../../expenses/semantics/types.ts";
import type {
  AdaptExpenseSemanticsToGuidedContractInput,
  ExpenseSemanticsAdapterFailureClass,
  ExpenseSemanticsAdapterResult,
  GuidedExpenseOperationalData,
  PreservedSemanticDecision,
} from "../expense-semantics-to-guided-contract.ts";
import type {
  AdditionalExpenseItem,
  ClarificationReason,
  GuidedExpenseContract,
  RecognizedGuidedExpense,
} from "../guided-expense-contracts.ts";

type AdapterStatus = ExpenseSemanticsAdapterResult["status"];
type GuidedStatus = GuidedExpenseContract["status"];
type AdapterUnsupported = Extract<ExpenseSemanticsAdapterResult, { status: "unsupported" }>;
type AcceptAdapterStatus<T extends AdapterStatus> = T;
type AcceptGuidedStatus<T extends GuidedStatus> = T;
type AcceptReason<T extends ClarificationReason> = T;
type AcceptFailureClass<T extends ExpenseSemanticsAdapterFailureClass> = T;
type AcceptUnsupportedReason<T extends AdapterUnsupported["reason"]> = T;

type AllAdapterStatuses = [
  AcceptAdapterStatus<"guided">,
  AcceptAdapterStatus<"conversation_only">,
  AcceptAdapterStatus<"unsupported">,
];
type AllGuidedStatuses = [
  AcceptGuidedStatus<"recognized">,
  AcceptGuidedStatus<"needs_clarification">,
  AcceptGuidedStatus<"use_guided_template">,
];
type ApprovedNewReasons = [
  AcceptReason<"missing_total_amount">,
  AcceptReason<"ambiguous_expense_intent">,
];
type AdapterOnlyUnsupportedReasons = [
  AcceptUnsupportedReason<"invalid_operational_data">,
  AcceptUnsupportedReason<"conflicting_operational_data">,
];

// @ts-expect-error quarto estado externo não pertence à união fechada.
type InvalidAdapterStatus = AcceptAdapterStatus<"pending">;
// @ts-expect-error GuidedExpenseContract permanece com exatamente três estados.
type InvalidFourthGuidedStatus = AcceptGuidedStatus<"conversation_only">;
// @ts-expect-error reason arbitrário é rejeitado.
type InvalidReason = AcceptReason<"arbitrary_reason">;
// @ts-expect-error failureClass arbitrário é rejeitado.
type InvalidFailureClass = AcceptFailureClass<"unknown_failure">;
// @ts-expect-error reason unsupported arbitrário é rejeitado.
type InvalidUnsupportedReason = AcceptUnsupportedReason<"unknown_reason">;

const minimalOperationalData = {
  humanDescription: "Descrição literal",
  additionalItems: [],
  laborMentioned: false,
} satisfies GuidedExpenseOperationalData;

const completeOperationalData = {
  ...minimalOperationalData,
  vehicleId: "vehicle-1",
  km: 0,
  totalAmount: 0,
  partsAmount: 0,
  laborAmount: 0,
} satisfies GuidedExpenseOperationalData;

const operationalDataWithCategory = {
  ...minimalOperationalData,
  // @ts-expect-error category não pertence ao contexto operacional.
  category: "Revisão",
} satisfies GuidedExpenseOperationalData;
const operationalDataWithCommonCategory = {
  ...minimalOperationalData,
  // @ts-expect-error commonCategory não pertence ao contexto operacional.
  commonCategory: "Lavagem",
} satisfies GuidedExpenseOperationalData;
const operationalDataWithItemKeys = {
  ...minimalOperationalData,
  // @ts-expect-error itemKeys pertencem exclusivamente ao Core.
  itemKeys: ["oleo_motor"],
} satisfies GuidedExpenseOperationalData;
const operationalDataWithRecognizedItemKeys = {
  ...minimalOperationalData,
  // @ts-expect-error recognizedItemKeys não pertencem ao contexto operacional.
  recognizedItemKeys: ["oleo_motor"],
} satisfies GuidedExpenseOperationalData;
const operationalDataWithOriginalText = {
  ...minimalOperationalData,
  // @ts-expect-error originalText não pertence ao contexto operacional.
  originalText: "texto original",
} satisfies GuidedExpenseOperationalData;
const operationalDataWithCandidateCategory = {
  ...minimalOperationalData,
  // @ts-expect-error candidateCategory não pertence ao contexto operacional.
  candidateCategory: "Revisão",
} satisfies GuidedExpenseOperationalData;
const operationalDataWithCandidateItemKeys = {
  ...minimalOperationalData,
  // @ts-expect-error candidateItemKeys não pertencem ao contexto operacional.
  candidateItemKeys: ["oleo_motor"],
} satisfies GuidedExpenseOperationalData;

const missingDescription = {
  additionalItems: [],
  laborMentioned: false,
  // @ts-expect-error humanDescription é obrigatória.
} satisfies GuidedExpenseOperationalData;
const missingAdditionalItems = {
  humanDescription: "Descrição",
  laborMentioned: false,
  // @ts-expect-error additionalItems é obrigatório.
} satisfies GuidedExpenseOperationalData;
const missingLaborMentioned = {
  humanDescription: "Descrição",
  additionalItems: [],
  // @ts-expect-error laborMentioned é obrigatório.
} satisfies GuidedExpenseOperationalData;

declare const operational: GuidedExpenseOperationalData;
declare const additionalItem: AdditionalExpenseItem;
declare const decision: PreservedSemanticDecision;
declare const recognized: RecognizedGuidedExpense;
declare const adapterInput: AdaptExpenseSemanticsToGuidedContractInput;

function assertReadonly(): void {
  // @ts-expect-error contexto operacional é readonly.
  operational.km = 10;
  // @ts-expect-error array de adicionais é readonly.
  operational.additionalItems.push(additionalItem);
  // @ts-expect-error item adicional é readonly.
  additionalItem.label = "Alterado";
  // @ts-expect-error decisão preservada é readonly.
  decision.persistable = false;
  // @ts-expect-error resultado reconhecido é readonly.
  recognized.vehicleId = "outro";
  // @ts-expect-error itemKeys reconhecidas são readonly.
  recognized.recognizedItemKeys.push("inventada");
  // @ts-expect-error input do adapter é readonly.
  adapterInput.operationalData = minimalOperationalData;
}

declare const guidedContract: GuidedExpenseContract;
const resultWithMetadata = {
  status: "guided",
  semanticDecision: decision,
  guidedContract,
  // @ts-expect-error metadata aberta não pertence ao output.
  metadata: {},
} satisfies ExpenseSemanticsAdapterResult;

const transmissionResolvedWithEmptyItems = {
  status: "resolved",
  persistable: true,
  conceptualCategory: "Revisão",
  itemKeys: [],
  facts: { serviceCompleted: true, recognizedSystems: ["transmission_fluid"] },
  decisionCode: "completed_transmission_fluid_without_safe_item_key",
} as const satisfies ExpenseSemanticResult;

const invalidMiscCategory: RecognizedGuidedExpense = {
  status: "recognized",
  // @ts-expect-error Diversos continua proibido como categoria reconhecida.
  category: "Diversos",
  totalAmount: 1,
  vehicleId: "vehicle-1",
  km: 1,
  recognizedItemKeys: [],
  additionalItems: [],
  description: "Descrição",
  laborMentioned: false,
  requiresConfirmation: true,
  singleExpenseLine: true,
};

const exhaustAdapterResult = (result: ExpenseSemanticsAdapterResult): string => {
  switch (result.status) {
    case "guided":
      return result.guidedContract.status;
    case "conversation_only":
      return result.reason;
    case "unsupported":
      return result.failureClass;
  }
  const exhaustive: never = result;
  return exhaustive;
};

const exhaustSemanticResult = (result: ExpenseSemanticResult): string => {
  switch (result.status) {
    case "resolved":
      return result.conceptualCategory;
    case "needs_clarification":
    case "conversation_only":
    case "unsupported":
      return result.reason;
  }
  const exhaustive: never = result;
  return exhaustive;
};

declare const allAdapterStatuses: AllAdapterStatuses;
declare const allGuidedStatuses: AllGuidedStatuses;
declare const approvedNewReasons: ApprovedNewReasons;
declare const adapterOnlyUnsupportedReasons: AdapterOnlyUnsupportedReasons;

void minimalOperationalData;
void completeOperationalData;
void operationalDataWithCategory;
void operationalDataWithCommonCategory;
void operationalDataWithItemKeys;
void operationalDataWithRecognizedItemKeys;
void operationalDataWithOriginalText;
void operationalDataWithCandidateCategory;
void operationalDataWithCandidateItemKeys;
void missingDescription;
void missingAdditionalItems;
void missingLaborMentioned;
void resultWithMetadata;
void transmissionResolvedWithEmptyItems;
void invalidMiscCategory;
void assertReadonly;
void exhaustAdapterResult;
void exhaustSemanticResult;
void allAdapterStatuses;
void allGuidedStatuses;
void approvedNewReasons;
void adapterOnlyUnsupportedReasons;

export {};
