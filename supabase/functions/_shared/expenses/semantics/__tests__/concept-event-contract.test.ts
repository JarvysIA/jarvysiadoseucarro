import { describe, expect, it } from "bun:test";
import {
  validateConceptEventOccurrence,
  type ConceptEventOccurrence,
} from "../concept-event-contract.ts";
import {
  EXPENSE_SEMANTIC_ALIASES,
  EXPENSE_SEMANTIC_CONCEPT_REGISTRY,
  findExpenseSemanticConcept,
  isExpenseSemanticItemKey,
} from "../registry.ts";

const noTechnicalEffect = { status: "none", executedItemKeys: [] } as const;
const futureEffect = (
  executedItemKeys: readonly ["oleo_motor" | "filtro_oleo", ...("oleo_motor" | "filtro_oleo")[]],
) => ({
  status: "eligible_for_future_schedule_effect" as const,
  executedItemKeys,
  authorization: "requires_deterministic_engine_validation" as const,
  activation: "not_applied" as const,
});
const purchase = {
  kind: "purchase",
  completion: "completed",
  technicalEffect: noTechnicalEffect,
} as const;
const quote = {
  kind: "quote",
  completion: "proposal_only",
  technicalEffect: noTechnicalEffect,
} as const;
const futureIntent = {
  kind: "future_intent",
  completion: "not_started",
  technicalEffect: noTechnicalEffect,
} as const;
const installation = {
  kind: "installation",
  completion: "confirmed_completed",
  technicalEffect: noTechnicalEffect,
} as const;
const inspection = {
  kind: "completed_inspection",
  completion: "confirmed_completed",
  technicalEffect: noTechnicalEffect,
} as const;
const service = {
  kind: "completed_service",
  serviceKind: "replacement",
  completion: "explicitly_confirmed",
  technicalEffect: futureEffect(["oleo_motor"]),
} as const;
const engineOil = {
  conceptKey: "engine_oil",
  recognitionSource: "deterministic_core",
  relatedItemKeys: ["oleo_motor"],
} as const;
const multimedia = {
  conceptKey: "multimedia_system",
  recognitionSource: "explicit_user_statement",
  relatedItemKeys: [],
} as const;
const present = (declaredAmount = 450) => ({
  status: "present" as const,
  occurrenceCount: 1 as const,
  amount: {
    kind: "single_user_declared_total" as const,
    declaredAmount,
    allocation: "undivided" as const,
  },
});
const valid = (): ConceptEventOccurrence => ({
  contractVersion: "p0_3b_s3_1",
  concepts: [{ concept: engineOil, events: [service] }],
  financialOccurrence: present(),
  aiAuthority: "none",
  runtimeIntegration: "disconnected",
});
const validate = (value: unknown) => validateConceptEventOccurrence(value);
const expectInvalid = (value: unknown, code?: string, path?: string) => {
  const result = validate(value);
  expect(result.valid).toBe(false);
  if (result.valid === false) {
    if (code) expect(result.error.code).toBe(code);
    if (path) expect(result.error.path).toBe(path);
  }
};

