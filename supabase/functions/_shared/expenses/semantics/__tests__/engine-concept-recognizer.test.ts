import { describe, expect, it } from "bun:test";
import { recognizeEngineConcepts } from "../engine-concept-recognizer.ts";

describe("engine concept recognizer — reconhecimento por conceito individual (Revisão)", () => {
  it("reconhece engine_oil por 'troca de oleo' e 'lubrificante'", () => {
    expect(recognizeEngineConcepts("fiz a troca de oleo hoje")).toEqual(["engine_oil"]);
    expect(recognizeEngineConcepts("troquei o lubrificante do motor")).toEqual(["engine_oil"]);
  });

  it("reconhece engine_oil_filter por 'filtro de oleo' e 'filtro do oleo do motor' (junto com engine_oil, pois ambos os textos também contêm a palavra 'oleo')", () => {
    expect(recognizeEngineConcepts("troquei o filtro de oleo")).toEqual([
      "engine_oil",
      "engine_oil_filter",
    ]);
    expect(recognizeEngineConcepts("troquei o filtro do oleo do motor")).toEqual([
      "engine_oil",
      "engine_oil_filter",
    ]);
  });

  it("reconhece transmission_fluid por 'oleo do cambio' e 'fluido da transmissao' (sem falso positivo de engine_oil)", () => {
    expect(recognizeEngineConcepts("troquei o oleo do cambio")).toEqual(["transmission_fluid"]);
    expect(recognizeEngineConcepts("troquei o fluido da transmissao")).toEqual([
      "transmission_fluid",
    ]);
  });

  it("reconhece brake_pads por 'pastilha de freio' e 'sangria de freio'", () => {
    expect(recognizeEngineConcepts("troquei a pastilha de freio")).toEqual(["brake_pads"]);
    expect(recognizeEngineConcepts("fiz a sangria de freio")).toEqual(["brake_pads"]);
  });

  it("reconhece engine_air_filter por 'filtro de ar' e 'filtro do ar'", () => {
    expect(recognizeEngineConcepts("troquei o filtro de ar")).toEqual(["engine_air_filter"]);
    expect(recognizeEngineConcepts("troquei o filtro do ar")).toEqual(["engine_air_filter"]);
  });

  it("reconhece cabin_filter por 'filtro de cabine' e 'filtro do ar-condicionado' (sem falso positivo de engine_air_filter)", () => {
    expect(recognizeEngineConcepts("troquei o filtro de cabine")).toEqual(["cabin_filter"]);
    expect(recognizeEngineConcepts("troquei o filtro do ar-condicionado")).toEqual([
      "cabin_filter",
    ]);
  });

  it("reconhece fuel_filter por 'filtro de combustivel' e 'filtro de diesel'", () => {
    expect(recognizeEngineConcepts("troquei o filtro de combustivel")).toEqual(["fuel_filter"]);
    expect(recognizeEngineConcepts("troquei o filtro de diesel")).toEqual(["fuel_filter"]);
  });

  it("reconhece timing_kit por 'kit sincronismo' e 'correia dentada'", () => {
    expect(recognizeEngineConcepts("troquei o kit sincronismo")).toEqual(["timing_kit"]);
    expect(recognizeEngineConcepts("troquei a correia dentada")).toEqual(["timing_kit"]);
  });

  it("reconhece spark_and_injection por 'vela de ignicao' e 'bobina'", () => {
    expect(recognizeEngineConcepts("troquei a vela de ignicao")).toEqual(["spark_and_injection"]);
    expect(recognizeEngineConcepts("troquei a bobina")).toEqual(["spark_and_injection"]);
  });

  it("reconhece suspension por 'suspensao' e 'amortecedor'", () => {
    expect(recognizeEngineConcepts("revisei a suspensao")).toEqual(["suspension"]);
    expect(recognizeEngineConcepts("troquei o amortecedor")).toEqual(["suspension"]);
  });

  it("reconhece wiper_blades por 'palheta do limpador' e 'borracha do limpador'", () => {
    expect(recognizeEngineConcepts("troquei a palheta do limpador")).toEqual(["wiper_blades"]);
    expect(recognizeEngineConcepts("troquei a borracha do limpador")).toEqual(["wiper_blades"]);
  });

  it("reconhece wheel_alignment por 'alinhamento' e 'balanceamento'", () => {
    expect(recognizeEngineConcepts("fiz o alinhamento")).toEqual(["wheel_alignment"]);
    expect(recognizeEngineConcepts("fiz o balanceamento")).toEqual(["wheel_alignment"]);
  });

  it("reconhece power_steering_fluid por 'direcao hidraulica' e 'fluido da direcao' (sem falso positivo de engine_oil)", () => {
    expect(recognizeEngineConcepts("troquei o oleo da direcao hidraulica")).toEqual([
      "power_steering_fluid",
    ]);
    expect(recognizeEngineConcepts("troquei o fluido da direcao")).toEqual([
      "power_steering_fluid",
    ]);
  });

  it("reconhece hybrid_ecvt_diagnostic por 'diagnostico e-cvt' e 'scanner do hibrido'", () => {
    expect(recognizeEngineConcepts("fiz o diagnostico e-cvt")).toEqual(["hybrid_ecvt_diagnostic"]);
    expect(recognizeEngineConcepts("fiz o scanner do hibrido")).toEqual(["hybrid_ecvt_diagnostic"]);
  });
});

