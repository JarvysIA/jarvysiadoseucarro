import type {
  AdditionalExpenseItem,
  ClarificationReason,
  CommonExpenseCategory,
  GuidedExpenseContract,
  NeedsGuidedExpenseClarification,
  RecognizedGuidedExpense,
  SafeKnownExpenseData,
  TechnicalAuthorization,
  TemplateReason,
} from "../guided-expense-contracts.ts";

type Category = RecognizedGuidedExpense["category"];
type ContractStatus = GuidedExpenseContract["status"];
type AcceptCategory<T extends Category> = T;
type AcceptCommonCategory<T extends CommonExpenseCategory> = T;
type AcceptContractStatus<T extends ContractStatus> = T;
type AcceptAuthorization<T extends TechnicalAuthorization> = T;
type AcceptClarificationReason<T extends ClarificationReason> = T;
type AcceptTemplateReason<T extends TemplateReason> = T;

type ValidCategories = [
  AcceptCategory<"Revisão">,
  AcceptCategory<"Manutenção">,
  AcceptCategory<"Lavagem">,
  AcceptCategory<"Combustível">,
  AcceptCategory<"IPVA">,
  AcceptCategory<"Multas">,
  AcceptCategory<"Seguro">,
  AcceptCategory<"Acessórios">,
];

type ValidCommonCategories = [
  AcceptCommonCategory<"Lavagem">,
  AcceptCommonCategory<"Combustível">,
  AcceptCommonCategory<"IPVA">,
  AcceptCommonCategory<"Multas">,
  AcceptCommonCategory<"Seguro">,
  AcceptCommonCategory<"Acessórios">,
];

type NewClarificationReasons = [
  AcceptClarificationReason<"missing_total_amount">,
  AcceptClarificationReason<"ambiguous_expense_intent">,
];

// @ts-expect-error categoria sem acento não pertence à união canônica.
type InvalidCategoryMissingAccent = AcceptCategory<"Combustivel">;
// @ts-expect-error categoria com caixa incorreta não pertence à união canônica.
type InvalidCategoryWrongCase = AcceptCategory<"manutenção">;
// @ts-expect-error Outros não pertence à união canônica.
type InvalidCategoryOther = AcceptCategory<"Outros">;
// @ts-expect-error Diversos não pertence à união canônica.
type InvalidCategoryMiscellaneous = AcceptCategory<"Diversos">;
// @ts-expect-error string arbitrária não pertence à união canônica.
type InvalidCategoryArbitrary = AcceptCategory<"Qualquer coisa">;

// @ts-expect-error Revisão exige o fluxo guiado, não commonCategory.
type InvalidCommonRevision = AcceptCommonCategory<"Revisão">;
// @ts-expect-error Manutenção exige o fluxo guiado, não commonCategory.
type InvalidCommonMaintenance = AcceptCommonCategory<"Manutenção">;
// @ts-expect-error string arbitrária não pertence a commonCategory.
type InvalidCommonArbitrary = AcceptCommonCategory<"Qualquer coisa">;

// @ts-expect-error quarto status não pertence à união discriminada.
type InvalidFourthStatus = AcceptContractStatus<"pending">;
// @ts-expect-error autorização diferente de none é proibida.
type InvalidAuthorization = AcceptAuthorization<"automatic">;
// @ts-expect-error reason arbitrário não pertence a clarification.
type InvalidClarificationReason = AcceptClarificationReason<"unknown_reason">;
// @ts-expect-error reason arbitrário não pertence a template.
type InvalidTemplateReason = AcceptTemplateReason<"unknown_reason">;

declare const recognized: RecognizedGuidedExpense;
declare const clarification: NeedsGuidedExpenseClarification;
declare const safeKnownData: SafeKnownExpenseData;
declare const additionalItem: AdditionalExpenseItem;

function assertReadonlyContracts(): void {
  // @ts-expect-error status é readonly.
  recognized.status = "recognized";
  // @ts-expect-error category é readonly.
  recognized.category = "Lavagem";
  // @ts-expect-error requiresConfirmation é readonly e sempre true.
  recognized.requiresConfirmation = false;
  // @ts-expect-error singleExpenseLine é readonly e sempre true.
  recognized.singleExpenseLine = false;
  // @ts-expect-error coleção de itens reconhecidos é readonly.
  recognized.recognizedItemKeys.push("inventado");
  // @ts-expect-error safeKnownData é readonly.
  safeKnownData.km = 90_000;
  // @ts-expect-error item adicional é readonly.
  additionalItem.quantity = 2;
}

const clarificationWithMetadata = {
  ...clarification,
  // @ts-expect-error metadata não pertence ao contrato de clarification.
  metadata: {},
} satisfies NeedsGuidedExpenseClarification;

void assertReadonlyContracts;
void clarificationWithMetadata;

declare const newClarificationReasons: NewClarificationReasons;
void newClarificationReasons;

export {};
