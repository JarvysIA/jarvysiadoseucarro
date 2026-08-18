import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { recognizeExpenseIntent } from "../expense-intent-recognizer.ts";

// ============================================================
// Bloco A — cada COMPLETION_KEYWORD representado ao menos 1x.
//
// Nota de contagem: a especificação da tarefa dizia "(17 casos...)", mas a
// lista literal de COMPLETION_KEYWORDS fornecida tem 25 itens (contados
// diretamente do texto da tarefa). Cobrimos os 25, não os 17 — "cada
// COMPLETION_KEYWORD representado ao menos 1x" é a instrução inequívoca;
// o número entre parênteses está desatualizado em relação à lista real.
// Mesma situação (parêntese não bate com a lista real) se repete em C e E
// abaixo — reportado no retorno da tarefa, não é uma ambiguidade
// bloqueante (a lista em si é clara).
// ============================================================

describe("Bloco A — COMPLETION_KEYWORDS (25 casos, um por palavra/frase)", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["troquei", "Troquei o óleo do carro hoje."],
    ["comprei", "Comprei um pneu novo."],
    ["paguei", "Paguei a revisão do carro."],
    ["gastei", "Gastei 300 reais com a bateria."],
    ["fiz", "Fiz a troca de óleo no carro."],
    ["coloquei", "Coloquei óleo novo no motor."],
    ["instalei", "Instalei um som novo no carro."],
    ["consertei", "Consertei o freio do carro."],
    ["levei", "Levei o carro na oficina."],
    ["botei", "Botei óleo novo no carro."],
    ["arrumei", "Arrumei o vidro do carro."],
    ["resolvi", "Resolvi o problema do motor."],
    ["peguei", "Peguei o carro na oficina."],
    ["saiu", "A revisão saiu 400 reais."],
    ["ficou", "A troca de óleo ficou 150 reais."],
    ["deu", "A revisão deu 200 reais."],
    ["cobrou", "A oficina cobrou 250 reais."],
    ["mandei trocar", "Mandei trocar o óleo do carro."],
    ["mandei fazer", "Mandei fazer a revisão do carro."],
    ["ta trocado", "O óleo ta trocado."],
    ["esta trocado", "O óleo está trocado."],
    ["foi trocado", "O óleo foi trocado."],
    ["ta pago", "O seguro ta pago."],
    ["esta pago", "O seguro está pago."],
    ["foi pago", "O seguro foi pago."],
  ];

  for (const [keyword, text] of cases) {
    it(`"${keyword}" → record_completed_expense ("${text}")`, () => {
      expect(recognizeExpenseIntent(text)).toBe("record_completed_expense");
    });
  }
});

// ============================================================
// Bloco B — negação cancelando conclusão.
// ============================================================

describe("Bloco B — negação cancela COMPLETION_KEYWORDS", () => {
  it("1. 'Não troquei o óleo ainda.' → ambiguous (negado, sem outro sinal)", () => {
    expect(recognizeExpenseIntent("Não troquei o óleo ainda.")).toBe("ambiguous");
  });

  it("2. 'Ainda não paguei a revisão.' → ambiguous (negado, sem outro sinal)", () => {
    expect(recognizeExpenseIntent("Ainda não paguei a revisão.")).toBe("ambiguous");
  });

  it("3. 'Não comprei os pneus.' → ambiguous (negado, sem outro sinal)", () => {
    expect(recognizeExpenseIntent("Não comprei os pneus.")).toBe("ambiguous");
  });

  it("4. controle: o mesmo texto base SEM negação classifica como completed", () => {
    expect(recognizeExpenseIntent("Comprei os pneus.")).toBe("record_completed_expense");
  });
});

// ============================================================
// Bloco C — QUOTE_KEYWORDS (18 casos — mesma nota de contagem do Bloco A;
// a especificação original dizia "16 casos", a lista literal original
// tinha 17 itens, e "pedi orcamento" foi adicionado depois, numa decisão
// consciente e autorizada separadamente — ver Bloco F item 4).
// ============================================================