describe("concept-event validator — entradas e allowlists", () => {
  it("aceita objeto válido sem mutação", () => {
    const input = valid();
    const snapshot = structuredClone(input);
    const result = validate(input);
    expect(result).toEqual({ valid: true, value: input });
    expect(result.valid && result.value).toBe(input);
    expect(input).toEqual(snapshot);
  });

  const invalidRoots = [
    ["null", null, "invalid_type", "$"],
    ["array", [], "invalid_type", "$"],
    ["propriedade desconhecida", { ...valid(), metadata: {} }, "unknown_property", "$.metadata"],
    [
      "discriminante desconhecido",
      { ...valid(), contractVersion: "p0_3b_s3_2" },
      "invalid_value",
      "$.contractVersion",
    ],
  ] as const;
  for (const [name, input, code, path] of invalidRoots) {
    it(`rejeita ${name}`, () => expectInvalid(input, code, path));
  }

  const approvedConcepts = [
    ["engine_oil", ["oleo_motor"]],
    ["engine_oil_filter", ["filtro_oleo"]],
    ["tires", []],
    ["multimedia_system", []],
    ["transmission_fluid", []],
    ["brake_pads", []],
  ] as const;

  for (const [conceptKey, relatedItemKeys] of approvedConcepts) {
    it(`aceita o conceito canônico ${conceptKey}`, () => {
      const input = valid();
      expect(
        validate({
          ...input,
          concepts: [
            {
              concept: {
                conceptKey,
                recognitionSource: "explicit_user_statement",
                relatedItemKeys,
              },
              events: [service],
            },
          ],
        }).valid,
      ).toBe(true);
    });
  }

  for (const conceptKey of [
    "unknown_concept",
    "generic_revision_service",
    "transmission_filter",
  ] as const) {
    it(`rejeita o conceito não aprovado ${conceptKey}`, () => {
      const input = valid();
      expectInvalid({
        ...input,
        concepts: [{ concept: { ...engineOil, conceptKey }, events: [service] }],
      });
    });
  }

  it("rejeita alias no lugar do conceito canônico", () => {
    const input = valid();
    expectInvalid({
      ...input,
      concepts: [
        {
          concept: { ...engineOil, conceptKey: EXPENSE_SEMANTIC_ALIASES.engineOil[0] },
          events: [service],
        },
      ],
    });
  });

  it("mantém ordem determinística e metadados sem autoridade textual", () => {
    expect(EXPENSE_SEMANTIC_CONCEPT_REGISTRY).toEqual(
      approvedConcepts.map(([conceptKey, relatedItemKeys]) => ({ conceptKey, relatedItemKeys })),
    );
    expect(Object.isFrozen(EXPENSE_SEMANTIC_CONCEPT_REGISTRY)).toBe(true);
    for (const definition of EXPENSE_SEMANTIC_CONCEPT_REGISTRY) {
      expect(Object.keys(definition)).toEqual(["conceptKey", "relatedItemKeys"]);
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.relatedItemKeys)).toBe(true);
    }
    expect(findExpenseSemanticConcept(EXPENSE_SEMANTIC_ALIASES.engineOil[0])).toBeUndefined();
  });

  for (const itemKey of ["oleo_motor", "filtro_oleo"] as const) {
    it(`aceita a item key S3 ${itemKey}`, () => {
      expect(isExpenseSemanticItemKey(itemKey)).toBe(true);
      const input = valid();
      expect(
        validate({
          ...input,
          concepts: [
            {
              ...input.concepts[0],
              events: [
                {
                  ...service,
                  technicalEffect: { ...service.technicalEffect, executedItemKeys: [itemKey] },
                },
              ],
            },
          ],
        }).valid,
      ).toBe(true);
    });
  }

  for (const itemKey of ["inventada", "oleo_cambio_automatico"] as const) {
    it(`rejeita a item key não aprovada ${itemKey}`, () => {
      const input = valid();
      expectInvalid({
        ...input,
        concepts: [
          {
            ...input.concepts[0],
            events: [
              {
                ...service,
                technicalEffect: { ...service.technicalEffect, executedItemKeys: [itemKey] },
              },
            ],
          },
        ],
      });
    });
  }

  it("mantém aiAuthority fechada em none", () => {
    expectInvalid({ ...valid(), aiAuthority: "ai_suggestion" }, "invalid_value", "$.aiAuthority");
  });

  it("mantém runtimeIntegration fechada em disconnected", () => {
    expectInvalid(
      { ...valid(), runtimeIntegration: "whatsapp" },
      "invalid_value",
      "$.runtimeIntegration",
    );
  });
});

describe("concept-event validator — acontecimentos", () => {
  it("rejeita compra com efeito técnico", () => {
    expectInvalid({
      ...valid(),
      concepts: [
        {
          concept: engineOil,
          events: [{ ...purchase, technicalEffect: futureEffect(["oleo_motor"]) }],
        },
      ],
    });
  });

  it("rejeita compra com campo operacional proibido", () => {
    expectInvalid(
      {
        ...valid(),
        concepts: [{ concept: engineOil, events: [{ ...purchase, vehicleId: "v1" }] }],
      },
      "unknown_property",
    );
  });

  const invalidServices = [
    [
      "sem executedItemKeys",
      {
        ...service,
        technicalEffect: {
          status: "eligible_for_future_schedule_effect",
          authorization: "requires_deterministic_engine_validation",
          activation: "not_applied",
        },
      },
    ],
    [
      "com array vazio",
      { ...service, technicalEffect: { ...service.technicalEffect, executedItemKeys: [] } },
    ],
    ["sem confirmação explícita", { ...service, completion: "inferred" }],
    [
      "sem autorização determinística",
      { ...service, technicalEffect: { ...service.technicalEffect, authorization: undefined } },
    ],
    [
      "com autorização da IA",
      {
        ...service,
        technicalEffect: { ...service.technicalEffect, authorization: "ai_suggestion" },
      },
    ],
    [
      "com efeito aplicado",
      { ...service, technicalEffect: { ...service.technicalEffect, activation: "applied" } },
    ],
  ] as const;
  for (const [name, invalidService] of invalidServices) {
    it(`rejeita completed_service ${name}`, () => {
      expectInvalid({ ...valid(), concepts: [{ concept: engineOil, events: [invalidService] }] });
    });
  }

  it("aceita acontecimento técnico válido sem ocorrência financeira", () => {
    const input = { ...valid(), financialOccurrence: { status: "absent", reason: "warranty" } };
    expect(validate(input).valid).toBe(true);
  });
});

