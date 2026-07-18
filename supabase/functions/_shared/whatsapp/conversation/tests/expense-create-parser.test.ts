import { describe, expect, test } from "bun:test";
import {
  matchExpenseCategoria,
  parseExpenseValorText,
} from "../expense-create-parser.ts";

// ===========================================================================
// parseExpenseValorText
// ===========================================================================

describe("parseExpenseValorText — entradas inválidas de tipo/vazio", () => {
  test("não-string: null", () => {
    expect(parseExpenseValorText(null)).toEqual({
      ok: false,
      code: "not_a_string",
    });
  });
  test("não-string: undefined", () => {
    expect(parseExpenseValorText(undefined)).toEqual({
      ok: false,
      code: "not_a_string",
    });
  });
  test("não-string: number", () => {
    expect(parseExpenseValorText(30)).toEqual({
      ok: false,
      code: "not_a_string",
    });
  });
  test("não-string: object", () => {
    expect(parseExpenseValorText({})).toEqual({
      ok: false,
      code: "not_a_string",
    });
  });
  test("string vazia", () => {
    expect(parseExpenseValorText("")).toEqual({ ok: false, code: "empty_text" });
  });
  test("só whitespace", () => {
    expect(parseExpenseValorText("   \n\t ")).toEqual({
      ok: false,
      code: "empty_text",
    });
  });
});

describe("parseExpenseValorText — branch (c) bare com vírgula", () => {
  test('"30,00" sozinho', () => {
    expect(parseExpenseValorText("30,00")).toEqual({ ok: true, valor: 30 });
  });
  test('"botão de vidro 30,00" — sem r$/reais', () => {
    expect(parseExpenseValorText("botão de vidro 30,00")).toEqual({
      ok: true,
      valor: 30,
    });
  });
  test('"149,90" — decimal típico', () => {
    expect(parseExpenseValorText("149,90")).toEqual({ ok: true, valor: 149.9 });
  });
  test('"80,5" — 1 dígito de centavo = R$80,50', () => {
    expect(parseExpenseValorText("80,5")).toEqual({ ok: true, valor: 80.5 });
  });
  test('"1.234,56" — milhar + centavos', () => {
    expect(parseExpenseValorText("1.234,56")).toEqual({
      ok: true,
      valor: 1234.56,
    });
  });
  test('"paguei 1.234,56 hoje"', () => {
    expect(parseExpenseValorText("paguei 1.234,56 hoje")).toEqual({
      ok: true,
      valor: 1234.56,
    });
  });
});

describe("parseExpenseValorText — branch (a) prefixo R$", () => {
  test('"R$ 80"', () => {
    expect(parseExpenseValorText("R$ 80")).toEqual({ ok: true, valor: 80 });
  });
  test('"r$80" (colado, lowercase)', () => {
    expect(parseExpenseValorText("r$80")).toEqual({ ok: true, valor: 80 });
  });
  test('"R$ 1.234" (milhar sem centavos)', () => {
    expect(parseExpenseValorText("R$ 1.234")).toEqual({ ok: true, valor: 1234 });
  });
  test('"R$ 149,90"', () => {
    expect(parseExpenseValorText("R$ 149,90")).toEqual({
      ok: true,
      valor: 149.9,
    });
  });
  test('"gastei R$ 50 no posto"', () => {
    expect(parseExpenseValorText("gastei R$ 50 no posto")).toEqual({
      ok: true,
      valor: 50,
    });
  });
});

describe("parseExpenseValorText — branch (b) sufixo reais", () => {
  test('"80 reais"', () => {
    expect(parseExpenseValorText("80 reais")).toEqual({ ok: true, valor: 80 });
  });
  test('"1.234 reais"', () => {
    expect(parseExpenseValorText("1.234 reais")).toEqual({
      ok: true,
      valor: 1234,
    });
  });
  test('"149,90 reais"', () => {
    expect(parseExpenseValorText("149,90 reais")).toEqual({
      ok: true,
      valor: 149.9,
    });
  });
  test('"foram 200 reais no total"', () => {
    expect(parseExpenseValorText("foram 200 reais no total")).toEqual({
      ok: true,
      valor: 200,
    });
  });
});

