import { describe, expect, it } from "bun:test";
import type {
  ConversationOnlyExpenseSemantics,
  ExpenseSemanticResult,
  ResolvedExpenseSemantics,
  UnsupportedExpenseSemantics,
} from "../../../expenses/semantics/types.ts";
import {
  adaptExpenseSemanticsToGuidedContract,
  type GuidedExpenseOperationalData,
} from "../expense-semantics-to-guided-contract.ts";
import type { AdditionalExpenseItem } from "../guided-expense-contracts.ts";

const engineOilResult = {
  status: "resolved",
  persistable: true,
  conceptualCategory: "Revisão",
  itemKeys: ["oleo_motor", "filtro_oleo"],
  facts: { serviceCompleted: true, recognizedSystems: ["engine_oil"] },
  decisionCode: "completed_deterministic_revision_item",
} as const satisfies ResolvedExpenseSemantics;

const filterOnlyResult = {
  ...engineOilResult,
  itemKeys: ["filtro_oleo"],
} as const satisfies ResolvedExpenseSemantics;

const transmissionResult = {
  status: "resolved",
  persistable: true,
  conceptualCategory: "Revisão",
  itemKeys: [],
  facts: { serviceCompleted: true, recognizedSystems: ["transmission_fluid"] },
  decisionCode: "completed_transmission_fluid_without_safe_item_key",
} as const satisfies ResolvedExpenseSemantics;

const maintenanceResult = {
  status: "resolved",
  persistable: true,
  conceptualCategory: "Manutenção",
  itemKeys: [],
  facts: { serviceCompleted: true, recognizedSystems: ["automotive_service"] },
  decisionCode: "completed_automotive_service",
} as const satisfies ResolvedExpenseSemantics;

const completeOperationalData = {
  humanDescription: "Troca de óleo e filtro — descrição literal",
  additionalItems: [],
  laborMentioned: false,
  vehicleId: "vehicle-1",
  km: 80_000,
  totalAmount: 450,
} as const satisfies GuidedExpenseOperationalData;

const operationalData = (
  overrides: Partial<GuidedExpenseOperationalData> = {},
): GuidedExpenseOperationalData => ({ ...completeOperationalData, ...overrides });

const adapt = (
  semanticResult: ExpenseSemanticResult,
  data: GuidedExpenseOperationalData = completeOperationalData,
) =>
  adaptExpenseSemanticsToGuidedContract({
    semanticResult,
    operationalData: data,
  });