describe("engine concept recognizer — exceção da palavra solta 'oleo' (evita falso positivo com cambio/direcao)", () => {
  it("reconhece APENAS transmission_fluid para 'troquei o oleo do cambio'", () => {
    expect(recognizeEngineConcepts("troquei o oleo do cambio")).toEqual(["transmission_fluid"]);
  });

  it("reconhece APENAS power_steering_fluid para 'oleo da direcao hidraulica'", () => {
    expect(recognizeEngineConcepts("oleo da direcao hidraulica")).toEqual(["power_steering_fluid"]);
  });

  it("reconhece APENAS engine_oil para 'troquei o oleo' sozinho", () => {
    expect(recognizeEngineConcepts("troquei o oleo")).toEqual(["engine_oil"]);
  });

  it("reconhece AMBOS engine_oil e transmission_fluid quando o termo específico 'oleo do motor' aparece junto de 'oleo do cambio'", () => {
    expect(recognizeEngineConcepts("troquei o oleo do motor e o oleo do cambio")).toEqual([
      "engine_oil",
      "transmission_fluid",
    ]);
  });
});

describe("engine concept recognizer — exceção de 'filtro do ar' (evita falso positivo com cabin_filter)", () => {
  it("reconhece AMBOS engine_air_filter e cabin_filter quando mencionados explicitamente e separados", () => {
    expect(recognizeEngineConcepts("troquei o filtro de ar e o filtro de cabine")).toEqual([
      "engine_air_filter",
      "cabin_filter",
    ]);
  });
});

describe("engine concept recognizer — múltiplos conceitos e regra especial cooling_system", () => {
  it("reconhece múltiplos conceitos na mesma mensagem", () => {
    expect(recognizeEngineConcepts("troquei oleo e filtro de ar")).toEqual([
      "engine_oil",
      "engine_air_filter",
    ]);
  });

  it("não reconhece cooling_system quando 'radiador' aparece sozinho", () => {
    expect(recognizeEngineConcepts("vou trocar o radiador")).toEqual([]);
  });

  it("reconhece cooling_system quando 'radiador' aparece com 'aditivo'", () => {
    expect(recognizeEngineConcepts("troquei o aditivo do radiador")).toEqual(["cooling_system"]);
  });

  it("reconhece cooling_system quando 'radiador' aparece com 'arrefecimento'", () => {
    expect(
      recognizeEngineConcepts("fiz manutencao no radiador do sistema de arrefecimento"),
    ).toEqual(["cooling_system"]);
  });

  it("reconhece brake_pads por 'freio' sozinho, sem qualificador", () => {
    expect(recognizeEngineConcepts("troquei o freio")).toEqual(["brake_pads"]);
  });
});

describe("engine concept recognizer — exclusões explícitas", () => {
  it("não reconhece nenhum conceito para 'bico injetor' sozinho", () => {
    expect(recognizeEngineConcepts("troquei o bico injetor")).toEqual([]);
  });

  it("não reconhece power_steering_fluid para 'caixa de direcao' nem 'bomba de direcao'", () => {
    expect(recognizeEngineConcepts("trocar a caixa de direcao")).toEqual([]);
    expect(recognizeEngineConcepts("trocar a bomba de direcao")).toEqual([]);
  });

  it("não reconhece cooling_system nem nenhum outro conceito para 'bomba d'agua'", () => {
    expect(recognizeEngineConcepts("troquei a bomba d'agua")).toEqual([]);
    expect(recognizeEngineConcepts("troquei a bomba de agua")).toEqual([]);
  });
});

describe("engine concept recognizer — sinônimos adicionais (calibração round 2)", () => {
  it("reconhece suspension por 'bucha', 'buchas' e 'batente' sozinhos", () => {
    expect(recognizeEngineConcepts("troquei a bucha")).toEqual(["suspension"]);
    expect(recognizeEngineConcepts("troquei as buchas")).toEqual(["suspension"]);
    expect(recognizeEngineConcepts("troquei o batente")).toEqual(["suspension"]);
  });

  it("reconhece timing_kit por 'correia' sozinha", () => {
    expect(recognizeEngineConcepts("troquei a correia")).toEqual(["timing_kit"]);
  });
});

describe("engine concept recognizer — entradas vazias e sem conceito", () => {
  it("retorna lista vazia para texto sem nenhum conceito de motor", () => {
    expect(recognizeEngineConcepts("capa de banco 140 reais")).toEqual([]);
  });

  it("retorna lista vazia para texto vazio, sem lançar erro", () => {
    expect(() => recognizeEngineConcepts("")).not.toThrow();
    expect(recognizeEngineConcepts("")).toEqual([]);
  });

  it("retorna lista vazia para null e undefined, sem lançar erro", () => {
    expect(() => recognizeEngineConcepts(null as unknown as string)).not.toThrow();
    expect(recognizeEngineConcepts(null as unknown as string)).toEqual([]);
    expect(() => recognizeEngineConcepts(undefined as unknown as string)).not.toThrow();
    expect(recognizeEngineConcepts(undefined as unknown as string)).toEqual([]);
  });
});
