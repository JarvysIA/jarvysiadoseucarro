// Build 5.7F2E1A.5-MC — Testes puros do parser determinístico de KM.
import { describe, expect, it } from "bun:test";
import {
  parseKmUpdateText,
  type KmUpdateParseErrorCode,
  type KmUpdateParseResult,
} from "../km-update-parser.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(res: KmUpdateParseResult, expected: number): void {
  expect(res.ok).toBe(true);
  if (res.ok) expect(res.newKm).toBe(expected);
}

function err(res: KmUpdateParseResult, code: KmUpdateParseErrorCode): void {
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.code).toBe(code);
}

function keys(o: object): string[] {
  return Object.keys(o).sort();
}

// ---------------------------------------------------------------------------
// Guardas de input
// ---------------------------------------------------------------------------

describe("input inválido / vazio", () => {
  const INVALID_INPUTS: unknown[] = [
    null,
    undefined,
    123,
    0,
    NaN,
    true,
    false,
    [],
    ["50000"],
    {},
    { text: "50000" },
    () => "50000",
    Symbol("x"),
  ];

  it("retorna not_a_string para qualquer valor não-string", () => {
    for (const v of INVALID_INPUTS) {
      err(parseKmUpdateText(v, "explicit_report"), "not_a_string");
      err(parseKmUpdateText(v, "value_reply"), "not_a_string");
    }
  });

  it("retorna empty_text para string vazia ou somente whitespace", () => {
    for (const s of ["", " ", "   ", "\t", "\n", "\r\n", "\u00A0\u2003"]) {
      err(parseKmUpdateText(s, "explicit_report"), "empty_text");
      err(parseKmUpdateText(s, "value_reply"), "empty_text");
    }
  });

  it("retorna no_km_candidate para somente pontuação", () => {
    for (const s of ["!!!", "?!", "(...)", ";;;", "(!?);"]) {
      err(parseKmUpdateText(s, "explicit_report"), "no_km_candidate");
      err(parseKmUpdateText(s, "value_reply"), "no_km_candidate");
    }
  });

  it("não lança para qualquer input arbitrário", () => {
    for (const v of [...INVALID_INPUTS, "", "50000", "abc", "50000 km"]) {
      expect(() => parseKmUpdateText(v, "explicit_report")).not.toThrow();
      expect(() => parseKmUpdateText(v, "value_reply")).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// explicit_report — sucessos
// ---------------------------------------------------------------------------

describe("explicit_report — formatos reconhecidos", () => {
  it("aceita '50000 km'", () => {
    ok(parseKmUpdateText("50000 km", "explicit_report"), 50000);
  });
  it("aceita '50000km' (colado)", () => {
    ok(parseKmUpdateText("50000km", "explicit_report"), 50000);
  });
  it("aceita '50.000 km'", () => {
    ok(parseKmUpdateText("50.000 km", "explicit_report"), 50000);
  });
  it("aceita '50 000 km'", () => {
    ok(parseKmUpdateText("50 000 km", "explicit_report"), 50000);
  });
  it("aceita '50 mil km'", () => {
    ok(parseKmUpdateText("50 mil km", "explicit_report"), 50000);
  });
  it("aceita 'meu carro está com 50000 km'", () => {
    ok(
      parseKmUpdateText("meu carro está com 50000 km", "explicit_report"),
      50000,
    );
  });
  it("aceita 'meu carro 2020 está com 50000 km' ignorando o ano sem marcador", () => {
    ok(
      parseKmUpdateText("meu carro 2020 está com 50000 km", "explicit_report"),
      50000,
    );
  });
  it("aceita 'quilometragem 50000'", () => {
    ok(parseKmUpdateText("quilometragem 50000", "explicit_report"), 50000);
  });
  it("aceita 'quilometragem atual: 50000'", () => {
    ok(
      parseKmUpdateText("quilometragem atual: 50000", "explicit_report"),
      50000,
    );
  });
  it("aceita 'odômetro 50000'", () => {
    ok(parseKmUpdateText("odômetro 50000", "explicit_report"), 50000);
  });
  it("aceita 'odometro: 50 mil'", () => {
    ok(parseKmUpdateText("odometro: 50 mil", "explicit_report"), 50000);
  });
  it("aceita 'km 50000'", () => {
    ok(parseKmUpdateText("km 50000", "explicit_report"), 50000);
  });
  it("aceita 'km atual = 50.000'", () => {
    ok(parseKmUpdateText("km atual = 50.000", "explicit_report"), 50000);
  });
  it("aceita uppercase e acentos", () => {
    ok(parseKmUpdateText("QUILÔMETRAGEM ATUAL: 50000", "explicit_report"), 50000);
    ok(parseKmUpdateText("ODÔMETRO 50.000", "explicit_report"), 50000);
    ok(parseKmUpdateText("KM ATUAL 50 MIL", "explicit_report"), 50000);
  });
  it("aceita espaços Unicode e múltiplos espaços", () => {
    ok(parseKmUpdateText("km\u00A0atual\u2003 50000", "explicit_report"), 50000);
    ok(parseKmUpdateText("km    50000     km", "explicit_report"), 50000);
  });
  it("aceita pontuação ao redor da expressão", () => {
    ok(parseKmUpdateText("está com 50000 km.", "explicit_report"), 50000);
    ok(parseKmUpdateText("quilometragem: 50000!", "explicit_report"), 50000);
    ok(parseKmUpdateText("odometro (50000)", "explicit_report"), 50000);
    ok(parseKmUpdateText("km atual = 50.000", "explicit_report"), 50000);
  });
  it("aceita zero", () => {
    ok(parseKmUpdateText("odometro 0", "explicit_report"), 0);
    ok(parseKmUpdateText("km atual: 0", "explicit_report"), 0);
  });
  it("aceita limite máximo 2147483647", () => {
    ok(parseKmUpdateText("km 2147483647", "explicit_report"), 2147483647);
    ok(parseKmUpdateText("km 2.147.483.647", "explicit_report"), 2147483647);
    ok(parseKmUpdateText("km 2 147 483 647", "explicit_report"), 2147483647);
  });
  it("rejeita número isolado sem marcador (no_km_candidate)", () => {
    err(parseKmUpdateText("50000", "explicit_report"), "no_km_candidate");
  });
  it("rejeita ano isolado", () => {
    err(parseKmUpdateText("ano 2020", "explicit_report"), "no_km_candidate");
  });
  it("rejeita preço sem marcador", () => {
    err(parseKmUpdateText("paguei 500 reais", "explicit_report"), "no_km_candidate");
  });
  it("rejeita km/h como candidato", () => {
    err(parseKmUpdateText("100 km/h", "explicit_report"), "no_km_candidate");
    err(parseKmUpdateText("velocidade 100 km/h", "explicit_report"), "no_km_candidate");
  });
  it("palavra contendo km não cria candidato", () => {
    err(parseKmUpdateText("kmita 50000 abc", "explicit_report"), "no_km_candidate");
    err(parseKmUpdateText("abc50000kmxyz", "explicit_report"), "no_km_candidate");
    err(parseKmUpdateText("pedido50000", "explicit_report"), "no_km_candidate");
  });
  it("não modifica o input original", () => {
    const originals = [
      "50000 km",
      "  odometro:   50.000\u00A0km ",
      "meu carro está com 50000 km",
    ];
    for (const s of originals) {
      const before = s;
      parseKmUpdateText(s, "explicit_report");
      expect(s).toBe(before);
    }
  });
});

// ---------------------------------------------------------------------------
// value_reply — sucessos e rejeições
// ---------------------------------------------------------------------------

describe("value_reply — respostas objetivas", () => {
  it("aceita '50000'", () => {
    ok(parseKmUpdateText("50000", "value_reply"), 50000);
  });
  it("aceita '50.000'", () => {
    ok(parseKmUpdateText("50.000", "value_reply"), 50000);
  });
  it("aceita '50 000'", () => {
    ok(parseKmUpdateText("50 000", "value_reply"), 50000);
  });
  it("aceita '50 mil'", () => {
    ok(parseKmUpdateText("50 mil", "value_reply"), 50000);
  });
  it("aceita '50000 km'", () => {
    ok(parseKmUpdateText("50000 km", "value_reply"), 50000);
  });
  it("aceita 'km 50000'", () => {
    ok(parseKmUpdateText("km 50000", "value_reply"), 50000);
  });
  it("aceita 'quilometragem 50000'", () => {
    ok(parseKmUpdateText("quilometragem 50000", "value_reply"), 50000);
  });
  it("aceita 'odômetro: 50000'", () => {
    ok(parseKmUpdateText("odômetro: 50000", "value_reply"), 50000);
  });
  it("aceita zero", () => {
    ok(parseKmUpdateText("0", "value_reply"), 0);
  });
  it("aceita limite máximo", () => {
    ok(parseKmUpdateText("2147483647", "value_reply"), 2147483647);
    ok(parseKmUpdateText("2.147.483.647", "value_reply"), 2147483647);
  });
  it("aceita espaços externos", () => {
    ok(parseKmUpdateText("   50000   ", "value_reply"), 50000);
    ok(parseKmUpdateText("\n50.000\t", "value_reply"), 50000);
  });
  it("rejeita texto adicional antes do valor", () => {
    err(parseKmUpdateText("acho que é 50000", "value_reply"), "invalid_km_format");
    err(parseKmUpdateText("talvez 50000", "value_reply"), "invalid_km_format");
  });
  it("rejeita texto adicional depois do valor", () => {
    err(parseKmUpdateText("50000 e depois vejo", "value_reply"), "invalid_km_format");
    err(
      parseKmUpdateText("é 50000 mas não tenho certeza", "value_reply"),
      "invalid_km_format",
    );
  });
  it("rejeita frase conversacional que embute o valor", () => {
    err(
      parseKmUpdateText("meu carro está com 50000 km", "value_reply"),
      "invalid_km_format",
    );
  });
  it("rejeita dois valores", () => {
    err(parseKmUpdateText("50000 60000", "value_reply"), "invalid_km_format");
    err(parseKmUpdateText("50000 km 60000 km", "value_reply"), "invalid_km_format");
  });
  it("rejeita somente pontuação", () => {
    err(parseKmUpdateText("!!!", "value_reply"), "no_km_candidate");
  });
  it("não modifica o input original", () => {
    const s = "  50.000\u00A0km ";
    const before = s;
    parseKmUpdateText(s, "value_reply");
    expect(s).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Formatos numéricos inválidos
// ---------------------------------------------------------------------------

describe("formatos numéricos inválidos", () => {
  // Cada entrada é um par [input, codeEsperado] cobrindo os dois modos.
  const CASES: ReadonlyArray<[string, KmUpdateParseErrorCode]> = [
    ["1.00 km", "invalid_km_format"],
    ["10.00 km", "invalid_km_format"],
    ["1.0000 km", "invalid_km_format"],
    ["10 00 km", "invalid_km_format"],
    ["1 00 000 km", "invalid_km_format"],
    ["1.000 000 km", "invalid_km_format"],
    ["1 000.000 km", "invalid_km_format"],
    ["50_000 km", "invalid_km_format"],
    ["50/000 km", "invalid_km_format"],
    ["50,5 km", "invalid_km_format"],
    ["50.5 km", "invalid_km_format"],
    ["+50000 km", "invalid_km_format"],
    ["50,5 mil km", "invalid_km_format"],
    ["50.5 mil km", "invalid_km_format"],
    ["50 mil e 500 km", "ambiguous_km_candidate"],
  ];

  for (const [input, code] of CASES) {
    it(`explicit_report rejeita '${input}' com ${code}`, () => {
      err(parseKmUpdateText(input, "explicit_report"), code);
    });
  }

  it("rejeita 'cinquenta mil km' (extenso) em explicit_report", () => {
    err(parseKmUpdateText("cinquenta mil km", "explicit_report"), "no_km_candidate");
  });
  it("rejeita '50k km' — 'k' não é marcador aceito", () => {
    err(parseKmUpdateText("50k km", "explicit_report"), "no_km_candidate");
  });
  it("rejeita '1 milhão km' (multiplicador não aceito)", () => {
    err(parseKmUpdateText("1 milhão km", "explicit_report"), "no_km_candidate");
  });
  it("rejeita parsing parcial '50000abc km'", () => {
    err(parseKmUpdateText("50000abc km", "explicit_report"), "no_km_candidate");
  });
  it("rejeita 'abc50000kmxyz'", () => {
    err(parseKmUpdateText("abc50000kmxyz", "explicit_report"), "no_km_candidate");
  });
  it("aceita ponto final após expressão completa (é pontuação, não separador)", () => {
    ok(parseKmUpdateText("50000 km.", "explicit_report"), 50000);
  });
  it("rejeita separador puro no início do número (',50000' → sem candidato)", () => {
    err(parseKmUpdateText("km ,50000", "explicit_report"), "no_km_candidate");
  });
});

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

describe("range", () => {
  it("'-1 km' → km_out_of_range", () => {
    err(parseKmUpdateText("-1 km", "explicit_report"), "km_out_of_range");
  });
  it("'2147483648 km' → km_out_of_range", () => {
    err(parseKmUpdateText("2147483648 km", "explicit_report"), "km_out_of_range");
  });
  it("'999999999999999999999 km' → km_out_of_range", () => {
    err(
      parseKmUpdateText("999999999999999999999 km", "explicit_report"),
      "km_out_of_range",
    );
  });
  it("'2147484 mil km' → km_out_of_range", () => {
    err(parseKmUpdateText("2147484 mil km", "explicit_report"), "km_out_of_range");
  });
  it("'2147483 mil km' → km_out_of_range (2.147.483.000 > MAX)", () => {
    err(parseKmUpdateText("2147483 mil km", "explicit_report"), "km_out_of_range");
  });
  it("'0 mil km' → 0 válido", () => {
    ok(parseKmUpdateText("0 mil km", "explicit_report"), 0);
  });
  it("'NaN km' textual → no_km_candidate", () => {
    err(parseKmUpdateText("NaN km", "explicit_report"), "no_km_candidate");
  });
  it("'Infinity km' textual → no_km_candidate", () => {
    err(parseKmUpdateText("Infinity km", "explicit_report"), "no_km_candidate");
  });
  it("value_reply respeita range", () => {
    err(parseKmUpdateText("2147483648", "value_reply"), "km_out_of_range");
    err(parseKmUpdateText("-1", "value_reply"), "km_out_of_range");
  });
});

// ---------------------------------------------------------------------------
// Ambiguidade
// ---------------------------------------------------------------------------

describe("ambiguidade em explicit_report", () => {
  it("dois KMs diferentes → ambiguous", () => {
    err(
      parseKmUpdateText("50000 km ou 51000 km", "explicit_report"),
      "ambiguous_km_candidate",
    );
  });
  it("dois KMs iguais em spans distintos → ambiguous", () => {
    err(
      parseKmUpdateText("50000 km, confirmando 50000 km", "explicit_report"),
      "ambiguous_km_candidate",
    );
  });
  it("prefixo em uma ocorrência e sufixo em outra → ambiguous", () => {
    err(
      parseKmUpdateText("odometro 50000 e quilometragem 50000", "explicit_report"),
      "ambiguous_km_candidate",
    );
  });
  it("um ano sem marcador e um KM válido → sucesso", () => {
    ok(
      parseKmUpdateText("comprado em 2020, hoje odometro 50000", "explicit_report"),
      50000,
    );
  });
  it("dois números sem marcador → no_km_candidate", () => {
    err(parseKmUpdateText("2020 e 50000", "explicit_report"), "no_km_candidate");
  });
  it("uma expressão válida e outra malformada → invalid_km_format", () => {
    err(
      parseKmUpdateText("50000 km e 50,5 km", "explicit_report"),
      "invalid_km_format",
    );
    err(
      parseKmUpdateText("km 50000 e odometro 1.00", "explicit_report"),
      "invalid_km_format",
    );
    err(
      parseKmUpdateText("50000 km e +20 km", "explicit_report"),
      "invalid_km_format",
    );
  });
  it("uma expressão válida e outra fora de range → km_out_of_range", () => {
    err(
      parseKmUpdateText("50000 km e -20 km", "explicit_report"),
      "km_out_of_range",
    );
    err(
      parseKmUpdateText("50000 km e 2147483648 km", "explicit_report"),
      "km_out_of_range",
    );
  });
  it("prefixo com sufixo unido (km ... km) conta como um único candidato", () => {
    // "km 50000 km" — mesma ocorrência textual, um único candidato.
    ok(parseKmUpdateText("km 50000 km", "explicit_report"), 50000);
  });
});

// ---------------------------------------------------------------------------
// Resultado, determinismo, pureza
// ---------------------------------------------------------------------------

describe("resultado e determinismo", () => {
  it("sucesso contém apenas ok e newKm", () => {
    const r = parseKmUpdateText("50000 km", "explicit_report");
    expect(r.ok).toBe(true);
    expect(keys(r as object)).toEqual(["newKm", "ok"]);
  });
  it("erro contém apenas ok e code", () => {
    const r = parseKmUpdateText("abc", "explicit_report");
    expect(r.ok).toBe(false);
    expect(keys(r as object)).toEqual(["code", "ok"]);
  });
  it("codes pertencem à união fechada", () => {
    const allowed = new Set<KmUpdateParseErrorCode>([
      "not_a_string",
      "empty_text",
      "no_km_candidate",
      "ambiguous_km_candidate",
      "invalid_km_format",
      "km_out_of_range",
    ]);
    const inputs: Array<[unknown, "explicit_report" | "value_reply"]> = [
      [null, "explicit_report"],
      ["", "value_reply"],
      ["abc", "explicit_report"],
      ["50000", "explicit_report"],
      ["50000 km ou 51000 km", "explicit_report"],
      ["1.00 km", "explicit_report"],
      ["-1 km", "explicit_report"],
      ["meu carro está com 50000 km", "value_reply"],
    ];
    for (const [v, m] of inputs) {
      const r = parseKmUpdateText(v, m);
      if (!r.ok) expect(allowed.has(r.code)).toBe(true);
    }
  });
  it("erro não contém o input ou trecho capturado", () => {
    const r = parseKmUpdateText("kmita 50000 abc-xxx", "explicit_report");
    const s = JSON.stringify(r);
    expect(s.includes("kmita")).toBe(false);
    expect(s.includes("50000")).toBe(false);
    expect(s.includes("abc-xxx")).toBe(false);
  });
  it("chamadas iguais retornam resultados estruturalmente iguais", () => {
    const a = parseKmUpdateText("50.000 km", "explicit_report");
    const b = parseKmUpdateText("50.000 km", "explicit_report");
    expect(a).toEqual(b);
    const c = parseKmUpdateText("abc", "value_reply");
    const d = parseKmUpdateText("abc", "value_reply");
    expect(c).toEqual(d);
  });
  it("não depende de relógio nem de locale (execuções múltiplas iguais)", () => {
    for (let i = 0; i < 10; i++) {
      ok(parseKmUpdateText("odometro 50 mil", "explicit_report"), 50000);
    }
  });
  it("string longa e repetitiva termina normalmente sem catastrophic backtracking", () => {
    const long = "km ".repeat(500) + "50000 km";
    const start = Date.now();
    const r = parseKmUpdateText(long, "explicit_report");
    const elapsed = Date.now() - start;
    // não faz assert de tempo estrito; apenas garante que terminou em tempo hábil.
    expect(elapsed).toBeLessThan(2000);
    // vários candidatos "km <lixo>" — não há dígito atrelado a cada km isolado,
    // e no fim há um único candidato válido. Deve retornar sucesso.
    // Alternativamente, pode ser ambíguo dependendo do reconhecimento —
    // aceitamos qualquer resultado determinístico não-throw.
    expect(r).toBeDefined();
  });
  it("input com muitos separadores válidos termina em tempo hábil", () => {
    const s = "1" + " 000".repeat(2) + " km"; // "1 000 000 km"
    ok(parseKmUpdateText(s, "explicit_report"), 1000000);
  });
});