describe("expense semantics adapter — resolved", () => {
  it("reconhece óleo do motor usando somente categoria e itens do Core", () => {
    const result = adapt(engineOilResult);

    expect(result.status).toBe("guided");
    if (result.status !== "guided" || result.guidedContract.status !== "recognized") {
      throw new Error("expected recognized guided expense");
    }
    expect(result.semanticDecision).toEqual({
      status: "resolved",
      persistable: true,
      decisionCode: "completed_deterministic_revision_item",
      conceptualCategory: "Revisão",
    });
    expect(result.guidedContract).toMatchObject({
      category: "Revisão",
      recognizedItemKeys: ["oleo_motor", "filtro_oleo"],
      description: completeOperationalData.humanDescription,
      requiresConfirmation: true,
      singleExpenseLine: true,
    });
  });

  it("preserva filtro de óleo isolado sem adicionar óleo do motor", () => {
    const result = adapt(filterOnlyResult);
    expect(result.status).toBe("guided");
    if (result.status === "guided" && result.guidedContract.status === "recognized") {
      expect(result.guidedContract.recognizedItemKeys).toEqual(["filtro_oleo"]);
    }
  });

  it("mantém transmissão genérica como Revisão com lista vazia", () => {
    // Origem documentada: “Troquei óleo de câmbio 1.299”.
    const result = adapt(
      transmissionResult,
      operationalData({
        humanDescription: "Troquei óleo de câmbio 1.299",
        totalAmount: 1299,
      }),
    );
    expect(result.status).toBe("guided");
    if (result.status === "guided" && result.guidedContract.status === "recognized") {
      expect(result.guidedContract.category).toBe("Revisão");
      expect(result.guidedContract.recognizedItemKeys).toEqual([]);
      expect(result.semanticDecision.decisionCode).toBe(
        "completed_transmission_fluid_without_safe_item_key",
      );
      expect(result.guidedContract.recognizedItemKeys).not.toContain("filtro_oleo");
      expect(result.guidedContract.recognizedItemKeys).not.toContain("oleo_cambio_manual");
      expect(result.guidedContract.recognizedItemKeys).not.toContain("oleo_cambio_automatico");
    }
  });

  it("mantém manutenção sem fallback de itens", () => {
    const result = adapt(maintenanceResult);
    expect(result.status).toBe("guided");
    if (result.status === "guided" && result.guidedContract.status === "recognized") {
      expect(result.guidedContract.category).toBe("Manutenção");
      expect(result.guidedContract.recognizedItemKeys).toEqual([]);
    }
  });

  it("preserva todos os dados operacionais, inclusive zero", () => {
    const additionalItems = [
      { id: "bomba-agua", label: "Bomba d’água", quantity: 1 },
    ] as const satisfies readonly AdditionalExpenseItem[];
    // Cobertura estrutural futura: item determinístico do Core e adicional coexistem
    // em uma linha, sem expandir o registry para correia dentada.
    const result = adapt(
      engineOilResult,
      operationalData({
        vehicleId: "vehicle-zero",
        km: 0,
        totalAmount: 0,
        partsAmount: 0,
        laborAmount: 0,
        additionalItems,
        laborMentioned: true,
      }),
    );
    expect(result.status).toBe("guided");
    if (result.status === "guided" && result.guidedContract.status === "recognized") {
      expect(result.guidedContract).toMatchObject({
        vehicleId: "vehicle-zero",
        km: 0,
        totalAmount: 0,
        partsAmount: 0,
        laborAmount: 0,
        laborMentioned: true,
        singleExpenseLine: true,
      });
      expect(result.guidedContract.additionalItems).toBe(additionalItems);
      expect(result.guidedContract.recognizedItemKeys).toBe(engineOilResult.itemKeys);
    }
  });
});

describe("expense semantics adapter — dados ausentes", () => {
  const cases = [
    {
      name: "vehicleId",
      data: {
        humanDescription: "Despesa",
        additionalItems: [],
        laborMentioned: false,
        km: 10,
        totalAmount: 20,
      },
      reason: "missing_vehicle",
      missingField: "vehicleId",
      questionKey: "ask_expense_vehicle",
    },
    {
      name: "km",
      data: {
        humanDescription: "Troquei óleo de câmbio 1.299",
        additionalItems: [],
        laborMentioned: false,
        vehicleId: "vehicle-1",
        totalAmount: 1299,
      },
      reason: "missing_km",
      missingField: "km",
      questionKey: "ask_expense_km",
    },
    {
      name: "totalAmount",
      data: {
        humanDescription: "Despesa",
        additionalItems: [],
        laborMentioned: false,
        vehicleId: "vehicle-1",
        km: 10,
      },
      reason: "missing_total_amount",
      missingField: "totalAmount",
      questionKey: "ask_expense_total_amount",
    },
  ] as const;

  for (const testCase of cases) {
    it(`pergunta somente por ${testCase.name}`, () => {
      const result = adapt(transmissionResult, testCase.data);
      expect(result.status).toBe("guided");
      if (result.status === "guided") {
        expect(result.guidedContract).toMatchObject({
          status: "needs_clarification",
          reason: testCase.reason,
          missingField: testCase.missingField,
          questionKey: testCase.questionKey,
          technicalAuthorization: "none",
        });
        expect(result.semanticDecision.decisionCode).toBe(
          "completed_transmission_fluid_without_safe_item_key",
        );
      }
    });
  }

  it("usa template somente para resolved com dois campos ausentes", () => {
    const result = adapt(engineOilResult, {
      humanDescription: "Despesa",
      additionalItems: [],
      laborMentioned: false,
      vehicleId: "vehicle-1",
    });
    expect(result.status).toBe("guided");
    if (result.status === "guided") {
      expect(result.guidedContract).toMatchObject({
        status: "use_guided_template",
        reason: "multiple_ambiguities",
        templateKey: "maintenance_expense",
        technicalAuthorization: "none",
      });
      expect(result.semanticDecision).toEqual({
        status: "resolved",
        persistable: true,
        decisionCode: "completed_deterministic_revision_item",
        conceptualCategory: "Revisão",
      });
    }
  });

  it("usa template para resolved com os três campos ausentes", () => {
    const result = adapt(engineOilResult, {
      humanDescription: "Despesa",
      additionalItems: [],
      laborMentioned: false,
    });
    expect(result.status).toBe("guided");
    if (result.status === "guided") {
      expect(result.guidedContract.status).toBe("use_guided_template");
    }
  });
});

