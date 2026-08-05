import { describe, expect, it } from "bun:test";
import { classifyNonEngineExpense } from "../non-engine-heuristic-classifier.ts";

describe("non-engine heuristic classifier — resolução por categoria individual", () => {
  it("resolve Acessórios por 'parachoque' e 'som automotivo'", () => {
    expect(classifyNonEngineExpense("comprei um parachoque novo")).toEqual({
      status: "resolved",
      category: "Acessórios",
    });
    expect(classifyNonEngineExpense("troquei o som automotivo")).toEqual({
      status: "resolved",
      category: "Acessórios",
    });
  });

  it("resolve Lavagem por 'lavagem' e 'polimento'", () => {
    expect(classifyNonEngineExpense("fiz uma lavagem completa")).toEqual({
      status: "resolved",
      category: "Lavagem",
    });
    expect(classifyNonEngineExpense("fiz o polimento do carro")).toEqual({
      status: "resolved",
      category: "Lavagem",
    });
  });

  it("resolve Manutenção por 'bateria' e 'oficina'", () => {
    expect(classifyNonEngineExpense("troquei a bateria")).toEqual({
      status: "resolved",
      category: "Manutenção",
    });
    expect(classifyNonEngineExpense("fui na oficina")).toEqual({
      status: "resolved",
      category: "Manutenção",
    });
  });

  it("resolve Combustível por 'abasteci' e 'gasolina'", () => {
    expect(classifyNonEngineExpense("abasteci o carro")).toEqual({
      status: "resolved",
      category: "Combustível",
    });
    expect(classifyNonEngineExpense("coloquei gasolina")).toEqual({
      status: "resolved",
      category: "Combustível",
    });
  });

  it("resolve IPVA por 'ipva' em duas frases diferentes (único termo do dicionário)", () => {
    expect(classifyNonEngineExpense("paguei o ipva do carro")).toEqual({
      status: "resolved",
      category: "IPVA",
    });
    expect(classifyNonEngineExpense("vencimento do ipva esse mes")).toEqual({
      status: "resolved",
      category: "IPVA",
    });
  });

  it("resolve Multas por 'multa' e 'infracao'", () => {
    expect(classifyNonEngineExpense("paguei uma multa")).toEqual({
      status: "resolved",
      category: "Multas",
    });
    expect(classifyNonEngineExpense("recebi uma infracao")).toEqual({
      status: "resolved",
      category: "Multas",
    });
  });

  it("resolve Seguro por 'seguro' e 'seguradora'", () => {
    expect(classifyNonEngineExpense("paguei o seguro")).toEqual({
      status: "resolved",
      category: "Seguro",
    });
    expect(classifyNonEngineExpense("liguei para a seguradora")).toEqual({
      status: "resolved",
      category: "Seguro",
    });
  });
});

describe("non-engine heuristic classifier — regras especiais 'geral' e 'farol'", () => {
  it("retorna ambiguous com candidateCategories ['Lavagem'] para 'geral' sozinho", () => {
    expect(classifyNonEngineExpense("fiz uma geral no carro")).toEqual({
      status: "ambiguous",
      candidateCategories: ["Lavagem"],
    });
  });

  it("retorna ambiguous com Manutenção e Acessórios para 'farol' sozinho, sem qualificador", () => {
    const result = classifyNonEngineExpense("preciso trocar o farol");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidateCategories).toContain("Manutenção");
      expect(result.candidateCategories).toContain("Acessórios");
      expect(result.candidateCategories).toHaveLength(2);
    }
  });

  it("resolve Manutenção para 'farol queimado' (não ambíguo, tem qualificador)", () => {
    expect(classifyNonEngineExpense("o farol queimado")).toEqual({
      status: "resolved",
      category: "Manutenção",
    });
  });

  it("resolve Acessórios para 'farol decorativo'", () => {
    expect(classifyNonEngineExpense("instalei um farol decorativo")).toEqual({
      status: "resolved",
      category: "Acessórios",
    });
  });
});

