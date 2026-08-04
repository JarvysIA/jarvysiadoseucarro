import { describe, expect, it } from "bun:test";
import { recognizeEngineConcepts } from "../engine-concept-recognizer.ts";

describe("engine concept recognizer — reconhecimento por conceito individual (Revisão)", () => {
  it("reconhece engine_oil por 'troca de oleo' e 'lubrificante'", () => {
    expect(recognizeEngineConcepts("fiz a troca de oleo hoje")).toContain("engine_oil");
    expect(recognizeEngineConcepts("troquei o lubrificante do motor")).toContain("engine_oil");
  });

  it("reconhece engine_oil_filter por 'filtro de oleo' e 'filtro do oleo do motor'", () => {
    expect(recognizeEngineConcepts("troquei o filtro de oleo")).toContain("engine_oil_filter");
    expect(recognizeEngineConcepts("troquei o filtro do oleo do motor")).toContain(
      "engine_oil_filter",
    );
  });

  it("reconhece transmission_fluid por 'oleo do cambio' e 'fluido da transmissao'", () => {
    expect(recognizeEngineConcepts("troquei o oleo do cambio")).toContain("transmission_fluid");
    expect(recognizeEngineConcepts("troquei o fluido da transmissao")).toContain(
      "transmission_fluid",
    );
  });

  it("reconhece brake_pads por 'pastilha de freio' e 'sangria de freio'", () => {
    expect(recognizeEngineConcepts("troquei a pastilha de freio")).toContain("brake_pads");
    expect(recognizeEngineConcepts("fiz a sangria de freio")).toContain("brake_pads");
  });

  it("reconhece engine_air_filter por 'filtro de ar' e 'filtro do ar'", () => {
    expect(recognizeEngineConcepts("troquei o filtro de ar")).toContain("engine_air_filter");
    expect(recognizeEngineConcepts("troquei o filtro do ar")).toContain("engine_air_filter");
  });

  it("reconhece cabin_filter por 'filtro de cabine' e 'filtro do ar-condicionado'", () => {
    expect(recognizeEngineConcepts("troquei o filtro de cabine")).toContain("cabin_filter");
    expect(recognizeEngineConcepts("troquei o filtro do ar-condicionado")).toContain(
      "cabin_filter",
    );
  });

  it("reconhece fuel_filter por 'filtro de combustivel' e 'filtro de diesel'", () => {
    expect(recognizeEngineConcepts("troquei o filtro de combustivel")).toContain("fuel_filter");
    expect(recognizeEngineConcepts("troquei o filtro de diesel")).toContain("fuel_filter");
  });

  it("reconhece timing_kit por 'kit sincronismo' e 'correia dentada'", () => {
    expect(recognizeEngineConcepts("troquei o kit sincronismo")).toContain("timing_kit");
    expect(recognizeEngineConcepts("troquei a correia dentada")).toContain("timing_kit");
  });

  it("reconhece spark_and_injection por 'vela de ignicao' e 'bobina'", () => {
    expect(recognizeEngineConcepts("troquei a vela de ignicao")).toContain("spark_and_injection");
    expect(recognizeEngineConcepts("troquei a bobina")).toContain("spark_and_injection");
  });

  it("reconhece suspension por 'suspensao' e 'amortecedor'", () => {
    expect(recognizeEngineConcepts("revisei a suspensao")).toContain("suspension");
    expect(recognizeEngineConcepts("troquei o amortecedor")).toContain("suspension");
  });

  it("reconhece wiper_blades por 'palheta do limpador' e 'borracha do limpador'", () => {
    expect(recognizeEngineConcepts("troquei a palheta do limpador")).toContain("wiper_blades");
    expect(recognizeEngineConcepts("troquei a borracha do limpador")).toContain("wiper_blades");
  });

  it("reconhece wheel_alignment por 'alinhamento' e 'balanceamento'", () => {
    expect(recognizeEngineConcepts("fiz o alinhamento")).toContain("wheel_alignment");
    expect(recognizeEngineConcepts("fiz o balanceamento")).toContain("wheel_alignment");
  });

  it("reconhece power_steering_fluid por 'direcao hidraulica' e 'fluido da direcao'", () => {
    expect(recognizeEngineConcepts("troquei o oleo da direcao hidraulica")).toContain(
      "power_steering_fluid",
    );
    expect(recognizeEngineConcepts("troquei o fluido da direcao")).toContain(
      "power_steering_fluid",
    );
  });

  it("reconhece hybrid_ecvt_diagnostic por 'diagnostico e-cvt' e 'scanner do hibrido'", () => {
    expect(recognizeEngineConcepts("fiz o diagnostico e-cvt")).toContain("hybrid_ecvt_diagnostic");
    expect(recognizeEngineConcepts("fiz o scanner do hibrido")).toContain("hybrid_ecvt_diagnostic");
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