describe("Bloco C — QUOTE_KEYWORDS (18 casos, um por palavra/frase)", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["quanto custa", "Quanto custa a troca de óleo?"],
    ["quanto fica", "Quanto fica a revisão do carro?"],
    ["quanto cobra", "Quanto cobra pra trocar o óleo?"],
    ["qual o preco", "Qual o preço da revisão?"],
    ["qual o valor", "Qual o valor do conserto?"],
    ["preco para", "Qual o preço para trocar o óleo?"],
    ["preco de", "Preço de revisão do carro?"],
    ["cotacao de", "Cotação de pneus novos?"],
    ["quanto sai", "Quanto sai a revisão?"],
    ["sai quanto", "A revisão sai quanto?"],
    ["quanto que fica", "Quanto que fica a troca de óleo?"],
    ["quanto vai custar", "Quanto vai custar o conserto?"],
    ["quanto seria", "Quanto seria a revisão?"],
    ["tem nocao de quanto", "Você tem noção de quanto fica a revisão?"],
    ["tem ideia do valor", "Tem ideia do valor da revisão?"],
    ["faz um orcamento", "Faz um orçamento pra mim?"],
    ["manda um orcamento", "Manda um orçamento da revisão?"],
    ["pedi orcamento", "Só pedi orçamento da revisão."],
  ];

  for (const [keyword, text] of cases) {
    it(`"${keyword}" → request_quote ("${text}")`, () => {
      expect(recognizeExpenseIntent(text)).toBe("request_quote");
    });
  }
});

// ============================================================
// Bloco D — TECHNICAL_QUESTION_KEYWORDS (12 casos — bate exatamente com a
// contagem da especificação).
// ============================================================

describe("Bloco D — TECHNICAL_QUESTION_KEYWORDS (12 casos, um por palavra/frase)", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["qual oleo", "Qual óleo eu uso no carro?"],
    ["que oleo", "Que óleo é melhor pro motor?"],
    ["posso usar", "Posso usar óleo sintético?"],
    ["e normal", "É normal o carro fazer esse barulho?"],
    ["por que", "Por que o carro está fazendo esse barulho?"],
    ["sera que", "Será que preciso trocar o óleo?"],
    ["pode ser", "Pode ser a correia dentada?"],
    ["da pra", "Dá pra rodar mais um pouco assim?"],
    ["consigo", "Consigo rodar mais uns 500 km assim?"],
    ["vcs recomendam", "Vcs recomendam qual oficina?"],
    ["voces recomendam", "Vocês recomendam trocar agora?"],
    ["tem problema se", "Tem problema se eu não trocar agora?"],
  ];

  for (const [keyword, text] of cases) {
    it(`"${keyword}" → ask_question ("${text}")`, () => {
      expect(recognizeExpenseIntent(text)).toBe("ask_question");
    });
  }
});

// ============================================================
// Bloco E — FUTURE_KEYWORDS (21 casos — mesma nota de contagem; a
// especificação dizia "20 casos" mas a lista literal tem 21 itens).
// ============================================================

describe("Bloco E — FUTURE_KEYWORDS (21 casos, um por palavra/frase)", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["vou trocar", "Vou trocar o óleo do carro."],
    ["vou levar", "Vou levar o carro na oficina."],
    ["pretendo", "Pretendo revisar o carro."],
    ["quero trocar", "Quero trocar o óleo do carro."],
    ["queria trocar", "Queria trocar os pneus."],
    ["preciso trocar", "Preciso trocar a correia."],
    ["tenho que trocar", "Tenho que trocar o óleo."],
    ["devo trocar", "Devo trocar a bateria."],
    ["falta trocar", "Falta trocar o filtro."],
    ["pensando em", "Estou pensando em revisar o carro."],
    ["amanha", "Amanhã levo o carro na oficina."],
    ["semana que vem", "Levo o carro na oficina semana que vem."],
    ["mes que vem", "Vou fazer a revisão mês que vem."],
    ["ano que vem", "Ano que vem troco os pneus."],
    ["essa semana", "Vou ao mecânico essa semana."],
    ["esse fim de semana", "Levo o carro na oficina esse fim de semana."],
    ["mais tarde", "Troco o óleo mais tarde."],
    ["depois eu troco", "Depois eu troco o óleo."],
    ["ainda vou", "Ainda vou trocar o óleo."],
    ["ta na hora de", "Tá na hora de trocar os pneus."],
    ["esta na hora de", "Está na hora de fazer a revisão."],
  ];

  for (const [keyword, text] of cases) {
    it(`"${keyword}" → discuss_future_service ("${text}")`, () => {
      expect(recognizeExpenseIntent(text)).toBe("discuss_future_service");
    });
  }
});

// ============================================================
// Bloco F — precedência e casos compostos.
// ============================================================

