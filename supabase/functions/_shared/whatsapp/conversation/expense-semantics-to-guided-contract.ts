import type {
  ConversationOnlyExpenseSemantics,
  ExpenseSemanticResult,
  NeedsSemanticClarification,
  ResolvedExpenseSemantics,
  UnsupportedExpenseSemantics,
} from "../../expenses/semantics/types.ts";
import type {
  AdditionalExpenseItem,
  GuidedExpenseContract,
  SafeKnownExpenseData,
} from "./guided-expense-contracts.ts";

export type GuidedExpenseOperationalData = Readonly<{
  humanDescription: string;
  additionalItems: readonly AdditionalExpenseItem[];
  laborMentioned: boolean;
  vehicleId?: string;
  km?: number;
  totalAmount?: number;
  partsAmount?: number;
  laborAmount?: number;
}>;

export type PreservedSemanticDecision =
  | Readonly<{
      status: "resolved";
      persistable: true;
      decisionCode: ResolvedExpenseSemantics["decisionCode"];
      conceptualCategory: ResolvedExpenseSemantics["conceptualCategory"];
    }>
  | Readonly<{
      status: "needs_clarification";
      persistable: false;
      decisionCode: NeedsSemanticClarification["decisionCode"];
    }>
  | Readonly<{
      status: "conversation_only";
      persistable: false;
      decisionCode: ConversationOnlyExpenseSemantics["decisionCode"];
    }>
  | Readonly<{
      status: "unsupported";
      persistable: false;
      decisionCode: UnsupportedExpenseSemantics["decisionCode"];
    }>;

export type ExpenseSemanticsAdapterFailureClass =
  | "contract_violation"
  | "invalid_semantic_input"
  | "unsupported_semantics";

export type ExpenseSemanticsAdapterResult =
  | Readonly<{
      status: "guided";
      semanticDecision: PreservedSemanticDecision;
      guidedContract: GuidedExpenseContract;
    }>
  | Readonly<{
      status: "conversation_only";
      semanticDecision: PreservedSemanticDecision;
      reason: ConversationOnlyExpenseSemantics["reason"];
      technicalAuthorization: "none";
    }>
  | Readonly<{
      status: "unsupported";
      semanticDecision: PreservedSemanticDecision;
      reason:
        | UnsupportedExpenseSemantics["reason"]
        | "invalid_operational_data"
        | "conflicting_operational_data";
      failureClass: ExpenseSemanticsAdapterFailureClass;
      technicalAuthorization: "none";
    }>;

export type AdaptExpenseSemanticsToGuidedContractInput = Readonly<{
  semanticResult: ExpenseSemanticResult;
  operationalData: GuidedExpenseOperationalData;
}>;

type OperationalValidationResult =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      reason: "invalid_operational_data" | "conflicting_operational_data";
    }>;

const preserveSemanticDecision = (
  semanticResult: ExpenseSemanticResult,
): PreservedSemanticDecision => {
  switch (semanticResult.status) {
    case "resolved":
      return {
        status: semanticResult.status,
        persistable: semanticResult.persistable,
        decisionCode: semanticResult.decisionCode,
        conceptualCategory: semanticResult.conceptualCategory,
      };
    case "needs_clarification":
      return {
        status: semanticResult.status,
        persistable: semanticResult.persistable,
        decisionCode: semanticResult.decisionCode,
      };
    case "conversation_only":
      return {
        status: semanticResult.status,
        persistable: semanticResult.persistable,
        decisionCode: semanticResult.decisionCode,
      };
    case "unsupported":
      return {
        status: semanticResult.status,
        persistable: semanticResult.persistable,
        decisionCode: semanticResult.decisionCode,
      };
  }
};

const isValidAmount = (value: number | undefined): boolean =>
  value === undefined || (Number.isFinite(value) && value >= 0);

const toCents = (value: number): number => Math.round(value * 100);

