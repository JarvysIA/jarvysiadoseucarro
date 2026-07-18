import { describe, expect, test } from "bun:test";
import {
  matchExpenseCategoria,
  parseExpenseValorBareNumber,
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

describe("parseExpenseValorBareNumber — número pelado com ponto de milhar", () => {
  test('"mecanico 1.800" → 1800', () => {
    expect(parseExpenseValorBareNumber("mecanico 1.800")).toEqual({
      ok: true,
      valor: 1800,
    });
  });
  test('"oficina 2.500" → 2500', () => {
    expect(parseExpenseValorBareNumber("oficina 2.500")).toEqual({
      ok: true,
      valor: 2500,
    });
  });
  test('"conserto 1.200" → 1200', () => {
    expect(parseExpenseValorBareNumber("conserto 1.200")).toEqual({
      ok: true,
      valor: 1200,
    });
  });
  test('"revisão 20.000km 1.800" → ambíguo (dois números; a guarda de marco fica no core.ts)', () => {
    expect(parseExpenseValorBareNumber("revisão 20.000km 1.800")).toEqual({
      ok: false,
      code: "ambiguous_valor_candidate",
    });
  });
  test('"oficina 300" → 300 (regressão)', () => {
    expect(parseExpenseValorBareNumber("oficina 300")).toEqual({
      ok: true,
      valor: 300,
    });
  });
  test('"GNV 30" → 30 (regressão)', () => {
    expect(parseExpenseValorBareNumber("GNV 30")).toEqual({ ok: true, valor: 30 });
  });
  test('"óleo 220" → 220 (regressão)', () => {
    expect(parseExpenseValorBareNumber("óleo 220")).toEqual({
      ok: true,
      valor: 220,
    });
  });
  test('"conserto 800,00" → fallback de vírgula não entra aqui (é parseExpenseValorText); aqui devolve no_valor_candidate', () => {
    // Regressão geral protegida pelo core.ts, que tenta parseExpenseValorText
    // primeiro e só depois o fallback.
    expect(parseExpenseValorBareNumber("conserto 800,00")).toEqual({
      ok: false,
      code: "no_valor_candidate",
    });
  });
  test('"300" sozinho → valor reconhecido pelo parser puro; sem categoria é regra do core.ts', () => {
    // Aqui garantimos que não regrediu para "30"+"0".
    expect(parseExpenseValorBareNumber("300")).toEqual({ ok: true, valor: 300 });
  });
  test('"12.345" → 12345', () => {
    expect(parseExpenseValorBareNumber("12.345")).toEqual({
      ok: true,
      valor: 12345,
    });
  });
  test('"R$ 1.800" → se chamado, encontra 1.800 como ponto de milhar', () => {
    // Documenta que o fallback puro não sabe de âncora; o core.ts evita usá-lo
    // quando há R$.
    expect(parseExpenseValorBareNumber("R$ 1.800")).toEqual({
      ok: true,
      valor: 1800,
    });
  });
  test("não-string: null", () => {
    expect(parseExpenseValorBareNumber(null)).toEqual({
      ok: false,
      code: "not_a_string",
    });
  });
  test("texto vazio", () => {
    expect(parseExpenseValorBareNumber("")).toEqual({
      ok: false,
      code: "empty_text",
    });
  });
  test('"texto sem número" → no_valor_candidate', () => {
    expect(parseExpenseValorBareNumber("gastei muito hoje")).toEqual({
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
  test('"óleo"', () => {
    expect(matchExpenseCategoria("óleo")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"pastilha de freio"', () => {
    expect(matchExpenseCategoria("pastilha de freio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"freio" sozinho', () => {
    expect(matchExpenseCategoria("freio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"disco de freio"', () => {
    expect(matchExpenseCategoria("disco de freio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"vela de ignição"', () => {
    expect(matchExpenseCategoria("vela de ignição")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"correia dentada"', () => {
    expect(matchExpenseCategoria("correia dentada")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"kit sincronismo"', () => {
    expect(matchExpenseCategoria("kit sincronismo")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"arrefecimento"', () => {
    expect(matchExpenseCategoria("arrefecimento")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"radiador"', () => {
    expect(matchExpenseCategoria("radiador")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"palhetas"', () => {
    expect(matchExpenseCategoria("palhetas")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"alinhamento e balanceamento"', () => {
    expect(matchExpenseCategoria("alinhamento e balanceamento")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"câmbio"', () => {
    expect(matchExpenseCategoria("câmbio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"direção hidráulica"', () => {
    expect(matchExpenseCategoria("direção hidráulica")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"filtro de cabine"', () => {
    expect(matchExpenseCategoria("filtro de cabine")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"filtro de ar"', () => {
    expect(matchExpenseCategoria("filtro de ar")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
});

// Build CORRETIVO 4/6 — alinhamento com motor determinístico
// (Revisão = itens rastreados por marco de km; Manutenção = corretivos)

describe("matchExpenseCategoria — Revisão: itens do motor determinístico (adicionais)", () => {
  test('"pastilha"', () => {
    expect(matchExpenseCategoria("pastilha")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"velas"', () => {
    expect(matchExpenseCategoria("velas")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"correia"', () => {
    expect(matchExpenseCategoria("correia")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"fluido de freio"', () => {
    expect(matchExpenseCategoria("fluido de freio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"geometria"', () => {
    expect(matchExpenseCategoria("geometria")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"cambagem"', () => {
    expect(matchExpenseCategoria("cambagem")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"câmbio" sozinho', () => {
    expect(matchExpenseCategoria("câmbio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"óleo do câmbio"', () => {
    expect(matchExpenseCategoria("óleo do câmbio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"direção hidráulica"', () => {
    expect(matchExpenseCategoria("direção hidráulica")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"óleo da direção"', () => {
    expect(matchExpenseCategoria("óleo da direção")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"sangria de freio"', () => {
    expect(matchExpenseCategoria("sangria de freio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"discos de freio"', () => {
    expect(matchExpenseCategoria("discos de freio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"correia banhada"', () => {
    expect(matchExpenseCategoria("correia banhada")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"correia poly v"', () => {
    expect(matchExpenseCategoria("correia poly v")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"aditivo do radiador"', () => {
    expect(matchExpenseCategoria("aditivo do radiador")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"troca de óleo"', () => {
    expect(matchExpenseCategoria("troca de óleo")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"filtro do óleo"', () => {
    expect(matchExpenseCategoria("filtro do óleo")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"filtro do ar"', () => {
    expect(matchExpenseCategoria("filtro do ar")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
});

describe("matchExpenseCategoria — Manutenção: corretivos não rastreados por km (adicionais)", () => {
  test('"amortecedor"', () => {
    expect(matchExpenseCategoria("amortecedor")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"bucha"', () => {
    expect(matchExpenseCategoria("bucha")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"buchas"', () => {
    expect(matchExpenseCategoria("buchas")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"batente"', () => {
    expect(matchExpenseCategoria("batente")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"ar condicionado"', () => {
    expect(matchExpenseCategoria("ar condicionado")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"carga de gás"', () => {
    expect(matchExpenseCategoria("carga de gás")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"higienização do ar condicionado"', () => {
    expect(matchExpenseCategoria("higienização do ar condicionado")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"alternador"', () => {
    expect(matchExpenseCategoria("alternador")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"mecânico"', () => {
    expect(matchExpenseCategoria("mecânico")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"conserto"', () => {
    expect(matchExpenseCategoria("conserto")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"pneu"', () => {
    expect(matchExpenseCategoria("pneu")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"embreagem"', () => {
    expect(matchExpenseCategoria("embreagem")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
});

describe("matchExpenseCategoria — frases naturais completas (Build 4/6)", () => {
  test('"troquei a pastilha de freio" → Revisão', () => {
    expect(matchExpenseCategoria("troquei a pastilha de freio")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"fiz o alinhamento e balanceamento" → Revisão', () => {
    expect(matchExpenseCategoria("fiz o alinhamento e balanceamento")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"consertei o ar condicionado, tava sem gelar" → Manutenção', () => {
    expect(matchExpenseCategoria("consertei o ar condicionado, tava sem gelar")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"troquei a bucha do amortecedor" → Manutenção', () => {
    expect(matchExpenseCategoria("troquei a bucha do amortecedor")).toEqual({
      ok: true,
      categoria: "Manutenção",
    });
  });
  test('"pastilha e disco de freio, vela nova também" → Revisão', () => {
    expect(matchExpenseCategoria("pastilha e disco de freio, vela nova também")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
  test('"óleo, filtro e correia" → Revisão', () => {
    expect(matchExpenseCategoria("óleo, filtro e correia")).toEqual({
      ok: true,
      categoria: "Revisão",
    });
  });
});

describe("matchExpenseCategoria — concessões técnicas confirmadas (Build 4/6)", () => {
  test('"ar" sozinho não classifica nenhuma categoria', () => {
    expect(matchExpenseCategoria("ar")).toEqual({
      ok: false,
      code: "no_categoria_candidate",
    });
  });
  test('"filtro de combustível" → Combustível (não Revisão)', () => {
    expect(matchExpenseCategoria("filtro de combustível")).toEqual({
      ok: true,
      categoria: "Combustível",
    });
  });
});

describe("matchExpenseCategoria — Combustível (expansão Build 4/6)", () => {
  test('"completei o tanque"', () => {
    expect(matchExpenseCategoria("completei o tanque")).toEqual({
      ok: true,
      categoria: "Combustível",
    });
  });
  test('"enchi o tanque"', () => {
    expect(matchExpenseCategoria("enchi o tanque")).toEqual({
      ok: true,
      categoria: "Combustível",
    });
  });
  test('"tanque cheio"', () => {
    expect(matchExpenseCategoria("tanque cheio")).toEqual({
      ok: true,
      categoria: "Combustível",
    });
  });
  test('"encher o tanque"', () => {
    expect(matchExpenseCategoria("encher o tanque")).toEqual({
      ok: true,
      categoria: "Combustível",
    });
  });
});

describe("matchExpenseCategoria — Acessórios (expansão Build 4/6)", () => {
  test('"som" sozinho', () => {
    expect(matchExpenseCategoria("som")).toEqual({
      ok: true,
      categoria: "Acessórios",
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
