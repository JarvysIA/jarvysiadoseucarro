import { describe, expect, test } from "bun:test";
import {
  validateCollectingMaintenanceExpenseDraft,
  validateExpenseCreateDraft,
} from "../expense-create-draft.ts";
import {
  deriveMaintenanceConversationRepresentation,
  mergeCollectingMaintenanceDraft,
  parseMaintenanceFilterResponse,
  parseMaintenanceItemCorrection,
  parseMaintenanceItemsResponse,
  parseMaintenanceValueResponse,
} from "../expense-maintenance-clarification.ts";
import {
  isMaintenanceItemKey,
  MAINTENANCE_ITEM_KEYS,
  MAINTENANCE_ITEM_LABEL,
  MAINTENANCE_ITEM_TAG,
  type MaintenanceItemKey,
} from "../expense-maintenance-items-parser.ts";
import type { ConversationAwaitingField, ConversationStateName } from "../types.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const VEHICLE_ID = "22222222-2222-4222-9222-222222222222";

const MINIMAL_DRAFT = {
  phase: "collecting_maintenance",
  categoria: "Revisão",
  requestMessageId: REQUEST_ID,
  recognizedTags: [],
  maintenanceItemKeys: [],
  ambiguousFilterMention: false,
} as const;

describe("estado e awaitingField", () => {
  test("aceita awaiting_maintenance_confirmation no contrato TypeScript", () => {
    const state: ConversationStateName = "awaiting_maintenance_confirmation";
    expect(state).toBe("awaiting_maintenance_confirmation");
  });

  test("expõe apenas os novos campos necessários e reutiliza vehicle/confirmation", () => {
    const fields: ConversationAwaitingField[] = [
      "maintenance_items",
      "maintenance_value",
      "maintenance_filter",
      "vehicle",
      "confirmation",
    ];
    expect(fields).toHaveLength(5);
  });
});