describe("non-engine heuristic classifier — 'geral' cede para gatilhos de especificação de item", () => {
  it("resolve Lavagem direto para 'lavagem geral' (matched não é exclusivamente Manutenção)", () => {
    expect(classifyNonEngineExpense("lavagem geral")).toEqual({
      status: "resolved",
      category: "Lavagem",
    });
  });

  it("retorna unrecognized para 'conserto geral' (matched é só Manutenção — cede pro gatilho)", () => {
    expect(classifyNonEngineExpense("conserto geral")).toEqual({ status: "unrecognized" });
  });

  it("retorna unrecognized para 'revisão geral' (matched vazio + termo-gatilho 'revisao' presente)", () => {
    expect(classifyNonEngineExpense("revisão geral")).toEqual({ status: "unrecognized" });
  });

  it("retorna unrecognized para 'ar condicionado geral' (matched vazio + termo-gatilho presente)", () => {
    expect(classifyNonEngineExpense("ar condicionado geral")).toEqual({ status: "unrecognized" });
  });

  it("retorna unrecognized para 'manutenção geral no carro todo, revisei tudo mesmo, 500 reais' (caso original)", () => {
    expect(
      classifyNonEngineExpense("manutenção geral no carro todo, revisei tudo mesmo, 500 reais"),
    ).toEqual({ status: "unrecognized" });
  });

  it("mantém 'fiz uma geral no carro' inalterado (matched vazio, nenhum termo-gatilho — comportamento original)", () => {
    expect(classifyNonEngineExpense("fiz uma geral no carro")).toEqual({
      status: "ambiguous",
      candidateCategories: ["Lavagem"],
    });
  });
});

describe("non-engine heuristic classifier — ambiguidade por conflito entre categorias", () => {
  it("retorna ambiguous para 'pneu e som automotivo' (Manutenção + Acessórios)", () => {
    const result = classifyNonEngineExpense("pneu e som automotivo");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidateCategories).toContain("Manutenção");
      expect(result.candidateCategories).toContain("Acessórios");
    }
  });
});

describe("non-engine heuristic classifier — 'geral'/'farol' somam categorias em vez de substituir", () => {
  // Atualizado no P0-3B-R: "geral" agora cede para os gatilhos de
  // especificação de item / para de forçar ambiguidade quando `matched` já
  // contém uma categoria que NÃO é exclusivamente "Manutenção" (mesma regra
  // que faz "lavagem geral" resolver direto para Lavagem). "Multas" se
  // encaixa nessa mesma regra — resolve direto, sem mais somar Lavagem.
  it("resolve Multas direto em 'paguei a multa e fiz uma geral' ('geral' para de forçar ambiguidade fora do caso 'exclusivamente Manutenção')", () => {
    expect(classifyNonEngineExpense("paguei a multa e fiz uma geral")).toEqual({
      status: "resolved",
      category: "Multas",
    });
  });

  it("une IPVA com a lista fixa de 'farol' em 'paguei o ipva e vou trocar o farol'", () => {
    const result = classifyNonEngineExpense("paguei o ipva e vou trocar o farol");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidateCategories).toContain("IPVA");
      expect(result.candidateCategories).toContain("Manutenção");
      expect(result.candidateCategories).toContain("Acessórios");
      expect(result.candidateCategories).toHaveLength(3);
    }
  });

  it("retorna ambiguous para 'farol queimado e som automotivo' (Manutenção + Acessórios via dicionário normal, sem a regra especial de farol)", () => {
    const result = classifyNonEngineExpense("farol queimado e som automotivo");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidateCategories).toContain("Manutenção");
      expect(result.candidateCategories).toContain("Acessórios");
      expect(result.candidateCategories).toHaveLength(2);
    }
  });
});

describe("non-engine heuristic classifier — sinônimos adicionais (calibração round 2)", () => {
  it("resolve Manutenção para 'carga de gas' sozinho", () => {
    expect(classifyNonEngineExpense("fiz a carga de gas")).toEqual({
      status: "resolved",
      category: "Manutenção",
    });
  });

  it("resolve Manutenção para 'consertei o ar condicionado'", () => {
    expect(classifyNonEngineExpense("consertei o ar condicionado")).toEqual({
      status: "resolved",
      category: "Manutenção",
    });
  });

  it("resolve Combustível para 'enchi o tanque'", () => {
    expect(classifyNonEngineExpense("enchi o tanque")).toEqual({
      status: "resolved",
      category: "Combustível",
    });
  });
});