describe("parseExpenseValorText — fora de escopo (sem âncora)", () => {
  test('"80" sozinho — sem vírgula/r$/reais', () => {
    expect(parseExpenseValorText("80")).toEqual({
      ok: false,
      code: "no_valor_candidate",
    });
  });
  test('"1.234" sozinho — milhar sem âncora', () => {
    expect(parseExpenseValorText("1.234")).toEqual({
      ok: false,
      code: "no_valor_candidate",
    });
  });
  test('"paguei 80 hoje" — número solto sem âncora', () => {
    expect(parseExpenseValorText("paguei 80 hoje")).toEqual({
      ok: false,
      code: "no_valor_candidate",
    });
  });
  test("texto sem número", () => {
    expect(parseExpenseValorText("gastei muito hoje")).toEqual({
      ok: false,
      code: "no_valor_candidate",
    });
  });
});

describe("parseExpenseValorText — formato inválido", () => {
  test("vírgula com 3+ dígitos depois (ancorado por R$)", () => {
    expect(parseExpenseValorText("R$ 30,000")).toEqual({
      ok: false,
      code: "invalid_valor_format",
    });
  });
  test('"30,000" bare — sem âncora e fora do padrão (c) -> no_valor_candidate', () => {
    expect(parseExpenseValorText("30,000")).toEqual({
      ok: false,
      code: "no_valor_candidate",
    });
  });
  test('"1,234,56" — duas vírgulas', () => {
    // Regex captura "234,56" na branch (c); mas isso é ok.
    // Aqui garantimos que "R$ 1,234,56" (duas vírgulas dentro do número
    // capturado pela branch (a)) é rejeitado.
    expect(parseExpenseValorText("R$ 1,234,56")).toEqual({
      ok: false,
      code: "invalid_valor_format",
    });
  });
  test('"R$ 1.23" — ponto com 2 dígitos vira decimal (válido)', () => {
    expect(parseExpenseValorText("R$ 1.23")).toEqual({ ok: true, valor: 1.23 });
  });
  test('"R$ 12.34.56" — pontos irregulares', () => {
    expect(parseExpenseValorText("R$ 12.34.56")).toEqual({
      ok: false,
      code: "invalid_valor_format",
    });
  });
  test('"R$ 1.2345" — ponto com 4 dígitos depois', () => {
    expect(parseExpenseValorText("R$ 1.2345")).toEqual({
      ok: false,
      code: "invalid_valor_format",
    });
  });
});

describe("parseExpenseValorText — faixa", () => {
  test("acima do limite", () => {
    expect(parseExpenseValorText("R$ 9999999999")).toEqual({
      ok: false,
      code: "valor_out_of_range",
    });
  });
  test('"0,00" — não > 0', () => {
    expect(parseExpenseValorText("0,00")).toEqual({
      ok: false,
      code: "valor_out_of_range",
    });
  });
  test("no limite exato aceitável", () => {
    expect(parseExpenseValorText("R$ 999999999,99")).toEqual({
      ok: true,
      valor: 999999999.99,
    });
  });
});

describe("parseExpenseValorText — ambiguidade / múltiplos", () => {
  test("dois valores diferentes na mesma frase", () => {
    expect(parseExpenseValorText("R$ 30 e 80 reais")).toEqual({
      ok: false,
      code: "ambiguous_valor_candidate",
    });
  });
  test("mesmo valor por duas âncoras — não é ambíguo", () => {
    expect(parseExpenseValorText("R$ 80 (80 reais)")).toEqual({
      ok: true,
      valor: 80,
    });
  });
});