describe("Bloco F — precedência e casos compostos", () => {
  it("1. 'Troquei o óleo por 500, pode anotar?' → record_completed_expense (conclusão vence apesar do '?')", () => {
    expect(recognizeExpenseIntent("Troquei o óleo por 500, pode anotar?")).toBe(
      "record_completed_expense",
    );
  });

  it("2. 'Comprei o óleo por 200 e vou trocar amanhã.' → record_completed_expense (compra vence futuro)", () => {
    expect(recognizeExpenseIntent("Comprei o óleo por 200 e vou trocar amanhã.")).toBe(
      "record_completed_expense",
    );
  });

  it("3. 'Troquei o óleo ontem; quanto deveria ter custado?' → record_completed_expense (conclusão vence pergunta de preço)", () => {
    expect(recognizeExpenseIntent("Troquei o óleo ontem; quanto deveria ter custado?")).toBe(
      "record_completed_expense",
    );
  });

  // 4. Originalmente, "pedi orcamento" não estava em QUOTE_KEYWORDS —
  // reportado como achado (a lista literal fornecida não cobria esta
  // frase), e depois adicionado numa decisão explícita e autorizada
  // separadamente (não uma correção silenciosa). Com "pedi orcamento" na
  // lista: a negação cancela "troquei" (via "nao troquei"), prossegue
  // para QUOTE_KEYWORDS, onde "pedi orcamento" bate → request_quote.
  it("4. 'Não troquei o óleo, só pedi orçamento.' → request_quote (negação cancela conclusão, orçamento assume)", () => {
    expect(recognizeExpenseIntent("Não troquei o óleo, só pedi orçamento.")).toBe("request_quote");
  });

  it('5. "Será que já tá na hora de trocar a correia?" → ask_question (CASO CRÍTICO — pergunta técnica vence futuro)', () => {
    expect(recognizeExpenseIntent("Será que já tá na hora de trocar a correia?")).toBe(
      "ask_question",
    );
  });

  it("6. 'Tá na hora de trocar o óleo.' (sem interrogativo) → discuss_future_service (futuro puro prevalece, sem sinal de pergunta técnica)", () => {
    expect(recognizeExpenseIntent("Tá na hora de trocar o óleo.")).toBe("discuss_future_service");
  });

  it("7. 'Qual óleo devo usar?' → ask_question", () => {
    expect(recognizeExpenseIntent("Qual óleo devo usar?")).toBe("ask_question");
  });

  it("8. '200 reais.' (sozinho, nenhum outro sinal) → ambiguous", () => {
    expect(recognizeExpenseIntent("200 reais.")).toBe("ambiguous");
  });

  it("9. 'Não comprei ainda.' → ambiguous (negação sem nenhum sinal positivo de outra categoria)", () => {
    expect(recognizeExpenseIntent("Não comprei ainda.")).toBe("ambiguous");
  });

  // 10. Caso genuinamente difícil, sem resposta única certa — a própria
  // tarefa autorizou aceitar "ambiguous" OU "discuss_future_service".
  // Resultado real com as listas literais: "tenha que trocar" (subjuntivo)
  // não casa com o item "tenho que trocar" (presente do indicativo) de
  // FUTURE_KEYWORDS — hasBareKeyword exige a frase exata, não variação
  // gramatical. Nenhuma outra keyword de nenhuma lista bate em "Talvez eu
  // tenha que trocar." → resultado determinístico real: "ambiguous".
  // Documentado como a saída observada, não uma escolha arbitrária minha.
  it("10. 'Talvez eu tenha que trocar.' → ambiguous (saída real observada; discuss_future_service também seria aceito pela spec, ver comentário)", () => {
    expect(recognizeExpenseIntent("Talvez eu tenha que trocar.")).toBe("ambiguous");
  });
});

// ============================================================
// Bloco G — pureza.
// ============================================================

describe("Bloco G — pureza", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../expense-intent-recognizer.ts", import.meta.url)),
    "utf8",
  );

  it("1. zero fetch/Supabase/Deno.env no código-fonte", () => {
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/createClient/);
    expect(source).not.toMatch(/Deno\.env/);
  });

  it("2. zero any/as any/as unknown as/@ts-ignore/@ts-nocheck no código-fonte", () => {
    expect(source).not.toMatch(/\bany\b|as any|as unknown as|@ts-ignore|@ts-nocheck/);
  });

  it("3. função determinística: mesma entrada duas vezes produz exatamente o mesmo resultado", () => {
    const inputs = [
      "Troquei o óleo do carro.",
      "Quanto custa a revisão?",
      "Será que preciso trocar o óleo?",
      "Vou trocar o óleo amanhã.",
      "texto sem nenhum sinal",
    ];
    for (const input of inputs) {
      expect(recognizeExpenseIntent(input)).toBe(recognizeExpenseIntent(input));
    }
  });

  it("4. não reimplementa normalizeExpenseSemanticText — importa de normalization.ts", () => {
    expect(source).toContain('from "./normalization.ts"');
    expect(source).toContain("normalizeExpenseSemanticText");
  });

  it("5. não muta o texto de entrada (parâmetro somente lido)", () => {
    const input = "Troquei o óleo do carro.";
    const snapshot = input;
    recognizeExpenseIntent(input);
    expect(input).toBe(snapshot);
  });
});