describe("expense semantics adapter — validação operacional fail closed", () => {
  const invalidCases: readonly Readonly<{
    name: string;
    data: GuidedExpenseOperationalData;
    reason?: "invalid_operational_data" | "conflicting_operational_data";
  }>[] = [
    { name: "vehicleId vazio", data: operationalData({ vehicleId: "  " }) },
    { name: "km fracionária", data: operationalData({ km: 1.5 }) },
    { name: "km negativa", data: operationalData({ km: -1 }) },
    { name: "km não finita", data: operationalData({ km: Infinity }) },
    { name: "totalAmount NaN", data: operationalData({ totalAmount: Number.NaN }) },
    { name: "totalAmount Infinity", data: operationalData({ totalAmount: Infinity }) },
    { name: "valor negativo", data: operationalData({ totalAmount: -1 }) },
    { name: "descrição vazia", data: operationalData({ humanDescription: " \t" }) },
    { name: "partsAmount inválido", data: operationalData({ partsAmount: -1 }) },
    { name: "laborAmount inválido", data: operationalData({ laborAmount: Number.NaN }) },
    {
      name: "soma monetária incoerente",
      data: operationalData({ totalAmount: 100, partsAmount: 60, laborAmount: 39.99 }),
      reason: "conflicting_operational_data",
    },
  ];

  for (const testCase of invalidCases) {
    it(`rejeita ${testCase.name}`, () => {
      const result = adapt(engineOilResult, testCase.data);
      expect(result).toMatchObject({
        status: "unsupported",
        reason: testCase.reason ?? "invalid_operational_data",
        failureClass: "contract_violation",
        technicalAuthorization: "none",
      });
      expect("guidedContract" in result).toBe(false);
    });
  }

  it("compara soma monetária em centavos", () => {
    const result = adapt(
      engineOilResult,
      operationalData({ totalAmount: 0.3, partsAmount: 0.1, laborAmount: 0.2 }),
    );
    expect(result.status).toBe("guided");
  });
});

