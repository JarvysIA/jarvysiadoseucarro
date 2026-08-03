import { describe, expect, it } from "bun:test";
import {
  validateExpenseSemanticOccurrence,
  type ExpenseSemanticOccurrence,
} from "../concept-event-contract.ts";
import { EXPENSE_SEMANTIC_CONCEPT_REGISTRY, findExpenseSemanticConcept } from "../registry.ts";
import { EXPENSE_SEMANTIC_CATEGORIES } from "../types.ts";

const engineOil = {
  conceptKey: "engine_oil",
  recognitionSource: "deterministic_core",
  relatedItemKeys: ["oleo_motor"],
} as const;
const engineOilFilter = {
  conceptKey: "engine_oil_filter",
  recognitionSource: "explicit_user_statement",
  relatedItemKeys: ["filtro_oleo"],
} as const;
const tires = {
  conceptKey: "tires",
  recognitionSource: "explicit_user_statement",
  relatedItemKeys: [],
} as const;
const brakePads = {
  conceptKey: "brake_pads",
  recognitionSource: "explicit_user_statement",
  relatedItemKeys: [],
} as const;

const valid = (): ExpenseSemanticOccurrence => ({
  contractVersion: "p0_3b_s3_3",
  concepts: [engineOil, engineOilFilter],
  category: "Revisão",
  description: "Compra de óleo e filtro do motor",
  financialValue: { status: "declared_positive", declaredAmount: 120 },
  aiAuthority: "none",
  runtimeIntegration: "disconnected",
});

const expectInvalid = (value: unknown, code?: string, path?: string): void => {
  const result = validateExpenseSemanticOccurrence(value);
  expect(result.valid).toBe(false);
  if (!result.valid) {
    if (code !== undefined) expect(result.error.code).toBe(code);
    if (path !== undefined) expect(result.error.path).toBe(path);
  }
};