describe("collecting_maintenance", () => {
  test("aceita o contrato mínimo sem valor nem veículo", () => {
    expect(validateCollectingMaintenanceExpenseDraft(MINIMAL_DRAFT)).toEqual({
      ok: true,
      value: MINIMAL_DRAFT,
    });
  });

  test.each(["Lavagem", "Combustível", "Seguro"])("rejeita categoria %s", (categoria) => {
    const result = validateCollectingMaintenanceExpenseDraft({ ...MINIMAL_DRAFT, categoria });
    expect(result).toEqual({ ok: false, code: "invalid_categoria" });
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 10.123])(
    "rejeita valor inválido %s",
    (valor) => {
      const result = validateCollectingMaintenanceExpenseDraft({ ...MINIMAL_DRAFT, valor });
      expect(result).toEqual({ ok: false, code: "invalid_valor" });
    },
  );

  test("aceita valor e vehicleId válidos", () => {
    const result = validateCollectingMaintenanceExpenseDraft({
      ...MINIMAL_DRAFT,
      categoria: "Manutenção",
      valor: 250.9,
      vehicleId: VEHICLE_ID,
    });
    expect(result.ok).toBe(true);
  });

  test.each([
    ["vehicleId", "not-uuid", "invalid_vehicle_id"],
    ["requestMessageId", "not-uuid", "invalid_request_message_id"],
  ] as const)("rejeita %s inválido", (field, value, code) => {
    const result = validateCollectingMaintenanceExpenseDraft({
      ...MINIMAL_DRAFT,
      [field]: value,
    });
    expect(result).toEqual({ ok: false, code });
  });

  test("rejeita tags e itemKeys desconhecidos", () => {
    expect(
      validateCollectingMaintenanceExpenseDraft({
        ...MINIMAL_DRAFT,
        recognizedTags: ["bogus"],
      }),
    ).toEqual({ ok: false, code: "invalid_recognized_tags" });
    expect(
      validateCollectingMaintenanceExpenseDraft({
        ...MINIMAL_DRAFT,
        maintenanceItemKeys: ["bogus"],
      }),
    ).toEqual({ ok: false, code: "invalid_maintenance_item_keys" });
  });

  test("rejeita ambiguousFilterMention que não seja boolean real", () => {
    expect(
      validateCollectingMaintenanceExpenseDraft({
        ...MINIMAL_DRAFT,
        ambiguousFilterMention: "false",
      }),
    ).toEqual({ ok: false, code: "invalid_ambiguous_filter_mention" });
  });

  test.each([
    [["oleo_motor", "oleo_motor"], ["oleo"]],
    [["pastilhas_freio", "pastilhas_freio"], ["pastilha"]],
  ] as const)("rejeita itemKeys duplicados %j", (maintenanceItemKeys, recognizedTags) => {
    expect(
      validateCollectingMaintenanceExpenseDraft({
        ...MINIMAL_DRAFT,
        maintenanceItemKeys,
        recognizedTags,
      }),
    ).toEqual({ ok: false, code: "duplicate_maintenance_item_keys" });
  });

  test.each([
    [["oleo_motor"], ["oleo", "oleo"]],
    [["filtro_ar_motor"], ["filtro", "filtro"]],
  ] as const)("rejeita recognizedTags duplicadas %j", (maintenanceItemKeys, recognizedTags) => {
    expect(
      validateCollectingMaintenanceExpenseDraft({
        ...MINIMAL_DRAFT,
        maintenanceItemKeys,
        recognizedTags,
      }),
    ).toEqual({ ok: false, code: "duplicate_recognized_tags" });
  });

  test("preserva ordem canônica, não muta a entrada e destaca os arrays de saída", () => {
    const maintenanceItemKeys: MaintenanceItemKey[] = ["oleo_motor", "filtro_ar_motor"];
    const recognizedTags = ["oleo", "filtro"] as const;
    const input = { ...MINIMAL_DRAFT, maintenanceItemKeys, recognizedTags };
    const result = validateCollectingMaintenanceExpenseDraft(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(maintenanceItemKeys).toEqual(["oleo_motor", "filtro_ar_motor"]);
    expect(recognizedTags).toEqual(["oleo", "filtro"]);
    expect(result.value.maintenanceItemKeys).toEqual(maintenanceItemKeys);
    expect(result.value.recognizedTags).toEqual(recognizedTags);
    expect(result.value.maintenanceItemKeys).not.toBe(maintenanceItemKeys);
    expect(result.value.recognizedTags).not.toBe(recognizedTags);
  });

  test.each([
    [["oleo_motor"], ["oleo"]],
    [
      ["pastilhas_freio", "filtro_ar_motor"],
      ["filtro", "pastilha"],
    ],
    [[], []],
  ] as const)(
    "aceita itemKeys %j somente com tags canônicas %j",
    (maintenanceItemKeys, recognizedTags) => {
      expect(
        validateCollectingMaintenanceExpenseDraft({
          ...MINIMAL_DRAFT,
          maintenanceItemKeys,
          recognizedTags,
          descricaoPreliminar: maintenanceItemKeys.length === 0 ? "revisão completa" : "itens",
        }).ok,
      ).toBe(true);
    },
  );

  test.each([
    [[], ["oleo"]],
    [["pastilhas_freio"], ["oleo"]],
    [["oleo_motor"], []],
    [["oleo_motor"], ["oleo", "filtro"]],
    [
      ["pastilhas_freio", "filtro_ar_motor"],
      ["pastilha", "filtro"],
    ],
  ] as const)(
    "rejeita divergência itemKeys %j / tags %j",
    (maintenanceItemKeys, recognizedTags) => {
      expect(
        validateCollectingMaintenanceExpenseDraft({
          ...MINIMAL_DRAFT,
          maintenanceItemKeys,
          recognizedTags,
        }),
      ).toEqual({ ok: false, code: "recognized_tags_mismatch" });
    },
  );

  test.each(["occurredAt", "date", "data"])("rejeita campo de data %s", (field) => {
    const result = validateCollectingMaintenanceExpenseDraft({
      ...MINIMAL_DRAFT,
      [field]: "2026-07-21",
    });
    expect(result).toEqual({ ok: false, code: "unexpected_field" });
  });

  test("união encaminha a fase nova e mantém fases antigas válidas", () => {
    expect(validateExpenseCreateDraft(MINIMAL_DRAFT).ok).toBe(true);
    expect(
      validateExpenseCreateDraft({
        phase: "awaiting_category",
        valor: 10,
        requestMessageId: REQUEST_ID,
      }).ok,
    ).toBe(true);
    expect(
      validateExpenseCreateDraft({
        phase: "awaiting_vehicle",
        categoria: "Revisão",
        valor: 10,
        requestMessageId: REQUEST_ID,
      }).ok,
    ).toBe(true);
    expect(
      validateExpenseCreateDraft({
        phase: "awaiting_confirmation",
        categoria: "Revisão",
        valor: 10,
        vehicleId: VEHICLE_ID,
        requestMessageId: REQUEST_ID,
      }).ok,
    ).toBe(true);
  });
});

describe("tipo canônico e mapeamentos", () => {
  test("todos os itemKeys têm type guard, tag e label", () => {
    for (const key of MAINTENANCE_ITEM_KEYS) {
      expect(isMaintenanceItemKey(key)).toBe(true);
      expect(MAINTENANCE_ITEM_TAG[key]).toBeString();
      expect(MAINTENANCE_ITEM_LABEL[key].length).toBeGreaterThan(0);
    }
    expect(isMaintenanceItemKey("desconhecido")).toBe(false);
  });
});

describe("parser contextual de valor", () => {
  test.each([
    ["300", 300],
    ["300,50", 300.5],
    ["foi 300", 300],
    ["o valor foi 300", 300],
    ["ficou 300", 300],
    ["custou 300", 300],
    ["gastei 300", 300],
    ["paguei 300", 300],
    ["deu 300", 300],
    ["300 reais", 300],
    ["R$ 300", 300],
  ] as const)("reconhece %s", (text, valor) => {
    expect(parseMaintenanceValueResponse(text, "maintenance_value")).toEqual({ ok: true, valor });
  });

  test.each(["0", "-30", "R$ -30", "sem valor"])("rejeita %s", (text) => {
    expect(parseMaintenanceValueResponse(text, "maintenance_value").ok).toBe(false);
  });

  test.each([
    "rodei 300",
    "rodou 300",
    "está com 300",
    "com 300",
    "revisão de 30 mil",
    "revisão dos 30 mil",
    "revisão de 30000",
    "troquei aos 30000",
    "troquei com 30000",
    "marco de 30 mil",
    "30 mil km",
    "300 km",
    "quilometragem 300",
    "km 300",
    "motor 1.0",
    "óleo 5w30",
  ])("rejeita contexto não monetário sem retornar valor parcial: %s", (text) => {
    const result = parseMaintenanceValueResponse(text, "maintenance_value");
    expect(result.ok).toBe(false);
    expect("valor" in result).toBe(false);
  });

  test("rejeita valor acima do limite contratual", () => {
    expect(parseMaintenanceValueResponse("R$ 1.000.000.000", "maintenance_value")).toEqual({
      ok: false,
      code: "valor_out_of_range",
    });
  });

  test("não classifica fora do contexto nem confunde KM", () => {
    expect(parseMaintenanceValueResponse("300", "maintenance_items")).toEqual({
      ok: false,
      code: "wrong_context",
    });
    expect(parseMaintenanceValueResponse("300 km", "maintenance_value")).toEqual({
      ok: false,
      code: "km_mention",
    });
  });

  test("é determinístico e não mantém estado global", () => {
    const first = parseMaintenanceValueResponse("250,90", "maintenance_value");
    parseMaintenanceValueResponse("999", "maintenance_value");
    expect(parseMaintenanceValueResponse("250,90", "maintenance_value")).toEqual(first);
  });
});

describe("parser contextual de itens", () => {
  test.each([
    ["troquei o óleo", ["oleo_motor", "filtro_oleo"]],
    ["óleo e filtro de óleo", ["oleo_motor", "filtro_oleo"]],
    ["filtro de ar", ["filtro_ar_motor"]],
    ["filtro de cabine", ["filtro_cabine"]],
    ["filtro de combustível", ["filtro_combustivel"]],
    ["pastilha", ["pastilhas_freio"]],
    ["limpeza do arrefecimento", ["aditivo_radiador", "limpeza_arrefecimento"]],
  ] as const)("reconhece %s", (text, itemKeys) => {
    const result = parseMaintenanceItemsResponse(text, "maintenance_items");
    expect(result.status).toBe("recognized");
    expect(result.itemKeys).toEqual(itemKeys);
  });

  test("reconhece múltiplos itens e deriva tags", () => {
    const result = parseMaintenanceItemsResponse(
      "óleo, filtro de cabine, pastilha e radiador",
      "maintenance_items",
    );
    expect(result.itemKeys).toEqual([
      "oleo_motor",
      "filtro_oleo",
      "filtro_cabine",
      "pastilhas_freio",
      "aditivo_radiador",
    ]);
    expect(result.recognizedTags).toEqual(["oleo", "filtro", "pastilha", "arrefecimento"]);
  });

  test("mantém filtro ambíguo inconclusivo", () => {
    const result = parseMaintenanceItemsResponse("troquei o filtro", "maintenance_items");
    expect(result.status).toBe("needs_clarification");
    expect(result.itemKeys).toEqual([]);
    expect(result.ambiguousFilterMention).toBe(true);
  });

  test.each(["revisão completa", "fiz algumas coisas", "manutenção geral"])(
    "não inventa itens para texto genérico: %s",
    (text) => {
      const result = parseMaintenanceItemsResponse(text, "maintenance_items");
      expect(result.status).toBe("needs_clarification");
      expect(result.itemKeys).toEqual([]);
      expect(result.descricaoPreliminar).toBe(text);
    },
  );
});

describe("resolução contextual de filtro", () => {
  test.each([
    ["filtro de óleo", "filtro_oleo"],
    ["filtro de ar", "filtro_ar_motor"],
    ["filtro de cabine", "filtro_cabine"],
    ["filtro de combustível", "filtro_combustivel"],
    ["era o de ar", "filtro_ar_motor"],
    ["só o filtro de óleo", "filtro_oleo"],
  ] as const)("resolve %s exatamente", (text, itemKey) => {
    const result = parseMaintenanceFilterResponse(text, ["pastilhas_freio"], "maintenance_filter");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.itemKey).toBe(itemKey);
    expect(result.itemKeys).toEqual(["pastilhas_freio", itemKey]);
    expect(result.ambiguousFilterMention).toBe(false);
  });

  test.each(["o filtro", "filtro mesmo"])("mantém %s inconclusivo", (text) => {
    const result = parseMaintenanceFilterResponse(text, ["oleo_motor"], "maintenance_filter");
    expect(result).toEqual({
      status: "inconclusive",
      itemKeys: ["oleo_motor"],
      recognizedTags: ["oleo"],
      ambiguousFilterMention: true,
    });
  });
});