describe("concept-event validator — coerência financeira", () => {
  const presentWithoutExpense = [
    ["orçamento isolado", [quote]],
    ["intenção futura isolada", [futureIntent]],
    ["orçamento e intenção futuros exclusivos", [quote, futureIntent]],
  ] as const;
  for (const [name, events] of presentWithoutExpense) {
    it(`rejeita ocorrência presente com ${name}`, () => {
      expectInvalid(
        { ...valid(), concepts: [{ concept: engineOil, events }], financialOccurrence: present() },
        "invalid_financial_coherence",
      );
    });
  }

  it("rejeita completed_service com razão quote_only", () => {
    expectInvalid(
      { ...valid(), financialOccurrence: { status: "absent", reason: "quote_only" } },
      "invalid_financial_coherence",
    );
  });

  it("rejeita compra isolada com razão warranty", () => {
    expectInvalid(
      {
        ...valid(),
        concepts: [{ concept: engineOil, events: [purchase] }],
        financialOccurrence: { status: "absent", reason: "warranty" },
      },
      "invalid_financial_coherence",
    );
  });

  for (const reason of [
    "warranty",
    "free_service",
    "owner_performed",
    "previously_purchased_part",
  ] as const) {
    it(`rejeita completed_service + purchase ausentes por ${reason}`, () => {
      expectInvalid(
        {
          ...valid(),
          concepts: [{ concept: engineOil, events: [service, purchase] }],
          financialOccurrence: { status: "absent", reason },
        },
        "invalid_financial_coherence",
        "$.financialOccurrence.reason",
      );
    });
  }

  it("aceita completed_service + purchase com ocorrencia financeira presente", () => {
    const input = {
      ...valid(),
      concepts: [{ concept: engineOil, events: [service, purchase] }],
    };
    expect(validate(input).valid).toBe(true);
  });

  it("usa um unico snapshot do evento na matriz financeira", () => {
    let snapshots = 0;
    let kindDescriptorReads = 0;
    const event = new Proxy(
      { ...service },
      {
        ownKeys(target) {
          snapshots += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          if (key !== "kind" || descriptor === undefined) return descriptor;
          kindDescriptorReads += 1;
          return { ...descriptor, value: snapshots >= 3 ? "quote" : "completed_service" };
        },
      },
    );
    const input = {
      ...valid(),
      concepts: [{ concept: engineOil, events: [event] }],
      financialOccurrence: { status: "absent", reason: "quote_only" },
    };
    expectInvalid(input, "invalid_financial_coherence", "$.financialOccurrence.reason");
    expect(snapshots).toBe(1);
    expect(kindDescriptorReads).toBe(1);
  });

  const invalidAmounts = [
    ["negativo", -1],
    ["NaN", Number.NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ] as const;
  for (const [name, declaredAmount] of invalidAmounts) {
    it(`rejeita valor ${name}`, () =>
      expectInvalid({ ...valid(), financialOccurrence: present(declaredAmount) }));
  }

  it("rejeita ocorrência ausente carregando valor", () => {
    expectInvalid(
      {
        ...valid(),
        financialOccurrence: { status: "absent", reason: "warranty", amount: present().amount },
      },
      "unknown_property",
    );
  });

  it("rejeita ocorrência presente carregando razão de ausência", () => {
    expectInvalid(
      { ...valid(), financialOccurrence: { ...present(), reason: "warranty" } },
      "unknown_property",
    );
  });

  it("rejeita occurrenceCount diferente de 1", () =>
    expectInvalid({ ...valid(), financialOccurrence: { ...present(), occurrenceCount: 2 } }));
  it("rejeita allocation diferente de undivided", () =>
    expectInvalid({
      ...valid(),
      financialOccurrence: {
        ...present(),
        amount: { ...present().amount, allocation: "split_by_concept" },
      },
    }));
  it("rejeita tentativa de rateio", () =>
    expectInvalid(
      { ...valid(), financialOccurrence: { ...present(), conceptAllocations: [{ amount: 10 }] } },
      "unknown_property",
    ));
});

describe("concept-event validator — preservação semântica", () => {
  it("aceita orçamento isolado somente com ausência quote_only", () => {
    const input = {
      ...valid(),
      concepts: [{ concept: engineOil, events: [quote] }],
      financialOccurrence: { status: "absent", reason: "quote_only" },
    };
    expect(validate(input).valid).toBe(true);
  });

  it("aceita intenção futura isolada somente com ausência future_intent_only", () => {
    const input = {
      ...valid(),
      concepts: [{ concept: engineOil, events: [futureIntent] }],
      financialOccurrence: { status: "absent", reason: "future_intent_only" },
    };
    expect(validate(input).valid).toBe(true);
  });

  it("preserva inspeção concluída sem convertê-la em substituição", () => {
    const inspection = {
      kind: "completed_inspection",
      completion: "confirmed_completed",
      technicalEffect: noTechnicalEffect,
    } as const;
    const input = {
      ...valid(),
      concepts: [{ concept: engineOil, events: [inspection] }],
      financialOccurrence: { status: "absent", reason: "no_completed_expense" },
    };
    const result = validate(input);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.concepts[0].events[0]).toEqual(inspection);
  });

  it("preserva múltiplos conceitos, compra e instalação e total único", () => {
    const input = {
      ...valid(),
      concepts: [
        { concept: engineOil, events: [purchase, service] },
        {
          concept: multimedia,
          events: [
            purchase,
            {
              kind: "installation",
              completion: "confirmed_completed",
              technicalEffect: noTechnicalEffect,
            },
          ],
        },
      ],
      financialOccurrence: present(2200),
    };
    const result = validate(input);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.concepts).toHaveLength(2);
      expect(result.value.financialOccurrence).toEqual(present(2200));
    }
  });

  it("aceita relato misto com orçamento e acontecimento financeiro real", () => {
    const input = {
      ...valid(),
      concepts: [{ concept: engineOil, events: [purchase, quote, futureIntent] }],
      financialOccurrence: present(280),
    };
    expect(validate(input).valid).toBe(true);
  });

  it("mantém relatedItemKeys distinto de executedItemKeys", () => {
    const input = {
      ...valid(),
      concepts: [
        {
          concept: engineOil,
          events: [{ ...service, technicalEffect: futureEffect(["filtro_oleo"]) }],
        },
      ],
    };
    const result = validate(input);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.concepts[0].concept.relatedItemKeys).toEqual(["oleo_motor"]);
      expect(result.value.concepts[0].events[0].technicalEffect.executedItemKeys).toEqual([
        "filtro_oleo",
      ]);
    }
  });
});