const validateOperationalData = (
  data: GuidedExpenseOperationalData,
): OperationalValidationResult => {
  if (
    typeof data.humanDescription !== "string" ||
    data.humanDescription.trim().length === 0 ||
    !Array.isArray(data.additionalItems) ||
    typeof data.laborMentioned !== "boolean" ||
    (data.vehicleId !== undefined &&
      (typeof data.vehicleId !== "string" || data.vehicleId.trim().length === 0)) ||
    (data.km !== undefined && (!Number.isSafeInteger(data.km) || data.km < 0)) ||
    !isValidAmount(data.totalAmount) ||
    !isValidAmount(data.partsAmount) ||
    !isValidAmount(data.laborAmount)
  ) {
    return { valid: false, reason: "invalid_operational_data" };
  }

  const monetaryValues = [data.totalAmount, data.partsAmount, data.laborAmount].filter(
    (value): value is number => value !== undefined,
  );
  if (monetaryValues.some((value) => !Number.isSafeInteger(toCents(value)))) {
    return { valid: false, reason: "invalid_operational_data" };
  }

  if (
    data.totalAmount !== undefined &&
    data.partsAmount !== undefined &&
    data.laborAmount !== undefined &&
    toCents(data.totalAmount) !== toCents(data.partsAmount) + toCents(data.laborAmount)
  ) {
    return { valid: false, reason: "conflicting_operational_data" };
  }

  return { valid: true };
};

const toSafeKnownData = (
  data: GuidedExpenseOperationalData,
  recognizedItemKeys?: readonly string[],
): SafeKnownExpenseData => ({
  ...(data.vehicleId !== undefined ? { vehicleId: data.vehicleId } : {}),
  ...(data.km !== undefined ? { km: data.km } : {}),
  ...(data.totalAmount !== undefined ? { totalAmount: data.totalAmount } : {}),
  description: data.humanDescription,
  ...(recognizedItemKeys !== undefined ? { recognizedItemKeys } : {}),
  additionalItems: data.additionalItems,
  laborMentioned: data.laborMentioned,
  ...(data.partsAmount !== undefined ? { partsAmount: data.partsAmount } : {}),
  ...(data.laborAmount !== undefined ? { laborAmount: data.laborAmount } : {}),
});

const classifyUnsupported = (
  reason: UnsupportedExpenseSemantics["reason"],
): ExpenseSemanticsAdapterFailureClass => {
  switch (reason) {
    case "invalid_candidate_category":
    case "invalid_candidate_item_key":
      return "contract_violation";
    case "invalid_input":
      return "invalid_semantic_input";
    case "unsupported_semantics":
      return "unsupported_semantics";
  }
};

const assertNever = (value: never): never => {
  throw new Error(`Unexpected semantic result: ${String(value)}`);
};