describe("expense semantics adapter — needs clarification", () => {
  it("mapeia óleo ambíguo sem reconhecer nem usar template", () => {
    // Origem documentada: “Troquei óleo”.
    const result = adapt({
      status: "needs_clarification",
      persistable: false,
      reason: "oil_system_ambiguous",
      decisionCode: "clarification_required",
    });
    expect(result).toMatchObject({
      status: "guided",
      semanticDecision: {
        status: "needs_clarification",
        persistable: false,
        decisionCode: "clarification_required",
      },
      guidedContract: {
        status: "needs_clarification",
        reason: "ambiguous_oil",
        missingField: "oilSystem",
        questionKey: "ask_oil_system",
        technicalAuthorization: "none",
      },
    });
  });

  it("mapeia intenção ambígua antes de pedir KM ou valor", () => {
    // Origens documentadas: “Óleo do câmbio, R$ 1.199” e “Óleo do carro”.
    const result = adapt(
      {
        status: "needs_clarification",
        persistable: false,
        reason: "expense_or_question_intent_ambiguous",
        decisionCode: "clarification_required",
      },
      {
        humanDescription: "Óleo do câmbio, R$ 1.199",
        additionalItems: [],
        laborMentioned: false,
        totalAmount: 1199,
      },
    );
    expect(result).toMatchObject({
      status: "guided",
      guidedContract: {
        status: "needs_clarification",
        reason: "ambiguous_expense_intent",
        missingField: "expenseIntent",
        questionKey: "ask_expense_or_question_intent",
        technicalAuthorization: "none",
      },
    });
  });
});

describe("expense semantics adapter — conversation only", () => {
  const reasons = [
    "future_service",
    "quote",
    "technical_question",
    "purchase_before_service",
  ] as const satisfies readonly ConversationOnlyExpenseSemantics["reason"][];

  for (const reason of reasons) {
    it(`preserva ${reason} sem criar despesa`, () => {
      const result = adapt({
        status: "conversation_only",
        persistable: false,
        reason,
        decisionCode: "non_persistable_conversation",
      });
      expect(result).toEqual({
        status: "conversation_only",
        semanticDecision: {
          status: "conversation_only",
          persistable: false,
          decisionCode: "non_persistable_conversation",
        },
        reason,
        technicalAuthorization: "none",
      });
      expect("guidedContract" in result).toBe(false);
      expect("templateKey" in result).toBe(false);
      expect("preview" in result).toBe(false);
    });
  }
});

describe("expense semantics adapter — unsupported", () => {
  const cases = [
    ["invalid_input", "invalid_semantic_input"],
    ["invalid_candidate_category", "contract_violation"],
    ["invalid_candidate_item_key", "contract_violation"],
    ["unsupported_semantics", "unsupported_semantics"],
  ] as const satisfies readonly (readonly [
    UnsupportedExpenseSemantics["reason"],
    "contract_violation" | "invalid_semantic_input" | "unsupported_semantics",
  ])[];

  for (const [reason, failureClass] of cases) {
    it(`classifica ${reason} como ${failureClass}`, () => {
      const result = adapt({
        status: "unsupported",
        persistable: false,
        reason,
        decisionCode: "fail_closed",
      });
      expect(result).toEqual({
        status: "unsupported",
        semanticDecision: {
          status: "unsupported",
          persistable: false,
          decisionCode: "fail_closed",
        },
        reason,
        failureClass,
        technicalAuthorization: "none",
      });
      expect("guidedContract" in result).toBe(false);
    });
  }
});