describe("concept-event validator - fechamento adversarial de objetos", () => {
  it("rejeita raiz criada por Object.create(validContract)", () => {
    expectInvalid(Object.create(valid()), "invalid_type", "$");
  });

  it("rejeita raiz com campos obrigatorios herdados", () => {
    const input = Object.create(valid()) as object;
    Object.defineProperty(input, "aiAuthority", { value: "none", enumerable: true });
    expectInvalid(input, "invalid_type", "$");
  });

  const inheritedNestedCases = [
    [
      "conceito",
      () => ({
        ...valid(),
        concepts: [{ concept: Object.create(engineOil), events: [service] }],
      }),
      "$.concepts[0].concept",
    ],
    [
      "acontecimento",
      () => ({
        ...valid(),
        concepts: [{ concept: engineOil, events: [Object.create(service)] }],
      }),
      "$.concepts[0].events[0]",
    ],
    [
      "technicalEffect",
      () => ({
        ...valid(),
        concepts: [
          {
            concept: engineOil,
            events: [{ ...service, technicalEffect: Object.create(service.technicalEffect) }],
          },
        ],
      }),
      "$.concepts[0].events[0].technicalEffect",
    ],
    [
      "financialOccurrence",
      () => ({ ...valid(), financialOccurrence: Object.create(present()) }),
      "$.financialOccurrence",
    ],
    [
      "amount",
      () => ({
        ...valid(),
        financialOccurrence: { ...present(), amount: Object.create(present().amount) },
      }),
      "$.financialOccurrence.amount",
    ],
  ] as const;
  for (const [name, makeInput, path] of inheritedNestedCases) {
    it(`rejeita ${name} com campos obrigatorios herdados`, () => {
      expectInvalid(makeInput(), "invalid_type", path);
    });
  }

  it("nao confia em valid herdado por tentativa de pollution", () => {
    const input = Object.create({ valid: true }) as Record<string, unknown>;
    Object.assign(input, valid());
    expectInvalid(input, "invalid_type", "$");
  });

  it("nao confunde Object.prototype.valid com resultado de validacao", () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "valid");
    Object.defineProperty(Object.prototype, "valid", { value: true, configurable: true });
    try {
      expect(validate(valid()).valid).toBe(true);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(Object.prototype, "valid");
      else Object.defineProperty(Object.prototype, "valid", previous);
    }
  });

  it("rejeita instancia de classe com aparencia compativel", () => {
    class ContractLike {
      contractVersion = "p0_3b_s3_1";
      concepts = valid().concepts;
      financialOccurrence = valid().financialOccurrence;
      aiAuthority = "none";
      runtimeIntegration = "disconnected";
    }
    expectInvalid(new ContractLike(), "invalid_type", "$");
  });

  it("aceita raiz de prototype null com propriedades proprias de dados", () => {
    const input = Object.assign(Object.create(null) as Record<string, unknown>, valid());
    const result = validate(input);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toBe(input);
  });

  it("rejeita propriedade desconhecida nao enumeravel", () => {
    const input = valid();
    Object.defineProperty(input, "secret", { value: true, enumerable: false });
    expectInvalid(input, "unknown_property", "$.secret");
  });

  it("rejeita symbol proprio desconhecido", () => {
    const input = valid();
    Object.defineProperty(input, Symbol("secret"), { value: true });
    expectInvalid(input, "unknown_property", "$");
  });

  it("rejeita getter que lanca na raiz sem executa-lo", () => {
    const input = valid();
    let calls = 0;
    Object.defineProperty(input, "contractVersion", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("getter executado");
      },
    });
    expectInvalid(input, "invalid_type", "$.contractVersion");
    expect(calls).toBe(0);
  });

  it("rejeita getter que lanca em objeto aninhado sem executa-lo", () => {
    const technicalEffect = { ...service.technicalEffect };
    let calls = 0;
    Object.defineProperty(technicalEffect, "authorization", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("getter executado");
      },
    });
    expectInvalid(
      {
        ...valid(),
        concepts: [{ concept: engineOil, events: [{ ...service, technicalEffect }] }],
      },
      "invalid_type",
      "$.concepts[0].events[0].technicalEffect.authorization",
    );
    expect(calls).toBe(0);
  });

  it("rejeita setter/accessor em campo permitido", () => {
    const input = valid();
    Object.defineProperty(input, "aiAuthority", { enumerable: true, set() {} });
    expectInvalid(input, "invalid_type", "$.aiAuthority");
  });

  const expectContainedIntrospectionFailure = (value: unknown, path: string, token: string) => {
    const result = validate(value);
    expect(result).toEqual({ valid: false, error: { code: "invalid_type", path } });
    expect(JSON.stringify(result)).not.toContain(token);
  };

  it("contem excecao de getPrototypeOf de Proxy no path correspondente", () => {
    const token = "hostile-getPrototypeOf-message-and-stack";
    const proxy = new Proxy(valid(), {
      getPrototypeOf() {
        throw new Error(token);
      },
    });
    expectContainedIntrospectionFailure(proxy, "$", token);
  });

  it("contem excecao de ownKeys de Proxy no path correspondente", () => {
    const token = "hostile-ownKeys-message-and-stack";
    const proxy = new Proxy(valid(), {
      ownKeys() {
        throw new Error(token);
      },
    });
    expectContainedIntrospectionFailure(proxy, "$", token);
  });

  it("contem excecao de getOwnPropertyDescriptor de Proxy no path correspondente", () => {
    const token = "hostile-getOwnPropertyDescriptor-message-and-stack";
    const proxy = new Proxy(valid(), {
      getOwnPropertyDescriptor() {
        throw new Error(token);
      },
    });
    expectContainedIntrospectionFailure(proxy, "$", token);
  });

  it("usa primordial capturado e nao mascara monkeypatch global posterior", () => {
    const original = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf");
    Object.defineProperty(Object, "getPrototypeOf", {
      configurable: true,
      value() {
        throw new Error("falha artificial interna posterior a importacao");
      },
      writable: true,
    });
    try {
      const input = valid();
      const result = validate(input);
      expect(result).toEqual({ valid: true, value: input });
    } finally {
      if (original !== undefined) Object.defineProperty(Object, "getPrototypeOf", original);
    }
  });

  it("nao converte falha interna fora da introspeccao em invalid_type na raiz", () => {
    const original = Object.getOwnPropertyDescriptor(Array.prototype, "includes");
    const sentinel = new Error("falha interna sentinela");
    let caught: unknown;
    Object.defineProperty(Array.prototype, "includes", {
      configurable: true,
      value() {
        throw sentinel;
      },
      writable: true,
    });
    try {
      validate({ ...valid(), financialOccurrence: { status: "absent", reason: "warranty" } });
    } catch (error) {
      caught = error;
    } finally {
      if (original !== undefined) Object.defineProperty(Array.prototype, "includes", original);
    }
    expect(caught).toBe(sentinel);
  });
});