describe("expense semantic occurrence — contrato mínimo", () => {
  it("aceita uma ocorrência válida sem coerção nem mutação", () => {
    const input = valid();
    const before = structuredClone(input);
    const result = validateExpenseSemanticOccurrence(input);
    expect(result).toEqual({ valid: true, value: input });
    expect(result.valid && result.value).toBe(input);
    expect(input).toEqual(before);
  });

  it("preserva ordem, descrição literal e conceitos diferentes", () => {
    const description = "  Compra de 4 pneus — mão de obra amanhã  ";
    const input = {
      ...valid(),
      concepts: [tires, brakePads, engineOil] as const,
      description,
    };
    const result = validateExpenseSemanticOccurrence(input);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.concepts).toEqual([tires, brakePads, engineOil]);
      expect(result.value.description).toBe(description);
    }
  });

  for (const category of EXPENSE_SEMANTIC_CATEGORIES) {
    it(`aceita a categoria fechada ${category}`, () => {
      expect(validateExpenseSemanticOccurrence({ ...valid(), category }).valid).toBe(true);
    });
  }

  for (const definition of EXPENSE_SEMANTIC_CONCEPT_REGISTRY) {
    const { conceptKey, relatedItemKeys } = definition;
    it(`aceita o conceito canônico ${conceptKey}`, () => {
      const concept = {
        conceptKey,
        recognitionSource: "explicit_user_statement",
        relatedItemKeys,
      } as const;
      expect(validateExpenseSemanticOccurrence({ ...valid(), concepts: [concept] }).valid).toBe(
        true,
      );
    });
  }

  it("mantém allowlist, ordem e imutabilidade do registry canônico", () => {
    expect(EXPENSE_SEMANTIC_CONCEPT_REGISTRY).toEqual([
      { conceptKey: "engine_oil", relatedItemKeys: ["oleo_motor"] },
      { conceptKey: "engine_oil_filter", relatedItemKeys: ["filtro_oleo"] },
      { conceptKey: "tires", relatedItemKeys: [] },
      { conceptKey: "multimedia_system", relatedItemKeys: [] },
      { conceptKey: "transmission_fluid", relatedItemKeys: [] },
      { conceptKey: "brake_pads", relatedItemKeys: [] },
      { conceptKey: "engine_air_filter", relatedItemKeys: [] },
      { conceptKey: "cabin_filter", relatedItemKeys: [] },
      { conceptKey: "fuel_filter", relatedItemKeys: [] },
      { conceptKey: "timing_kit", relatedItemKeys: [] },
      { conceptKey: "cooling_system", relatedItemKeys: [] },
      { conceptKey: "spark_and_injection", relatedItemKeys: [] },
      { conceptKey: "suspension", relatedItemKeys: [] },
      { conceptKey: "wiper_blades", relatedItemKeys: [] },
      { conceptKey: "wheel_alignment", relatedItemKeys: [] },
      { conceptKey: "power_steering_fluid", relatedItemKeys: [] },
      { conceptKey: "hybrid_ecvt_diagnostic", relatedItemKeys: [] },
    ]);
    expect(Object.isFrozen(EXPENSE_SEMANTIC_CONCEPT_REGISTRY)).toBe(true);
    for (const definition of EXPENSE_SEMANTIC_CONCEPT_REGISTRY) {
      expect(Object.keys(definition)).toEqual(["conceptKey", "relatedItemKeys"]);
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.relatedItemKeys)).toBe(true);
    }
    expect(findExpenseSemanticConcept("oleo do motor")).toBeUndefined();
  });

  it("aceita lista vazia", () => {
    expect(validateExpenseSemanticOccurrence({ ...valid(), concepts: [] }).valid).toBe(true);
  });

  it("rejeita conceito desconhecido e alias textual", () => {
    expectInvalid(
      { ...valid(), concepts: [{ ...engineOil, conceptKey: "unknown_concept" }] },
      "invalid_value",
      "$.concepts[0].conceptKey",
    );
    expectInvalid(
      { ...valid(), concepts: [{ ...engineOil, conceptKey: "oleo do motor" }] },
      "invalid_value",
      "$.concepts[0].conceptKey",
    );
  });

  it("rejeita metadados divergentes do registry", () => {
    expectInvalid(
      { ...valid(), concepts: [{ ...engineOil, relatedItemKeys: ["filtro_oleo"] }] },
      "invalid_value",
      "$.concepts[0].relatedItemKeys",
    );
    expectInvalid(
      { ...valid(), concepts: [{ ...engineOil, recognitionSource: "ai_suggestion" }] },
      "invalid_value",
      "$.concepts[0].recognitionSource",
    );
  });

  it("rejeita duplicidade sem deduplicar silenciosamente", () => {
    const input = { ...valid(), concepts: [tires, brakePads, tires] };
    expectInvalid(input, "duplicate_concept", "$.concepts[2]");
    expect(input.concepts).toEqual([tires, brakePads, tires]);
  });

  it("permite o mesmo conceito em lançamentos independentes", () => {
    const first = { ...valid(), concepts: [tires] };
    const second = { ...valid(), concepts: [tires], description: "Nova compra de pneus" };
    expect(validateExpenseSemanticOccurrence(first).valid).toBe(true);
    expect(validateExpenseSemanticOccurrence(second).valid).toBe(true);
  });
});

describe("expense semantic occurrence — descrição e valor", () => {
  it("aceita descrição com exatamente 500 caracteres", () => {
    expect(
      validateExpenseSemanticOccurrence({ ...valid(), description: "x".repeat(500) }).valid,
    ).toBe(true);
  });

  for (const description of ["", "   ", "\n\t", "x".repeat(501), null, 123]) {
    it(`rejeita descrição inválida ${JSON.stringify(description)}`, () => {
      expectInvalid({ ...valid(), description }, "invalid_value", "$.description");
    });
  }

  it("aceita exatamente os três estados financeiros", () => {
    const values = [
      { status: "declared_positive", declaredAmount: 0.01 },
      { status: "confirmed_zero_cost", declaredAmount: 0 },
      { status: "not_informed" },
    ];
    for (const financialValue of values) {
      expect(validateExpenseSemanticOccurrence({ ...valid(), financialValue }).valid).toBe(true);
    }
  });

  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "10", null]) {
    it(`rejeita declared_positive inválido ${String(amount)}`, () => {
      expectInvalid(
        {
          ...valid(),
          financialValue: { status: "declared_positive", declaredAmount: amount },
        },
        "invalid_value",
        "$.financialValue.declaredAmount",
      );
    });
  }

  it("exige zero literal no estado confirmed_zero_cost", () => {
    expectInvalid(
      {
        ...valid(),
        financialValue: { status: "confirmed_zero_cost", declaredAmount: 1 },
      },
      "invalid_value",
      "$.financialValue.declaredAmount",
    );
  });

  it("proíbe declaredAmount no estado not_informed, inclusive undefined", () => {
    expectInvalid(
      {
        ...valid(),
        financialValue: { status: "not_informed", declaredAmount: undefined },
      },
      "unknown_property",
      "$.financialValue.declaredAmount",
    );
  });

  it("não aceita coerção financeira nem status aberto", () => {
    expectInvalid(
      { ...valid(), financialValue: { status: "unknown" } },
      "invalid_value",
      "$.financialValue.status",
    );
  });
});