describe("expense semantics adapter - correcoes da revisao formal", () => {
  it("descarta exatamente todos os dados de intencao de despesa ambigua", () => {
    const additionalItems = [
      { id: "kit", label: "Kit complementar", quantity: 1 },
    ] as const satisfies readonly AdditionalExpenseItem[];
    const result = adapt(
      {
        status: "needs_clarification",
        persistable: false,
        reason: "expense_or_question_intent_ambiguous",
        decisionCode: "clarification_required",
      },
      {
        vehicleId: "vehicle-1",
        km: 80_000,
        totalAmount: 1199,
        humanDescription: "Troca de oleo do cambio",
        additionalItems,
        laborMentioned: true,
        partsAmount: 999,
        laborAmount: 200,
      },
    );

    expect(result.status).toBe("guided");
    if (result.status !== "guided" || result.guidedContract.status !== "needs_clarification") {
      throw new Error("expected ambiguous expense intent clarification");
    }
    expect(result.guidedContract).toMatchObject({
      reason: "ambiguous_expense_intent",
      missingField: "expenseIntent",
      questionKey: "ask_expense_or_question_intent",
      technicalAuthorization: "none",
    });
    expect(result.guidedContract.safeKnownData).toEqual({});
    expect(Object.keys(result.guidedContract.safeKnownData)).toEqual([]);
  });

  it("nao valida dados descartados na intencao ambigua", () => {
    const result = adapt(
      {
        status: "needs_clarification",
        persistable: false,
        reason: "expense_or_question_intent_ambiguous",
        decisionCode: "clarification_required",
      },
      operationalData({
        humanDescription: "   ",
        totalAmount: Number.NaN,
        km: 1.5,
      }),
    );

    expect(result.status).toBe("guided");
    if (result.status === "guided" && result.guidedContract.status === "needs_clarification") {
      expect(result.guidedContract.reason).toBe("ambiguous_expense_intent");
      expect(result.guidedContract.safeKnownData).toEqual({});
    }
  });

  it("preserva somente dados operacionais validos para oleo ambiguo", () => {
    const additionalItems = [
      { id: "anel", label: "Anel de vedacao" },
    ] as const satisfies readonly AdditionalExpenseItem[];
    const data = operationalData({
      vehicleId: "vehicle-oil",
      km: 80_000,
      totalAmount: 350,
      humanDescription: "Troquei oleo por R$ 350 aos 80.000 km",
      additionalItems,
      laborMentioned: true,
      partsAmount: 300,
      laborAmount: 50,
    });
    const result = adapt(
      {
        status: "needs_clarification",
        persistable: false,
        reason: "oil_system_ambiguous",
        decisionCode: "clarification_required",
      },
      data,
    );

    expect(result.status).toBe("guided");
    if (result.status === "guided" && result.guidedContract.status === "needs_clarification") {
      expect(result.guidedContract).toMatchObject({
        reason: "ambiguous_oil",
        missingField: "oilSystem",
        questionKey: "ask_oil_system",
        safeKnownData: {
          vehicleId: "vehicle-oil",
          km: 80_000,
          totalAmount: 350,
          description: data.humanDescription,
          additionalItems,
          laborMentioned: true,
          partsAmount: 300,
          laborAmount: 50,
        },
      });
      expect("commonCategory" in result.guidedContract.safeKnownData).toBe(false);
      expect("recognizedItemKeys" in result.guidedContract.safeKnownData).toBe(false);
    }
  });

  it("rejeita dado que seria publicado para oleo ambiguo", () => {
    const result = adapt(
      {
        status: "needs_clarification",
        persistable: false,
        reason: "oil_system_ambiguous",
        decisionCode: "clarification_required",
      },
      operationalData({ totalAmount: Number.NaN }),
    );
    expect(result).toMatchObject({
      status: "unsupported",
      reason: "invalid_operational_data",
      failureClass: "contract_violation",
    });
  });

  it("preserva a descricao reconhecida literalmente", () => {
    const humanDescription = "  Troca de óleo 🚗  ";
    const result = adapt(engineOilResult, operationalData({ humanDescription }));
    expect(result.status).toBe("guided");
    if (result.status === "guided" && result.guidedContract.status === "recognized") {
      expect(result.guidedContract.description).toBe(humanDescription);
      expect(result.guidedContract.description).not.toBe(humanDescription.trim());
    }
  });

  it("preserva categoria Revisao na pergunta de km", () => {
    const result = adapt(transmissionResult, {
      humanDescription: "Troca de oleo do cambio",
      additionalItems: [],
      laborMentioned: false,
      vehicleId: "vehicle-1",
      totalAmount: 1299,
    });
    expect(result.status).toBe("guided");
    expect(result.semanticDecision).toEqual({
      status: "resolved",
      persistable: true,
      decisionCode: "completed_transmission_fluid_without_safe_item_key",
      conceptualCategory: "Revisão",
    });
  });

  it("preserva categoria Manutencao na pergunta de valor", () => {
    const result = adapt(maintenanceResult, operationalData({ totalAmount: undefined }));
    expect(result.status).toBe("guided");
    expect(result.semanticDecision).toMatchObject({
      status: "resolved",
      conceptualCategory: "Manutenção",
    });
    if (result.status === "guided") {
      expect(result.guidedContract).toMatchObject({
        status: "needs_clarification",
        reason: "missing_total_amount",
      });
    }
  });

  it("preserva categoria e todos os fatos seguros no template", () => {
    const additionalItems = [
      { id: "adicional", label: "Item adicional" },
    ] as const satisfies readonly AdditionalExpenseItem[];
    const result = adapt(engineOilResult, {
      humanDescription: "Oleo e filtro",
      additionalItems,
      laborMentioned: true,
      vehicleId: "vehicle-template",
    });
    expect(result.status).toBe("guided");
    expect(result.semanticDecision).toMatchObject({
      status: "resolved",
      conceptualCategory: "Revisão",
    });
    if (result.status === "guided" && result.guidedContract.status === "use_guided_template") {
      expect(result.guidedContract.safeKnownData).toEqual({
        vehicleId: "vehicle-template",
        description: "Oleo e filtro",
        recognizedItemKeys: ["oleo_motor", "filtro_oleo"],
        additionalItems,
        laborMentioned: true,
      });
      expect("km" in result.guidedContract.safeKnownData).toBe(false);
      expect("totalAmount" in result.guidedContract.safeKnownData).toBe(false);
    }
  });

  it("preserva categoria Manutencao quando dados resolved falham fechados", () => {
    const result = adapt(maintenanceResult, operationalData({ totalAmount: Number.NaN }));
    expect(result.status).toBe("unsupported");
    expect(result.semanticDecision).toEqual({
      status: "resolved",
      persistable: true,
      decisionCode: "completed_automotive_service",
      conceptualCategory: "Manutenção",
    });
  });
});