describe("concept-event validator - fechamento adversarial de arrays", () => {
  const withEvents = (events: unknown) => ({
    ...valid(),
    concepts: [{ concept: engineOil, events }],
  });

  it("rejeita relatedItemKeys esparso", () => {
    const relatedItemKeys = Array(1);
    expectInvalid(
      {
        ...valid(),
        concepts: [{ concept: { ...engineOil, relatedItemKeys }, events: [service] }],
      },
      "invalid_type",
      "$.concepts[0].concept.relatedItemKeys[0]",
    );
  });

  it("rejeita executedItemKeys esparso", () => {
    const executedItemKeys = Array(1);
    expectInvalid(
      withEvents([
        { ...service, technicalEffect: { ...service.technicalEffect, executedItemKeys } },
      ]),
      "invalid_type",
      "$.concepts[0].events[0].technicalEffect.executedItemKeys[0]",
    );
  });

  it("rejeita concepts esparso", () => {
    expectInvalid({ ...valid(), concepts: Array(1) }, "invalid_type", "$.concepts[0]");
  });

  it("rejeita events esparso", () => {
    expectInvalid(withEvents(Array(1)), "invalid_type", "$.concepts[0].events[0]");
  });

  it("rejeita array tornado esparso por delete", () => {
    const events: Array<typeof service | undefined> = [service];
    delete events[0];
    expectInvalid(withEvents(events), "invalid_type", "$.concepts[0].events[0]");
  });

  it("rejeita slot ausente suprido pelo prototype do array", () => {
    const events = Array(1);
    Object.setPrototypeOf(events, { 0: service });
    expectInvalid(withEvents(events), "invalid_type", "$.concepts[0].events[0]");
  });

  it("rejeita getter em indice sem executa-lo", () => {
    const events = [service];
    let calls = 0;
    Object.defineProperty(events, "0", {
      enumerable: true,
      get() {
        calls += 1;
        return service;
      },
    });
    expectInvalid(withEvents(events), "invalid_type", "$.concepts[0].events[0]");
    expect(calls).toBe(0);
  });

  it("rejeita propriedade extra em array", () => {
    const events = [service];
    Object.defineProperty(events, "extra", { value: true });
    expectInvalid(withEvents(events), "unknown_property", "$.concepts[0].events.extra");
  });

  it("rejeita symbol proprio em array", () => {
    const events = [service];
    Object.defineProperty(events, Symbol("extra"), { value: true });
    expectInvalid(withEvents(events), "unknown_property", "$.concepts[0].events");
  });

  const prototypeCases = [
    [
      "concepts",
      "$.concepts",
      (prototype: object | null) => {
        const concepts = [{ concept: engineOil, events: [service] }];
        Object.setPrototypeOf(concepts, prototype);
        return { ...valid(), concepts };
      },
    ],
    [
      "events",
      "$.concepts[0].events",
      (prototype: object | null) => {
        const events = [service];
        Object.setPrototypeOf(events, prototype);
        return { ...valid(), concepts: [{ concept: engineOil, events }] };
      },
    ],
    [
      "relatedItemKeys",
      "$.concepts[0].concept.relatedItemKeys",
      (prototype: object | null) => {
        const relatedItemKeys = ["oleo_motor"];
        Object.setPrototypeOf(relatedItemKeys, prototype);
        return {
          ...valid(),
          concepts: [{ concept: { ...engineOil, relatedItemKeys }, events: [service] }],
        };
      },
    ],
    [
      "executedItemKeys",
      "$.concepts[0].events[0].technicalEffect.executedItemKeys",
      (prototype: object | null) => {
        const executedItemKeys = ["oleo_motor"];
        Object.setPrototypeOf(executedItemKeys, prototype);
        return withEvents([
          { ...service, technicalEffect: { ...service.technicalEffect, executedItemKeys } },
        ]);
      },
    ],
  ] as const;

  for (const [name, path, makeInput] of prototypeCases) {
    it(`aceita ${name} com Array.prototype exato`, () => {
      expect(validate(makeInput(Array.prototype)).valid).toBe(true);
    });

    it(`rejeita ${name} com prototype customizado e slots proprios validos`, () => {
      expectInvalid(makeInput(Object.create(Array.prototype)), "invalid_type", path);
    });

    it(`rejeita ${name} com prototype null e slots proprios validos`, () => {
      expectInvalid(makeInput(null), "invalid_type", path);
    });
  }
});

