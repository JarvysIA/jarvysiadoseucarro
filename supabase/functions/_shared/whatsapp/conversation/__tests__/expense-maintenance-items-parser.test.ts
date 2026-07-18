import { describe, it, expect } from "bun:test";
import {
  parseMaintenanceItemsText,
  type MaintenanceItemsParseResult,
  type MaintenanceTriggerTag,
  type MaintenanceItemKey,
} from "../expense-maintenance-items-parser.ts";

type Expected = {
  items: ReadonlyArray<[MaintenanceTriggerTag, ReadonlyArray<MaintenanceItemKey>]>;
  ambiguousFilterMention: boolean;
};

function toShape(r: MaintenanceItemsParseResult): Expected {
  return {
    items: r.items.map((i) => [i.tag, i.itemKeys] as [MaintenanceTriggerTag, ReadonlyArray<MaintenanceItemKey>]),
    ambiguousFilterMention: r.ambiguousFilterMention,
  };
}

describe("parseMaintenanceItemsText", () => {
  it("1. 'troquei o óleo' sozinho → oleo + filtro_oleo", () => {
    expect(toShape(parseMaintenanceItemsText("troquei o óleo"))).toEqual({
      items: [["oleo", ["oleo_motor", "filtro_oleo"]]],
      ambiguousFilterMention: false,
    });
  });

  it("2. 'troca de óleo e filtro de óleo'", () => {
    expect(toShape(parseMaintenanceItemsText("troca de óleo e filtro de óleo"))).toEqual({
      items: [["oleo", ["oleo_motor", "filtro_oleo"]]],
      ambiguousFilterMention: false,
    });
  });

  it("3. 'óleo, filtro de ar e pastilha de freio'", () => {
    expect(toShape(parseMaintenanceItemsText("óleo, filtro de ar e pastilha de freio"))).toEqual({
      items: [
        ["oleo", ["oleo_motor", "filtro_oleo"]],
        ["filtro", ["filtro_ar_motor"]],
        ["pastilha", ["pastilhas_freio"]],
      ],
      ambiguousFilterMention: false,
    });
  });

  it("4. 'revisão dos 40 mil, óleo, filtros e aditivo do radiador'", () => {
    expect(
      toShape(parseMaintenanceItemsText("revisão dos 40 mil, óleo, filtros e aditivo do radiador")),
    ).toEqual({
      items: [
        ["oleo", ["oleo_motor", "filtro_oleo"]],
        ["filtro", ["filtro_ar_motor", "filtro_cabine", "filtro_combustivel"]],
        ["arrefecimento", ["aditivo_radiador"]],
      ],
      ambiguousFilterMention: false,
    });
  });

  it("5. 'revisão completa' → vazio", () => {
    expect(toShape(parseMaintenanceItemsText("revisão completa"))).toEqual({
      items: [],
      ambiguousFilterMention: false,
    });
  });

  it("6. 'aditivo do radiador'", () => {
    expect(toShape(parseMaintenanceItemsText("aditivo do radiador"))).toEqual({
      items: [["arrefecimento", ["aditivo_radiador"]]],
      ambiguousFilterMention: false,
    });
  });

  it("7. 'paguei o mecânico' → vazio", () => {
    expect(toShape(parseMaintenanceItemsText("paguei o mecânico"))).toEqual({
      items: [],
      ambiguousFilterMention: false,
    });
  });

  it("8. 'troquei o filtro' sozinho → ambíguo", () => {
    expect(toShape(parseMaintenanceItemsText("troquei o filtro"))).toEqual({
      items: [],
      ambiguousFilterMention: true,
    });
  });

  it("9. 'troquei os filtros' (plural, sem óleo)", () => {
    expect(toShape(parseMaintenanceItemsText("troquei os filtros"))).toEqual({
      items: [["filtro", ["filtro_ar_motor", "filtro_cabine", "filtro_combustivel"]]],
      ambiguousFilterMention: false,
    });
  });

  it("10. 'limpeza do sistema de arrefecimento'", () => {
    expect(toShape(parseMaintenanceItemsText("limpeza do sistema de arrefecimento"))).toEqual({
      items: [["arrefecimento", ["aditivo_radiador", "limpeza_arrefecimento"]]],
      ambiguousFilterMention: false,
    });
  });

  it("11. 'filtro do ar condicionado'", () => {
    expect(toShape(parseMaintenanceItemsText("filtro do ar condicionado"))).toEqual({
      items: [["filtro", ["filtro_ar_motor", "filtro_cabine"]]],
      ambiguousFilterMention: false,
    });
  });

  it("12. null/undefined/vazio/espaços → sempre vazio", () => {
    for (const inp of [null, undefined, "", "   "] as const) {
      const r = parseMaintenanceItemsText(inp);
      expect(r.items).toEqual([]);
      expect(r.tagsSuffix).toBe("");
      expect(r.ambiguousFilterMention).toBe(false);
    }
  });

  it("13. 'ÓLEO E FILTRO DE ÓLEO' (maiúsculas) → igual ao caso 2", () => {
    expect(toShape(parseMaintenanceItemsText("ÓLEO E FILTRO DE ÓLEO"))).toEqual({
      items: [["oleo", ["oleo_motor", "filtro_oleo"]]],
      ambiguousFilterMention: false,
    });
  });

  it("14. ordem invertida no texto → ordem TAG_ORDER na saída", () => {
    const r = parseMaintenanceItemsText("aditivo do radiador e troquei o óleo");
    expect(r.items.map((i) => i.tag)).toEqual(["oleo", "arrefecimento"]);
  });

  it("15. 'Manutenção, troquei o filtro, 30 reais' → ambíguo", () => {
    expect(toShape(parseMaintenanceItemsText("Manutenção, troquei o filtro, 30 reais"))).toEqual({
      items: [],
      ambiguousFilterMention: true,
    });
  });

  it("16. 'troquei o filtro de óleo' → só oleo bucket", () => {
    expect(toShape(parseMaintenanceItemsText("troquei o filtro de óleo"))).toEqual({
      items: [["oleo", ["oleo_motor", "filtro_oleo"]]],
      ambiguousFilterMention: false,
    });
  });

  it("17. 'troquei os filtros' → plural nunca é ambíguo", () => {
    expect(parseMaintenanceItemsText("troquei os filtros").ambiguousFilterMention).toBe(false);
  });

  it("18. 'troquei o óleo e o filtro' → só oleo bucket, não ambíguo", () => {
    expect(toShape(parseMaintenanceItemsText("troquei o óleo e o filtro"))).toEqual({
      items: [["oleo", ["oleo_motor", "filtro_oleo"]]],
      ambiguousFilterMention: false,
    });
  });

  it("19. 'troquei o óleo e os filtros' → oleo + todos os filtros", () => {
    expect(toShape(parseMaintenanceItemsText("troquei o óleo e os filtros"))).toEqual({
      items: [
        ["oleo", ["oleo_motor", "filtro_oleo"]],
        ["filtro", ["filtro_ar_motor", "filtro_cabine", "filtro_combustivel"]],
      ],
      ambiguousFilterMention: false,
    });
  });

  it("20. 'troquei o óleo e o filtro de ar' → oleo (com filtro_oleo) + filtro_ar_motor", () => {
    expect(toShape(parseMaintenanceItemsText("troquei o óleo e o filtro de ar"))).toEqual({
      items: [
        ["oleo", ["oleo_motor", "filtro_oleo"]],
        ["filtro", ["filtro_ar_motor"]],
      ],
      ambiguousFilterMention: false,
    });
  });

  it("21. 'troquei os filtros' sem óleo → sem filtro_oleo", () => {
    const r = parseMaintenanceItemsText("troquei os filtros");
    const filtro = r.items.find((i) => i.tag === "filtro");
    expect(filtro?.itemKeys).toEqual(["filtro_ar_motor", "filtro_cabine", "filtro_combustivel"]);
    expect(r.items.find((i) => i.tag === "oleo")).toBeUndefined();
  });

  it("tagsSuffix formatting", () => {
    expect(parseMaintenanceItemsText("óleo, filtro de ar, pastilha, radiador").tagsSuffix).toBe(
      " [oleo] [filtro] [pastilha] [arrefecimento]",
    );
    expect(parseMaintenanceItemsText("nada aqui").tagsSuffix).toBe("");
  });
});