describe("merge preservador", () => {
  const complete = {
    ...MINIMAL_DRAFT,
    valor: 300,
    vehicleId: VEHICLE_ID,
    recognizedTags: ["pastilha"] as const,
    maintenanceItemKeys: ["pastilhas_freio"] as const,
    descricaoPreliminar: "pastilhas dianteiras",
  };

  test("atualiza itens, recalcula tags e preserva os demais campos", () => {
    const result = mergeCollectingMaintenanceDraft(complete, {
      maintenanceItemKeys: ["oleo_motor", "filtro_ar_motor"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.valor).toBe(300);
    expect(result.value.vehicleId).toBe(VEHICLE_ID);
    expect(result.value.descricaoPreliminar).toBe("pastilhas dianteiras");
    expect(result.value.categoria).toBe("Revisão");
    expect(result.value.requestMessageId).toBe(REQUEST_ID);
    expect(result.value.maintenanceItemKeys).toEqual(["oleo_motor", "filtro_ar_motor"]);
    expect(result.value.recognizedTags).toEqual(["oleo", "filtro"]);
  });

  test.each([
    ["oleo_motor", "oleo_motor"],
    ["pastilhas_freio", "pastilhas_freio"],
  ] as const)("rejeita patch com itemKeys duplicados %j", (...maintenanceItemKeys) => {
    expect(mergeCollectingMaintenanceDraft(complete, { maintenanceItemKeys })).toEqual({
      ok: false,
      code: "duplicate_maintenance_item_keys",
    });
  });

  test("atualiza valor preservando itens", () => {
    const result = mergeCollectingMaintenanceDraft(complete, { valor: 450 });
    expect(result.ok && result.value.valor).toBe(450);
    expect(result.ok && result.value.maintenanceItemKeys).toEqual(["pastilhas_freio"]);
  });

  test("rejeita patch isolado ou conflitante de recognizedTags", () => {
    expect(mergeCollectingMaintenanceDraft(complete, { recognizedTags: ["oleo"] })).toEqual({
      ok: false,
      code: "invalid_patch",
    });
    expect(
      mergeCollectingMaintenanceDraft(complete, {
        maintenanceItemKeys: ["oleo_motor"],
        recognizedTags: ["pastilha"],
      }),
    ).toEqual({ ok: false, code: "invalid_patch" });
  });

  test("patch de descrição preserva itens e tags", () => {
    const result = mergeCollectingMaintenanceDraft(complete, {
      descricaoPreliminar: "pastilhas traseiras",
    });
    expect(result.ok && result.value.maintenanceItemKeys).toEqual(["pastilhas_freio"]);
    expect(result.ok && result.value.recognizedTags).toEqual(["pastilha"]);
  });

  test("remover todos os itemKeys também remove todas as tags", () => {
    const result = mergeCollectingMaintenanceDraft(complete, { maintenanceItemKeys: [] });
    expect(result.ok && result.value.maintenanceItemKeys).toEqual([]);
    expect(result.ok && result.value.recognizedTags).toEqual([]);
  });

  test.each(["requestMessageId", "categoria", "phase", "occurredAt"])(
    "rejeita patch com campo protegido/desconhecido %s",
    (field) => {
      expect(mergeCollectingMaintenanceDraft(complete, { [field]: "alterado" })).toEqual({
        ok: false,
        code: "invalid_patch",
      });
    },
  );

  test("falha fechado para tags/itemKeys inválidos", () => {
    expect(mergeCollectingMaintenanceDraft(complete, { recognizedTags: ["bogus"] })).toEqual({
      ok: false,
      code: "invalid_patch",
    });
    expect(mergeCollectingMaintenanceDraft(complete, { maintenanceItemKeys: ["bogus"] })).toEqual({
      ok: false,
      code: "invalid_maintenance_item_keys",
    });
  });
});

describe("representação conversacional", () => {
  test("prioriza descrição informada e deduplica tags/labels", () => {
    expect(
      deriveMaintenanceConversationRepresentation({
        descricaoPreliminar: "troquei somente as pastilhas dianteiras",
        maintenanceItemKeys: ["pastilhas_freio", "pastilhas_freio"],
        recognizedTags: ["pastilha", "pastilha"],
      }),
    ).toEqual({
      descricao: "troquei somente as pastilhas dianteiras",
      itemLabels: ["pastilhas de freio"],
      recognizedTags: ["pastilha"],
    });
  });
});

describe("correções puras de item", () => {
  test.each([
    ["foi só óleo", "replace_all"],
    ["não, foi só óleo", "replace_all"],
    ["não. foi só óleo", "replace_all"],
    ["na verdade, foi só óleo", "replace_all"],
    ["era só óleo", "replace_all"],
    ["adiciona pastilha", "add"],
    ["tira a pastilha", "remove"],
  ] as const)("reconhece %s como %s", (text, operation) => {
    const current: MaintenanceItemKey[] = operation === "remove" ? ["pastilhas_freio"] : [];
    const result = parseMaintenanceItemCorrection(text, current);
    expect(result.status).toBe("recognized");
    if (result.status === "recognized") expect(result.operation).toBe(operation);
  });

  test("explicita remoção de item inexistente", () => {
    expect(parseMaintenanceItemCorrection("tira a pastilha", ["oleo_motor"])).toEqual({
      status: "not_applicable",
      operation: "remove",
      itemKeys: ["pastilhas_freio"],
      code: "item_not_present",
    });
  });

  test("mantém frase ambígua inconclusiva", () => {
    expect(parseMaintenanceItemCorrection("acho que foi óleo", [])).toEqual({
      status: "inconclusive",
      code: "ambiguous",
    });
  });

  test.each([
    "não foi só óleo",
    "não era só óleo",
    "não foi apenas óleo",
    "não foi pastilha",
    "não tira a pastilha",
    "não adiciona filtro",
    "não foi só óleo e filtro",
    "não; foi só óleo",
    "não: foi só óleo",
    "não! foi só óleo",
    "não? foi só óleo",
    "não - foi só óleo",
    "não – foi só óleo",
    "não — foi só óleo",
    "não... foi só óleo",
    "não … foi só óleo",
    "não foi só óleo, também filtro",
  ])("mantém negação governante inconclusiva: %s", (text) => {
    expect(parseMaintenanceItemCorrection(text, ["pastilhas_freio"])).toEqual({
      status: "inconclusive",
      code: "ambiguous",
    });
  });
});