describe("concept-event validator - hardening dos acontecimentos", () => {
  it("rejeita installation com efeito tecnico futuro", () => {
    expectInvalid(
      {
        ...valid(),
        concepts: [
          {
            concept: engineOil,
            events: [{ ...installation, technicalEffect: futureEffect(["oleo_motor"]) }],
          },
        ],
      },
      "invalid_value",
      "$.concepts[0].events[0].technicalEffect.status",
    );
  });

  it("rejeita completed_inspection representando replacement", () => {
    expectInvalid(
      {
        ...valid(),
        concepts: [{ concept: engineOil, events: [{ ...inspection, serviceKind: "replacement" }] }],
      },
      "unknown_property",
      "$.concepts[0].events[0].serviceKind",
    );
  });

  it("rejeita kind desconhecido", () => {
    expectInvalid(
      {
        ...valid(),
        concepts: [{ concept: engineOil, events: [{ ...purchase, kind: "payment" }] }],
      },
      "invalid_value",
      "$.concepts[0].events[0].kind",
    );
  });
});

describe("concept-event validator - matriz no_completed_expense", () => {
  const contract = (events: readonly unknown[], reason: string) => ({
    ...valid(),
    concepts: [{ concept: engineOil, events }],
    financialOccurrence: { status: "absent", reason },
  });
  const rejected = [
    ["purchase isolada", [purchase]],
    ["purchase em combinacao", [purchase, quote]],
    ["installation isolada", [installation]],
    ["completed_service", [service]],
    ["quote isolado", [quote]],
    ["future_intent isolado", [futureIntent]],
    ["outra combinacao", [inspection, quote]],
  ] as const;
  for (const [name, events] of rejected) {
    it(`rejeita ${name} com no_completed_expense`, () => {
      expectInvalid(
        contract(events, "no_completed_expense"),
        "invalid_financial_coherence",
        "$.financialOccurrence.reason",
      );
    });
  }

  it("aceita quote isolado somente com quote_only", () => {
    expect(validate(contract([quote], "quote_only")).valid).toBe(true);
  });
  it("aceita future_intent isolado somente com future_intent_only", () => {
    expect(validate(contract([futureIntent], "future_intent_only")).valid).toBe(true);
  });
  it("aceita quote + future_intent exclusivos com no_completed_expense", () => {
    expect(validate(contract([quote, futureIntent], "no_completed_expense")).valid).toBe(true);
  });
  it("aceita completed_inspection isolada com no_completed_expense", () => {
    expect(validate(contract([inspection], "no_completed_expense")).valid).toBe(true);
  });

  for (const reason of [
    "warranty",
    "free_service",
    "owner_performed",
    "previously_purchased_part",
  ] as const) {
    it(`preserva razao especifica ${reason} para completed_service`, () => {
      expect(validate(contract([service], reason)).valid).toBe(true);
    });
  }

  it("mantem purchase concluida valida exigindo ocorrencia financeira presente", () => {
    expect(
      validate({ ...valid(), concepts: [{ concept: engineOil, events: [purchase] }] }).valid,
    ).toBe(true);
  });
});