describe("non-engine heuristic classifier — não reconhecido e entradas vazias", () => {
  it("retorna unrecognized para texto sem nenhum termo reconhecido", () => {
    expect(classifyNonEngineExpense("aluguel do box da garagem")).toEqual({
      status: "unrecognized",
    });
  });

  it("retorna unrecognized para texto vazio, sem lançar erro", () => {
    expect(() => classifyNonEngineExpense("")).not.toThrow();
    expect(classifyNonEngineExpense("")).toEqual({ status: "unrecognized" });
  });

  it("retorna unrecognized para null e undefined, sem lançar erro", () => {
    expect(() => classifyNonEngineExpense(null as unknown as string)).not.toThrow();
    expect(classifyNonEngineExpense(null as unknown as string)).toEqual({
      status: "unrecognized",
    });
    expect(() => classifyNonEngineExpense(undefined as unknown as string)).not.toThrow();
    expect(classifyNonEngineExpense(undefined as unknown as string)).toEqual({
      status: "unrecognized",
    });
  });
});

describe("non-engine heuristic classifier — casos específicos do dicionário", () => {
  it("resolve Acessórios para 'kit gnv', sem conflito", () => {
    expect(classifyNonEngineExpense("troquei o kit gnv")).toEqual({
      status: "resolved",
      category: "Acessórios",
    });
  });

  it("resolve Manutenção para os itens excluídos do motor (peças reativas)", () => {
    const items = [
      "bico injetor",
      "caixa de direcao",
      "bomba de direcao",
      "bomba d'agua",
      "sensor map",
      "sonda lambda",
      "radiador",
    ];
    for (const item of items) {
      expect(classifyNonEngineExpense(`troquei o ${item}`)).toEqual({
        status: "resolved",
        category: "Manutenção",
      });
    }
  });
});

describe("non-engine heuristic classifier — gnv (fechamento de gap de escopo)", () => {
  it.each(["abasteci gnv", "coloquei gnv", "gnv 30"])("resolve Combustível para '%s'", (text) => {
    expect(classifyNonEngineExpense(text)).toEqual({
      status: "resolved",
      category: "Combustível",
    });
  });

  it("resolve Acessórios para 'kit gnv' sozinho, sem Combustível concorrendo", () => {
    expect(classifyNonEngineExpense("kit gnv")).toEqual({
      status: "resolved",
      category: "Acessórios",
    });
  });

  // Caso-limite: "kit gnv" (Acessórios) + "gnv" bare (suprimido pela regra especial,
  // ver matchesGnvFuel) NA MESMA frase que também contém "abasteci" — que já é, por
  // si só, um keyword de Combustível independente de "gnv" (CATEGORY_KEYWORDS.
  // Combustível já tinha "abasteci" antes deste build). Por isso o resultado é
  // "ambiguous" (Acessórios + Combustível) — não porque a regra especial do gnv
  // falhou em suprimir o bare "gnv", mas porque "abasteci" sozinho já dispara
  // Combustível de qualquer forma, com ou sem gnv. A supressão em si (gnv bare não
  // reforçar Combustível quando "kit gnv" está presente) é comprovada pelo teste
  // seguinte, com um verbo que NÃO é keyword de Combustível.
  it("'instalei o kit gnv, abasteci gnv' → ambiguous (Acessórios + Combustível, via 'abasteci' independente do gnv)", () => {
    expect(classifyNonEngineExpense("instalei o kit gnv, abasteci gnv")).toEqual({
      status: "ambiguous",
      candidateCategories: ["Acessórios", "Combustível"],
    });
  });

  it("'instalei o kit gnv, coloquei gnv' → resolved Acessórios (gnv bare suprimido pela regra especial, nenhum outro keyword de Combustível presente)", () => {
    expect(classifyNonEngineExpense("instalei o kit gnv, coloquei gnv")).toEqual({
      status: "resolved",
      category: "Acessórios",
    });
  });
});
