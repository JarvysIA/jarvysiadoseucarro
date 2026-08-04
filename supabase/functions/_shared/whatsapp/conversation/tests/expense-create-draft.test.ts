// Build expense-create-draft — Testes puros dos contratos e validators de
// drafts de criação de despesa. Mirror do estilo de km-update-draft.test.ts.
import { describe, expect, it } from "bun:test";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CREATE_INITIAL_DRAFT_VERSION,
  EXPENSE_CREATE_PROMOTED_ONCE_VERSION,
  EXPENSE_CREATE_PROMOTED_TWICE_VERSION,
  validateAwaitingCategoryExpenseDraft,
  validateAwaitingConfirmationExpenseDraft,
  validateAwaitingVehicleExpenseDraft,
  validateExpenseCreateDraft,
} from "../expense-create-draft.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_V = "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa";

function freeze<T>(o: T): T {
  return Object.freeze(o) as T;
}

// ---------------------------------------------------------------------------
// Constantes de versão
// ---------------------------------------------------------------------------

describe("constantes de versão (persistência, não phase)", () => {
  it("expõe 3 níveis distintos", () => {
    expect(EXPENSE_CREATE_INITIAL_DRAFT_VERSION).toBe(0);
    expect(EXPENSE_CREATE_PROMOTED_ONCE_VERSION).toBe(1);
    expect(EXPENSE_CREATE_PROMOTED_TWICE_VERSION).toBe(2);
  });

  it("são independentes de phase (não aparecem no payload)", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 10,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value).sort()).toEqual([
        "categoria",
        "phase",
        "requestMessageId",
        "valor",
        "vehicleId",
      ]);
    }
  });

  it("expõe EXPENSE_CATEGORIES com as 8 categorias esperadas", () => {
    expect(EXPENSE_CATEGORIES).toEqual([
      "Revisão",
      "Manutenção",
      "Lavagem",
      "Combustível",
      "IPVA",
      "Multas",
      "Seguro",
      "Acessórios",
    ]);
  });
});

// ---------------------------------------------------------------------------
// awaiting_category
// ---------------------------------------------------------------------------