describe("expense semantics adapter - precedencia semantica", () => {
  const conversationCases = [
    ["technical_question", operationalData({ humanDescription: "  " })],
    ["future_service", operationalData({ totalAmount: Number.NaN })],
    ["quote", operationalData({ km: 1.5 })],
    ["purchase_before_service", operationalData({ vehicleId: "" })],
  ] as const satisfies readonly (readonly [
    ConversationOnlyExpenseSemantics["reason"],
    GuidedExpenseOperationalData,
  ])[];

  for (const [reason, data] of conversationCases) {
    it(`nao mascara conversation_only ${reason}`, () => {
      const result = adapt(
        {
          status: "conversation_only",
          persistable: false,
          reason,
          decisionCode: "non_persistable_conversation",
        },
        data,
      );
      expect(result).toEqual({
        status: "conversation_only",
        semanticDecision: {
          status: "conversation_only",
          persistable: false,
          decisionCode: "non_persistable_conversation",
        },
        reason,
        technicalAuthorization: "none",
      });
    });
  }

  const unsupportedCases = [
    ["invalid_input", "invalid_semantic_input"],
    ["invalid_candidate_category", "contract_violation"],
    ["invalid_candidate_item_key", "contract_violation"],
    ["unsupported_semantics", "unsupported_semantics"],
  ] as const satisfies readonly (readonly [
    UnsupportedExpenseSemantics["reason"],
    "contract_violation" | "invalid_semantic_input" | "unsupported_semantics",
  ])[];

  for (const [reason, failureClass] of unsupportedCases) {
    it(`nao mascara unsupported ${reason}`, () => {
      const result = adapt(
        {
          status: "unsupported",
          persistable: false,
          reason,
          decisionCode: "fail_closed",
        },
        operationalData({ humanDescription: " ", totalAmount: Number.NaN, km: 1.5 }),
      );
      expect(result).toMatchObject({
        status: "unsupported",
        reason,
        failureClass,
        semanticDecision: { status: "unsupported", decisionCode: "fail_closed" },
      });
      expect("guidedContract" in result).toBe(false);
    });
  }
});
