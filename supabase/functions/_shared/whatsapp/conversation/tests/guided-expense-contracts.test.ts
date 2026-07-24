import { describe, expect, it } from "bun:test";
import type {
  AdditionalExpenseItem,
  ClarificationReason,
  GuidedExpenseContract,
  NeedsGuidedExpenseClarification,
  RecognizedGuidedExpense,
  SafeKnownExpenseData,
  TechnicalAuthorization,
  TemplateReason,
  UseGuidedExpenseTemplate,
} from "../guided-expense-contracts.ts";
const additionalItem = {
  id: "adicional-1",
  label: "Arruela do bujão",
  quantity: 1,
} satisfies AdditionalExpenseItem;
const recognized = {
  status: "recognized",
  category: "Manutenção",
  totalAmount: 450,
  vehicleId: "vehicle-1",
  km: 80_000,
  recognizedItemKeys: ["oleo_motor", "filtro_oleo"],
  additionalItems: [additionalItem],
  description: "Troca de óleo e filtro",
  laborMentioned: true,
  partsAmount: 300,
  laborAmount: 150,
  requiresConfirmation: true,
  singleExpenseLine: true,
} satisfies RecognizedGuidedExpense;
const clarification = {
  status: "needs_clarification",
  reason: "missing_km",
  safeKnownData: {
    vehicleId: "vehicle-1",
    totalAmount: 450,
    recognizedItemKeys: ["oleo_motor", "filtro_oleo"],
  },
  missingField: "km",
  questionKey: "ask_expense_km",
  technicalAuthorization: "none",
} satisfies NeedsGuidedExpenseClarification;
const guidedTemplate = {
  status: "use_guided_template",
  reason: "multiple_ambiguities",
  safeKnownData: { vehicleId: "vehicle-1" },
  templateKey: "maintenance_expense",
  technicalAuthorization: "none",
} satisfies UseGuidedExpenseTemplate;
describe("guided-expense-contracts — união discriminada", () => {
  it("fixtures válidas cobrem os três status contratuais", () => {
    const contracts: readonly GuidedExpenseContract[] = [recognized, clarification, guidedTemplate];
    expect(contracts.map((contract) => contract.status)).toEqual([
      "recognized",
      "needs_clarification",
      "use_guided_template",
    ]);
  });

  it("estreita cada estado pelo discriminante", () => {
    const amount = (contract: GuidedExpenseContract): number | undefined => {
      switch (contract.status) {
        case "recognized":
          return contract.totalAmount;
        case "needs_clarification":
        case "use_guided_template":
          return contract.safeKnownData.totalAmount;
      }
    };
    expect(amount(recognized)).toBe(450);
    expect(amount(clarification)).toBe(450);
    expect(amount(guidedTemplate)).toBeUndefined();
  });
});

describe("guided-expense-contracts — shape mínimo", () => {
  it("mantém somente os campos aprovados no estado recognized", () => {
    expect(Object.keys(recognized).sort()).toEqual([
      "additionalItems",
      "category",
      "description",
      "km",
      "laborAmount",
      "laborMentioned",
      "partsAmount",
      "recognizedItemKeys",
      "requiresConfirmation",
      "singleExpenseLine",
      "status",
      "totalAmount",
      "vehicleId",
    ]);
    expect(recognized.requiresConfirmation).toBe(true);
    expect(recognized.singleExpenseLine).toBe(true);
  });

  it("mantém AdditionalExpenseItem mínimo e quantity opcional", () => {
    const withoutQuantity = {
      id: "adicional-2",
      label: "Vedação",
    } satisfies AdditionalExpenseItem;
    expect(Object.keys(additionalItem).sort()).toEqual(["id", "label", "quantity"]);
    expect(Object.keys(withoutQuantity).sort()).toEqual(["id", "label"]);
  });

  it("aceita somente dados seguros previstos em safeKnownData", () => {
    const safe = {
      vehicleId: "vehicle-1",
      km: 80_000,
      totalAmount: 450,
      commonCategory: "Lavagem",
      description: "Troca de óleo",
      recognizedItemKeys: ["oleo_motor"],
      additionalItems: [additionalItem],
      laborMentioned: true,
      partsAmount: 300,
      laborAmount: 150,
    } satisfies SafeKnownExpenseData;
    expect(Object.keys(safe).sort()).toEqual([
      "additionalItems",
      "commonCategory",
      "description",
      "km",
      "laborAmount",
      "laborMentioned",
      "partsAmount",
      "recognizedItemKeys",
      "totalAmount",
      "vehicleId",
    ]);
  });
});

describe("guided-expense-contracts — literais das fixtures", () => {
  it("usa autorização técnica e template aprovados", () => {
    const authorization: TechnicalAuthorization = "none";
    expect(authorization).toBe("none");
    expect(clarification.technicalAuthorization).toBe("none");
    expect(guidedTemplate.technicalAuthorization).toBe("none");
    expect(guidedTemplate.templateKey).toBe("maintenance_expense");
  });

  it("usa os reason codes aprovados de clarification", () => {
    const reasons: readonly ClarificationReason[] = [
      "missing_vehicle",
      "missing_km",
      "ambiguous_filter",
      "ambiguous_oil",
      "ambiguous_transmission",
      "quantity_required",
      "ambiguous_item",
      "complex_input",
    ];
    expect(reasons).toHaveLength(8);
  });

  it("usa os reason codes aprovados de template", () => {
    const reasons: readonly TemplateReason[] = [
      "complex_input",
      "multiple_ambiguities",
      "generic_revision",
      "generic_maintenance",
    ];
    expect(reasons).toHaveLength(4);
  });

  it("não contém metadata em clarification nem template", () => {
    expect("metadata" in clarification).toBe(false);
    expect("metadata" in clarification.safeKnownData).toBe(false);
    expect("metadata" in guidedTemplate).toBe(false);
    expect("metadata" in guidedTemplate.safeKnownData).toBe(false);
  });
});