describe("validateAwaitingCategoryExpenseDraft", () => {
  it("aceita objeto válido mínimo", () => {
    const r = validateAwaitingCategoryExpenseDraft({
      phase: "awaiting_category",
      valor: 149.9,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.phase).toBe("awaiting_category");
      expect(r.value.valor).toBe(149.9);
      expect(r.value.requestMessageId).toBe(UUID_A);
    }
  });

  it.each([[0.01], [1], [149.9], [10000], [999999999.99]])(
    "aceita valor válido %p",
    (v: number) => {
      const r = validateAwaitingCategoryExpenseDraft({
        phase: "awaiting_category",
        valor: v,
        requestMessageId: UUID_A,
      });
      expect(r.ok).toBe(true);
    },
  );

  it.each([[null], [[]], ["x"], [1], [true], [new Date()]])(
    "rejeita não-objeto %p",
    (v: unknown) => {
      const r = validateAwaitingCategoryExpenseDraft(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("not_an_object");
    },
  );

  it("rejeita phase ausente", () => {
    const r = validateAwaitingCategoryExpenseDraft({
      valor: 10,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it("rejeita phase inválido", () => {
    const r = validateAwaitingCategoryExpenseDraft({
      phase: "other",
      valor: 10,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_phase");
  });

  it("rejeita valor ausente", () => {
    const r = validateAwaitingCategoryExpenseDraft({
      phase: "awaiting_category",
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["overflow", 1000000000],
    ["fração centavo", 1.234],
    ["NaN", Number.NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["string", "10"],
    ["boolean", true],
    ["null", null],
  ])("rejeita valor %s", (_l: string, v: unknown) => {
    const r = validateAwaitingCategoryExpenseDraft({
      phase: "awaiting_category",
      valor: v as number,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_valor");
  });

  it("rejeita requestMessageId ausente", () => {
    const r = validateAwaitingCategoryExpenseDraft({
      phase: "awaiting_category",
      valor: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it("rejeita requestMessageId inválido", () => {
    const r = validateAwaitingCategoryExpenseDraft({
      phase: "awaiting_category",
      valor: 10,
      requestMessageId: "not-a-uuid",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_request_message_id");
  });

  it("rejeita requestMessageId com espaços", () => {
    const r = validateAwaitingCategoryExpenseDraft({
      phase: "awaiting_category",
      valor: 10,
      requestMessageId: ` ${UUID_A} `,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_request_message_id");
  });

  it.each([
    ["categoria", { categoria: "Revisão" }],
    ["vehicleId", { vehicleId: UUID_V }],
    ["arbitrary", { foo: "bar" }],
  ])("rejeita campo extra %s", (_l: string, extra: Record<string, unknown>) => {
    const r = validateAwaitingCategoryExpenseDraft({
      phase: "awaiting_category",
      valor: 10,
      requestMessageId: UUID_A,
      ...extra,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });

  it("não modifica o input", () => {
    const input = freeze({
      phase: "awaiting_category" as const,
      valor: 42,
      requestMessageId: UUID_A,
    });
    const snap = JSON.stringify(input);
    validateAwaitingCategoryExpenseDraft(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// awaiting_vehicle
// ---------------------------------------------------------------------------

function vehicleBase() {
  return {
    phase: "awaiting_vehicle" as const,
    categoria: "Revisão" as const,
    valor: 100,
    requestMessageId: UUID_A,
  };
}

describe("validateAwaitingVehicleExpenseDraft", () => {
  it("aceita objeto válido", () => {
    const r = validateAwaitingVehicleExpenseDraft(vehicleBase());
    expect(r.ok).toBe(true);
  });

  it.each(EXPENSE_CATEGORIES.map((c) => [c]))("aceita categoria %s", (c: string) => {
    const r = validateAwaitingVehicleExpenseDraft({
      ...vehicleBase(),
      categoria: c,
    });
    expect(r.ok).toBe(true);
  });

  it.each([
    ["vazia", ""],
    ["minúscula", "revisão"],
    ["sem acento", "Revisao"],
    ["desconhecida", "Outros"],
    ["número", 1],
    ["null", null],
  ])("rejeita categoria %s", (_l: string, v: unknown) => {
    const r = validateAwaitingVehicleExpenseDraft({
      ...vehicleBase(),
      categoria: v as string,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_categoria");
  });

  it("rejeita categoria ausente", () => {
    const input: Record<string, unknown> = { ...vehicleBase() };
    delete input.categoria;
    const r = validateAwaitingVehicleExpenseDraft(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it("rejeita valor inválido", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      ...vehicleBase(),
      valor: -1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_valor");
  });

  it("rejeita fração de centavo", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      ...vehicleBase(),
      valor: 1.234,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_valor");
  });

  it("rejeita requestMessageId inválido", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      ...vehicleBase(),
      requestMessageId: "bad",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_request_message_id");
  });

  it("rejeita phase inválido", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      ...vehicleBase(),
      phase: "other" as unknown as "awaiting_vehicle",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_phase");
  });

  it("rejeita vehicleId (não pertence a esta phase)", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      ...vehicleBase(),
      vehicleId: UUID_V,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });

  it("rejeita campo arbitrário", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      ...vehicleBase(),
      foo: "bar",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });

  it("não modifica o input", () => {
    const input = { ...vehicleBase() };
    const snap = JSON.stringify(input);
    validateAwaitingVehicleExpenseDraft(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// awaiting_confirmation
// ---------------------------------------------------------------------------

function confirmationBase() {
  return {
    phase: "awaiting_confirmation" as const,
    categoria: "Manutenção" as const,
    valor: 250.5,
    vehicleId: UUID_B,
    requestMessageId: UUID_A,
  };
}

describe("validateAwaitingConfirmationExpenseDraft", () => {
  it("aceita objeto válido", () => {
    const r = validateAwaitingConfirmationExpenseDraft(confirmationBase());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.vehicleId).toBe(UUID_B);
      expect(r.value.categoria).toBe("Manutenção");
      expect(r.value.valor).toBe(250.5);
    }
  });

  const REQUIRED = ["phase", "categoria", "valor", "vehicleId", "requestMessageId"] as const;

  it.each(REQUIRED)("rejeita campo obrigatório ausente: %s", (field: string) => {
    const input = { ...confirmationBase() } as Record<string, unknown>;
    delete input[field];
    const r = validateAwaitingConfirmationExpenseDraft(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it("rejeita vehicleId inválido", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      ...confirmationBase(),
      vehicleId: "bad",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_vehicle_id");
  });

  it("rejeita categoria inválida", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      ...confirmationBase(),
      categoria: "revisão" as unknown as "Revisão",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_categoria");
  });

  it("rejeita valor inválido", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      ...confirmationBase(),
      valor: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_valor");
  });

  it("rejeita requestMessageId inválido", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      ...confirmationBase(),
      requestMessageId: "bad",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_request_message_id");
  });

  it("rejeita campo extra", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      ...confirmationBase(),
      extra: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });

  it("não modifica o input", () => {
    const input = { ...confirmationBase() };
    const snap = JSON.stringify(input);
    validateAwaitingConfirmationExpenseDraft(input);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// União + objetos híbridos
// ---------------------------------------------------------------------------

describe("validateExpenseCreateDraft (união)", () => {
  it("encaminha awaiting_category", () => {
    const r = validateExpenseCreateDraft({
      phase: "awaiting_category",
      valor: 10,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.phase).toBe("awaiting_category");
  });

  it("encaminha awaiting_vehicle", () => {
    const r = validateExpenseCreateDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 10,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.phase).toBe("awaiting_vehicle");
  });

  it("encaminha awaiting_confirmation", () => {
    const r = validateExpenseCreateDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 10,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.phase).toBe("awaiting_confirmation");
  });

  it("rejeita phase desconhecido", () => {
    const r = validateExpenseCreateDraft({ phase: "other" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_phase");
  });

  it("rejeita phase undefined", () => {
    const r = validateExpenseCreateDraft({ phase: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_phase");
  });

  it("rejeita objeto vazio", () => {
    const r = validateExpenseCreateDraft({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_phase");
  });

  it("erro tem apenas {ok, code}, sem vazar valor recebido", () => {
    const r = validateExpenseCreateDraft({ phase: "bogus", secret: "leak" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r).sort()).toEqual(["code", "ok"]);
  });

  it("não lança para input arbitrário", () => {
    const inputs: unknown[] = [null, undefined, 0, "", [], new Date(), () => 0, Symbol("x")];
    for (const i of inputs) {
      expect(() => validateExpenseCreateDraft(i)).not.toThrow();
    }
  });

  it("determinístico: mesmo input → mesmo resultado", () => {
    const input = {
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 10,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
    };
    const r1 = validateExpenseCreateDraft(input);
    const r2 = validateExpenseCreateDraft(input);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("rejeita objeto híbrido awaiting_category + campos de vehicle", () => {
    const r = validateAwaitingCategoryExpenseDraft({
      phase: "awaiting_category",
      valor: 10,
      requestMessageId: UUID_A,
      categoria: "Revisão",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });

  it("rejeita objeto híbrido awaiting_vehicle + vehicleId", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 10,
      requestMessageId: UUID_A,
      vehicleId: UUID_V,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });

  it("rejeita objeto híbrido awaiting_confirmation sem vehicleId", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 10,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });
});

// ---------------------------------------------------------------------------
// Build 3/9 do item 6 — campos aditivos (recognizedTags / descricao*)
// ---------------------------------------------------------------------------

const LONG_STR_501 = "a".repeat(501);
const LONG_STR_500 = "a".repeat(500);

describe("awaiting_vehicle — campos aditivos (build 3/9 do item 6)", () => {
  it("aceita draft antigo sem os campos novos (regressão)", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("recognizedTags" in r.value).toBe(false);
      expect("descricaoPreliminar" in r.value).toBe(false);
    }
  });

  it("aceita recognizedTags=['oleo','filtro'] + descricaoPreliminar texto", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
      recognizedTags: ["oleo", "filtro"],
      descricaoPreliminar: "troquei oleo e filtro",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.recognizedTags).toEqual(["oleo", "filtro"]);
      expect(r.value.descricaoPreliminar).toBe("troquei oleo e filtro");
    }
  });

  it("aceita recognizedTags=[] + descricaoPreliminar=null", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Manutenção",
      valor: 50,
      requestMessageId: UUID_A,
      recognizedTags: [],
      descricaoPreliminar: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.recognizedTags).toEqual([]);
      expect(r.value.descricaoPreliminar).toBeNull();
    }
  });

  it("aceita descricaoPreliminar com exatamente 500 chars", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
      descricaoPreliminar: LONG_STR_500,
    });
    expect(r.ok).toBe(true);
  });

  it("rejeita recognizedTags com tag desconhecida", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
      recognizedTags: ["oleo", "bogus"] as unknown as string[],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_recognized_tags");
  });

  it("rejeita recognizedTags com duplicata", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
      recognizedTags: ["oleo", "oleo"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_recognized_tags");
  });

  it("rejeita recognizedTags com mais de 4 itens", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
      recognizedTags: ["oleo", "filtro", "pastilha", "arrefecimento", "oleo"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_recognized_tags");
  });

  it("rejeita recognizedTags não-array", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
      recognizedTags: "oleo" as unknown as string[],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_recognized_tags");
  });

  it("rejeita descricaoPreliminar não-string e não-null", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
      descricaoPreliminar: 42 as unknown as string,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_descricao");
  });

  it("rejeita descricaoPreliminar com mais de 500 chars", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
      descricaoPreliminar: LONG_STR_501,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_descricao");
  });

  it("continua rejeitando campo desconhecido como unexpected_field", () => {
    const r = validateAwaitingVehicleExpenseDraft({
      phase: "awaiting_vehicle",
      categoria: "Revisão",
      valor: 100,
      requestMessageId: UUID_A,
      recognizedTags: ["oleo"],
      descricaoPreliminar: "ok",
      foo: "bar",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });
});

describe("awaiting_confirmation — campos aditivos (build 3/9 do item 6)", () => {
  it("aceita draft antigo sem os campos novos (regressão)", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Manutenção",
      valor: 250.5,
      vehicleId: UUID_B,
      requestMessageId: UUID_A,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("recognizedTags" in r.value).toBe(false);
      expect("descricao" in r.value).toBe(false);
    }
  });

  it("aceita recognizedTags=['pastilha'] + descricao texto", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 100,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
      recognizedTags: ["pastilha"],
      descricao: "troquei as pastilhas dianteiras",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.recognizedTags).toEqual(["pastilha"]);
      expect(r.value.descricao).toBe("troquei as pastilhas dianteiras");
    }
  });

  it("aceita descricao=null", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 100,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
      descricao: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.descricao).toBeNull();
  });

  it("aceita descricao com exatamente 500 chars", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 100,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
      descricao: LONG_STR_500,
    });
    expect(r.ok).toBe(true);
  });

  it("rejeita recognizedTags com tag desconhecida", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 100,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
      recognizedTags: ["bogus"] as unknown as string[],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_recognized_tags");
  });

  it("rejeita recognizedTags com duplicata", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 100,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
      recognizedTags: ["filtro", "filtro"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_recognized_tags");
  });

  it("rejeita recognizedTags com mais de 4 itens", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 100,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
      recognizedTags: ["oleo", "filtro", "pastilha", "arrefecimento", "oleo"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_recognized_tags");
  });

  it("rejeita descricao não-string e não-null", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 100,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
      descricao: 42 as unknown as string,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_descricao");
  });

  it("rejeita descricao com mais de 500 chars", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 100,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
      descricao: LONG_STR_501,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_descricao");
  });

  it("continua rejeitando campo desconhecido como unexpected_field", () => {
    const r = validateAwaitingConfirmationExpenseDraft({
      phase: "awaiting_confirmation",
      categoria: "Revisão",
      valor: 100,
      vehicleId: UUID_V,
      requestMessageId: UUID_A,
      recognizedTags: ["oleo"],
      descricao: "ok",
      foo: "bar",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unexpected_field");
  });
});