describe("expense semantic occurrence — ausência de autoridade e runtime", () => {
  const forbiddenFields = [
    "title",
    "quantity",
    "unit",
    "events",
    "serviceKind",
    "completion",
    "occurrenceCount",
    "km",
    "kmAtual",
    "kmRegistro",
    "expectedPreviousKm",
    "vehicleId",
    "expenseId",
    "linkedExpenseId",
    "technicalEffect",
    "scheduleEffect",
    "scheduleUpdated",
    "cardEffect",
    "persistable",
    "persisted",
  ] as const;

  for (const field of forbiddenFields) {
    it(`rejeita o campo fora de escopo ${field}`, () => {
      expectInvalid({ ...valid(), [field]: true }, "unknown_property", `$.${field}`);
    });
  }

  it("mantém autoridade da IA fechada em none", () => {
    expectInvalid({ ...valid(), aiAuthority: "persist_expense" }, "invalid_value", "$.aiAuthority");
  });

  it("rejeita completamente o campo divergente operationalAuthority", () => {
    expectInvalid(
      { ...valid(), operationalAuthority: "none" },
      "unknown_property",
      "$.operationalAuthority",
    );
  });

  it("mantém integração fechada em disconnected", () => {
    expectInvalid(
      { ...valid(), runtimeIntegration: "connected" },
      "invalid_value",
      "$.runtimeIntegration",
    );
  });

  it("rejeita versão S3.1 e categoria fora da união", () => {
    expectInvalid(
      { ...valid(), contractVersion: "p0_3b_s3_1" },
      "invalid_value",
      "$.contractVersion",
    );
    expectInvalid({ ...valid(), category: "Diversos" }, "invalid_value", "$.category");
  });
});

describe("expense semantic occurrence — fechamento adversarial", () => {
  it("rejeita instância de classe e propriedades herdadas", () => {
    class Occurrence {
      contractVersion = "p0_3b_s3_3";
    }
    expectInvalid(new Occurrence(), "invalid_type", "$");
    expectInvalid(Object.create(valid()), "invalid_type", "$");
  });

  it("aceita objeto de prototype null com propriedades próprias de dados", () => {
    const input = Object.assign(Object.create(null), valid());
    expect(validateExpenseSemanticOccurrence(input).valid).toBe(true);
  });

  it("rejeita getter sem executá-lo", () => {
    let executed = false;
    const input = valid() as unknown as Record<string, unknown>;
    Object.defineProperty(input, "description", {
      enumerable: true,
      get() {
        executed = true;
        return "descrição";
      },
    });
    expectInvalid(input, "invalid_type", "$.description");
    expect(executed).toBe(false);
  });

  it("rejeita array esparso, propriedade extra e prototype customizado", () => {
    const sparse = [engineOil, , tires];
    expectInvalid({ ...valid(), concepts: sparse }, "invalid_type", "$.concepts[1]");

    const extra = [engineOil] as unknown as Record<string, unknown>;
    extra.extra = true;
    expectInvalid({ ...valid(), concepts: extra }, "unknown_property", "$.concepts.extra");

    const custom = [engineOil];
    Object.setPrototypeOf(custom, Object.create(Array.prototype));
    expectInvalid({ ...valid(), concepts: custom }, "invalid_type", "$.concepts");
  });

  it("rejeita conceito não plano, getter e relatedItemKeys adulterado", () => {
    expectInvalid(
      { ...valid(), concepts: [Object.create(engineOil)] },
      "invalid_type",
      "$.concepts[0]",
    );

    let executed = false;
    const getterConcept = { ...engineOil } as Record<string, unknown>;
    Object.defineProperty(getterConcept, "conceptKey", {
      enumerable: true,
      get() {
        executed = true;
        return "engine_oil";
      },
    });
    expectInvalid(
      { ...valid(), concepts: [getterConcept] },
      "invalid_type",
      "$.concepts[0].conceptKey",
    );
    expect(executed).toBe(false);

    const customRelated = ["oleo_motor"];
    Object.setPrototypeOf(customRelated, Object.create(Array.prototype));
    expectInvalid(
      { ...valid(), concepts: [{ ...engineOil, relatedItemKeys: customRelated }] },
      "invalid_type",
      "$.concepts[0].relatedItemKeys",
    );
  });
});