export const adaptExpenseSemanticsToGuidedContract = ({
  semanticResult,
  operationalData,
}: AdaptExpenseSemanticsToGuidedContractInput): ExpenseSemanticsAdapterResult => {
  const semanticDecision = preserveSemanticDecision(semanticResult);

  switch (semanticResult.status) {
    case "resolved": {
      const operationalValidation = validateOperationalData(operationalData);
      if (operationalValidation.valid === false) {
        return {
          status: "unsupported",
          semanticDecision,
          reason: operationalValidation.reason,
          failureClass: "contract_violation",
          technicalAuthorization: "none",
        };
      }

      const safeKnownData = toSafeKnownData(operationalData, semanticResult.itemKeys);
      const missingFields = [
        operationalData.vehicleId === undefined ? "vehicleId" : undefined,
        operationalData.km === undefined ? "km" : undefined,
        operationalData.totalAmount === undefined ? "totalAmount" : undefined,
      ].filter((field): field is "vehicleId" | "km" | "totalAmount" => field !== undefined);

      if (missingFields.length >= 2) {
        return {
          status: "guided",
          semanticDecision,
          guidedContract: {
            status: "use_guided_template",
            reason: "multiple_ambiguities",
            safeKnownData,
            templateKey: "maintenance_expense",
            technicalAuthorization: "none",
          },
        };
      }

      if (missingFields.length === 1) {
        const missingField = missingFields[0];
        const clarification =
          missingField === "vehicleId"
            ? {
                reason: "missing_vehicle" as const,
                missingField: "vehicleId",
                questionKey: "ask_expense_vehicle",
              }
            : missingField === "km"
              ? {
                  reason: "missing_km" as const,
                  missingField: "km",
                  questionKey: "ask_expense_km",
                }
              : {
                  reason: "missing_total_amount" as const,
                  missingField: "totalAmount",
                  questionKey: "ask_expense_total_amount",
                };

        return {
          status: "guided",
          semanticDecision,
          guidedContract: {
            status: "needs_clarification",
            ...clarification,
            safeKnownData,
            technicalAuthorization: "none",
          },
        };
      }

      return {
        status: "guided",
        semanticDecision,
        guidedContract: {
          status: "recognized",
          category: semanticResult.conceptualCategory,
          totalAmount: operationalData.totalAmount,
          vehicleId: operationalData.vehicleId,
          km: operationalData.km,
          recognizedItemKeys: semanticResult.itemKeys,
          additionalItems: operationalData.additionalItems,
          description: operationalData.humanDescription,
          laborMentioned: operationalData.laborMentioned,
          ...(operationalData.partsAmount !== undefined
            ? { partsAmount: operationalData.partsAmount }
            : {}),
          ...(operationalData.laborAmount !== undefined
            ? { laborAmount: operationalData.laborAmount }
            : {}),
          requiresConfirmation: true,
          singleExpenseLine: true,
        },
      };
    }

    case "needs_clarification": {
      switch (semanticResult.reason) {
        case "expense_or_question_intent_ambiguous":
          return {
            status: "guided",
            semanticDecision,
            guidedContract: {
              status: "needs_clarification",
              reason: "ambiguous_expense_intent",
              missingField: "expenseIntent",
              questionKey: "ask_expense_or_question_intent",
              safeKnownData: {},
              technicalAuthorization: "none",
            },
          };

        case "oil_system_ambiguous": {
          const operationalValidation = validateOperationalData(operationalData);
          if (operationalValidation.valid === false) {
            return {
              status: "unsupported",
              semanticDecision,
              reason: operationalValidation.reason,
              failureClass: "contract_violation",
              technicalAuthorization: "none",
            };
          }

          return {
            status: "guided",
            semanticDecision,
            guidedContract: {
              status: "needs_clarification",
              reason: "ambiguous_oil",
              missingField: "oilSystem",
              questionKey: "ask_oil_system",
              safeKnownData: toSafeKnownData(operationalData),
              technicalAuthorization: "none",
            },
          };
        }

        case "category_ambiguous_non_engine": {
          const operationalValidation = validateOperationalData(operationalData);
          if (operationalValidation.valid === false) {
            return {
              status: "unsupported",
              semanticDecision,
              reason: operationalValidation.reason,
              failureClass: "contract_violation",
              technicalAuthorization: "none",
            };
          }

          return {
            status: "guided",
            semanticDecision,
            guidedContract: {
              status: "needs_clarification",
              reason: "ambiguous_category",
              missingField: "category",
              questionKey: "ask_category",
              options: semanticResult.candidateCategories,
              safeKnownData: toSafeKnownData(operationalData),
              technicalAuthorization: "none",
            },
          };
        }

        default:
          return assertNever(semanticResult.reason);
      }
    }

    case "conversation_only":
      return {
        status: "conversation_only",
        semanticDecision,
        reason: semanticResult.reason,
        technicalAuthorization: "none",
      };

    case "unsupported":
      return {
        status: "unsupported",
        semanticDecision,
        reason: semanticResult.reason,
        failureClass: classifyUnsupported(semanticResult.reason),
        technicalAuthorization: "none",
      };

    default:
      return assertNever(semanticResult);
  }
};