describe("parseExpenseValorText — precedência de erros", () => {
  test("formato inválido vence range", () => {
    // "R$ 30,000" tem formato inválido (3 dígitos depois da vírgula).
    expect(parseExpenseValorText("R$ 30,000")).toEqual({
      ok: false,
      code: "invalid_valor_format",
    });
  });
});

describe("parseExpenseValorText — determinismo e não mutação", () => {
  test("mesma entrada, mesmo resultado (10x)", () => {
    for (let i = 0; i < 10; i++) {
      expect(parseExpenseValorText("R$ 149,90")).toEqual({
        ok: true,
        valor: 149.9,
      });
    }
  });
  test("input não é modificado", () => {
    const input = "gastei R$ 80,50 no posto";
    const copy = input;
    parseExpenseValorText(input);
    expect(input).toBe(copy);
  });
  test("cap de entrada muito longa não crasha", () => {
    const long = "x".repeat(10000) + " R$ 30,00";
    // Vai passar do cap antes de ver o valor -> no_valor_candidate.
    const res = parseExpenseValorText(long);
    expect(res.ok).toBe(false);
  });
});

// ===========================================================================
// matchExpenseCategoria
// ===========================================================================

describe("matchExpenseCategoria — entradas inválidas", () => {
  test("null", () => {
    expect(matchExpenseCategoria(null)).toEqual({
      ok: false,
      code: "not_a_string",
    });
  });
  test("number", () => {
    expect(matchExpenseCategoria(42)).toEqual({
      ok: false,
      code: "not_a_string",
    });
  });
  test("string vazia", () => {
    expect(matchExpenseCategoria("")).toEqual({ ok: false, code: "empty_text" });
  });
  test("só whitespace", () => {
    expect(matchExpenseCategoria("   ")).toEqual({
      ok: false,
      code: "empty_text",
    });
  });
});

describe("matchExpenseCategoria — Combustível (2+ keywords)", () => {
  test('"gasolina"', () => {
    expect(matchExpenseCategoria("gasolina")).toEqual({
      ok: true,
      categoria: "Combustível",
    });
  });
  test('"paguei o posto hoje"', () => {
    expect(matchExpenseCategoria("paguei o posto hoje")).toEqual({
      ok: true,
      categoria: "Combustível",
    });
  });
  test('"abasteci de etanol"', () => {
    expect(matchExpenseCategoria("abasteci de etanol")).toEqual({
      ok: true,
      categoria: "Combustível",
    });
  });
  test('"coloquei GNV"', () => {
    expect(matchExpenseCategoria("coloquei GNV")).toEqual({
      ok: true,
      categoria: "Combustível",
    });
  });
});

describe("matchExpenseCategoria — Manutenção (2+ keywords)", () => {
  test('"fui na oficina"', () => {
    expect(matchExpenseCategoria("fui na oficina")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"pneus novos"', () => {
    expect(matchExpenseCategoria("pneus novos")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"conserto do ar condicionado"', () => {
    expect(matchExpenseCategoria("conserto do ar condicionado")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"troquei a suspensão"', () => {
    expect(matchExpenseCategoria("troquei a suspensão")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"bateria nova"', () => {
    expect(matchExpenseCategoria("bateria nova")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
});

describe("matchExpenseCategoria — Revisão (2+ keywords)", () => {
  test('"revisão"', () => {
    expect(matchExpenseCategoria("revisão")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"revisão preventiva"', () => {
    expect(matchExpenseCategoria("revisão preventiva")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
});

describe("matchExpenseCategoria — Lavagem (2+ keywords)", () => {
  test('"lavagem completa"', () => {
    expect(matchExpenseCategoria("lavagem completa")).toEqual({
      ok: true,
      categoria: "Lavagem",
    });
  });
  test('"lava rapido da esquina"', () => {
    expect(matchExpenseCategoria("lava rapido da esquina")).toEqual({
      ok: true,
      categoria: "Lavagem",
    });
  });
  test('"lavação simples"', () => {
    expect(matchExpenseCategoria("lavação simples")).toEqual({
      ok: true,
      categoria: "Lavagem",
    });
  });
});

describe("matchExpenseCategoria — IPVA / Multas / Seguro", () => {
  test('"IPVA 2025"', () => {
    expect(matchExpenseCategoria("IPVA 2025")).toEqual({
      ok: true,
      categoria: "IPVA",
    });
  });
  test('"paguei uma multa"', () => {
    expect(matchExpenseCategoria("paguei uma multa")).toEqual({
      ok: true,
      categoria: "Multas",
    });
  });
  test('"multas atrasadas"', () => {
    expect(matchExpenseCategoria("multas atrasadas")).toEqual({
      ok: true,
      categoria: "Multas",
    });
  });
  test('"infração de trânsito"', () => {
    expect(matchExpenseCategoria("infração de trânsito")).toEqual({
      ok: true,
      categoria: "Multas",
    });
  });
  test('"seguro do carro"', () => {
    expect(matchExpenseCategoria("seguro do carro")).toEqual({
      ok: true,
      categoria: "Seguro",
    });
  });
  test('"apolice renovada"', () => {
    expect(matchExpenseCategoria("apolice renovada")).toEqual({
      ok: true,
      categoria: "Seguro",
    });
  });
  test('"seguradora nova"', () => {
    expect(matchExpenseCategoria("seguradora nova")).toEqual({
      ok: true,
      categoria: "Seguro",
    });
  });
});

describe("matchExpenseCategoria — Acessórios (2+ keywords)", () => {
  test('"comprei um tapete"', () => {
    expect(matchExpenseCategoria("comprei um tapete")).toEqual({
      ok: true,
      categoria: "Acessórios",
    });
  });
  test('"película nova"', () => {
    expect(matchExpenseCategoria("película nova")).toEqual({
      ok: true,
      categoria: "Acessórios",
    });
  });
  test('"som automotivo instalado"', () => {
    expect(matchExpenseCategoria("som automotivo instalado")).toEqual({
      ok: true,
      categoria: "Acessórios",
    });
  });
  test('"calota trocada"', () => {
    expect(matchExpenseCategoria("calota trocada")).toEqual({
      ok: true,
      categoria: "Acessórios",
    });
  });
});

describe("matchExpenseCategoria — ambiguidade", () => {
  test("duas categorias distintas na mesma frase", () => {
    expect(matchExpenseCategoria("gasolina e lavagem")).toEqual({
      ok: false,
      code: "ambiguous_categoria_candidate",
    });
  });
  test("três categorias distintas", () => {
    expect(matchExpenseCategoria("IPVA, multa e seguro")).toEqual({
      ok: false,
      code: "ambiguous_categoria_candidate",
    });
  });
  test("mesma categoria por duas keywords não é ambíguo", () => {
    expect(matchExpenseCategoria("oficina e mecânico")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
});

describe("matchExpenseCategoria — sem match", () => {
  test("texto genérico sem palavra-chave", () => {
    expect(matchExpenseCategoria("gastei um dinheiro hoje")).toEqual({
      ok: false,
      code: "no_categoria_candidate",
    });
  });
  test("só números", () => {
    expect(matchExpenseCategoria("30,00")).toEqual({
      ok: false,
      code: "no_categoria_candidate",
    });
  });
});

describe("matchExpenseCategoria — determinismo e não mutação", () => {
  test("mesma entrada, mesmo resultado (10x)", () => {
    for (let i = 0; i < 10; i++) {
      expect(matchExpenseCategoria("gasolina no posto")).toEqual({
        ok: true,
        categoria: "Combustível",
      });
    }
  });
  test("input não é modificado", () => {
    const input = "IPVA 2025";
    const copy = input;
    matchExpenseCategoria(input);
    expect(input).toBe(copy);
  });
});
