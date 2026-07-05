// Build 6.46 — Testes do helper puro de agrupamento visual/comercial Jarvys.

import { describe, test, expect } from "bun:test";
import type { JarvysItem } from "../maintenance-jarvys-schedule-rules";
import { buildJarvysVisualGroups } from "../maintenance-visual-groups";

type Overrides = Partial<JarvysItem>;

function makeItem(
  item_key: string,
  label: string,
  overrides: Overrides = {},
): JarvysItem {
  return {
    item_key,
    label,
    category: "motor",
    action: "trocar",
    recommendation_type: "required",
    shopping_classification: "buyable_generic",
    applies: true,
    confidence: 90,
    source_type: "experiencia_preventiva",
    group_key: null,
    requires_confirmation: false,
    ...overrides,
  } as JarvysItem;
}

describe("buildJarvysVisualGroups — óleo + filtro de óleo", () => {
  test("agrupa em oil_and_oil_filter sem duplicar", () => {
    const items = [
      makeItem("oleo_motor", "Óleo do motor 5W30"),
      makeItem("filtro_oleo", "Filtro de óleo"),
    ];
    const groups = buildJarvysVisualGroups(items);
    expect(groups.length).toBe(1);
    const g = groups[0]!;
    expect(g.kind).toBe("oil_and_oil_filter");
    expect(g.title).toBe("Óleo e filtro de óleo");
    expect(g.icon).toBe("droplet");
    expect(g.description).toBe("Óleo do motor + filtro de óleo");
    expect(g.sourceItems.length).toBe(2);
    expect(g.sourceItemKeys.join(",")).toBe("oleo_motor,filtro_oleo");
    expect(g.linkItemTitle).toBe("Óleo e filtro de óleo");
    expect(g.isServiceOnly).toBe(false);
  });
});

describe("buildJarvysVisualGroups — Kit filtros", () => {
  test("ar + cabine + combustível", () => {
    const items = [
      makeItem("filtro_ar_motor", "Filtro de ar do motor"),
      makeItem("filtro_cabine", "Filtro de cabine"),
      makeItem("filtro_combustivel", "Filtro de combustível"),
    ];
    const g = buildJarvysVisualGroups(items)[0]!;
    expect(g.kind).toBe("filters_kit");
    expect(g.icon).toBe("wind");
    expect(g.description).toBe("Filtro de ar, cabine e combustível");
  });

  test("apenas cabine — não inventa outros", () => {
    const g = buildJarvysVisualGroups([
      makeItem("filtro_cabine", "Filtro de cabine"),
    ])[0]!;
    expect(g.title).toBe("Kit filtros");
    expect(g.description).toBe("Filtro de cabine");
    expect(g.description!.includes("ar")).toBe(false);
    expect(g.description!.includes("combust")).toBe(false);
  });
});

describe("buildJarvysVisualGroups — freio", () => {
  test("pastilhas + discos", () => {
    const g = buildJarvysVisualGroups([
      makeItem("pastilhas_freio", "Pastilhas de freio"),
      makeItem("discos_freio", "Discos de freio"),
    ])[0]!;
    expect(g.kind).toBe("brake_pads_discs");
    expect(g.icon).toBe("disc3");
    expect(g.title).toBe("Pastilhas e discos de freio");
    expect(g.linkItemTitle).toBe("Pastilhas e discos de freio");
  });

  test("só pastilhas", () => {
    const g = buildJarvysVisualGroups([
      makeItem("pastilhas_freio", "Pastilhas de freio"),
    ])[0]!;
    expect(g.title).toBe("Pastilhas de freio");
    expect(g.linkItemTitle).toBe("Pastilhas de freio");
  });
});

describe("buildJarvysVisualGroups — sincronismo / velas / arrefecimento", () => {
  test("kit sincronismo", () => {
    const g = buildJarvysVisualGroups([
      makeItem("kit_sincronismo", "Correia dentada + tensor + rolamento"),
    ])[0]!;
    expect(g.kind).toBe("timing_kit");
    expect(g.title).toBe("Troca do kit sincronismo");
    expect(g.linkItemTitle).toBe("Kit sincronismo");
    expect(g.icon).toBe("wrench");
  });

  test("velas / cabos / bobina", () => {
    const g = buildJarvysVisualGroups([
      makeItem("velas_ignicao", "Velas de ignição"),
      makeItem("cabos_vela", "Cabos de vela"),
      makeItem("bobina_ignicao", "Bobina de ignição"),
    ])[0]!;
    expect(g.kind).toBe("spark_plugs_cables");
    expect(g.title).toBe("Velas e cabos");
    expect(g.sourceItems.length).toBe(3);
  });

  test("aditivo/arrefecimento", () => {
    const g = buildJarvysVisualGroups([
      makeItem("aditivo_radiador", "Aditivo do radiador"),
      makeItem("limpeza_arrefecimento", "Limpeza do sistema de arrefecimento"),
    ])[0]!;
    expect(g.kind).toBe("coolant_additive");
    expect(g.title).toBe("Aditivo de arrefecimento");
    expect(g.icon).toBe("snowflake");
  });
});

describe("buildJarvysVisualGroups — fallback individual e service_only", () => {
  test("item desconhecido vira individual", () => {
    const g = buildJarvysVisualGroups([
      makeItem("palhetas", "Palhetas do limpador"),
    ])[0]!;
    expect(g.kind).toBe("individual");
    expect(g.title).toBe("Palhetas do limpador");
    expect(g.icon).toBe("wrench");
  });

  test("service_only puro — inspect_only → Inspeção em oficina", () => {
    const g = buildJarvysVisualGroups([
      makeItem("inspecao_suspensao", "Inspeção da suspensão", {
        shopping_classification: "service_only",
        recommendation_type: "inspect_only",
      }),
    ])[0]!;
    expect(g.isServiceOnly).toBe(true);
    expect(g.kind).toBe("service_only");
    expect(g.serviceBadgeLabel).toBe("Inspeção em oficina");
  });

  test("service_only puro — outro tipo → Serviço especializado", () => {
    const g = buildJarvysVisualGroups([
      makeItem("alinhamento_balanceamento", "Alinhamento e balanceamento", {
        shopping_classification: "service_only",
        recommendation_type: "required",
      }),
    ])[0]!;
    expect(g.isServiceOnly).toBe(true);
    expect(g.serviceBadgeLabel).toBe("Serviço especializado");
  });

  test("grupo misto — comprável + service_only", () => {
    // Pastilhas compráveis + discos como service_only compõem grupo misto de freio.
    const g = buildJarvysVisualGroups([
      makeItem("pastilhas_freio", "Pastilhas de freio"),
      makeItem("discos_freio", "Discos de freio (retificar)", {
        shopping_classification: "service_only",
        recommendation_type: "required",
      }),
    ])[0]!;
    expect(g.isServiceOnly).toBe(false);
    expect(g.hasMixedServiceItems).toBe(true);
    expect((g.serviceItemLabels ?? []).join("|")).toBe(
      "Discos de freio (retificar)",
    );
  });
});

describe("buildJarvysVisualGroups — ordem e anti-duplicidade", () => {
  test("ordem visual: óleo, filtros, freio, sincronismo, velas, arrefecimento, individuais, serviços", () => {
    const items = [
      makeItem("palhetas", "Palhetas"),
      makeItem("aditivo_radiador", "Aditivo do radiador"),
      makeItem("velas_ignicao", "Velas de ignição"),
      makeItem("kit_sincronismo", "Kit sincronismo"),
      makeItem("pastilhas_freio", "Pastilhas de freio"),
      makeItem("filtro_ar_motor", "Filtro de ar do motor"),
      makeItem("oleo_motor", "Óleo do motor"),
      makeItem("inspecao_suspensao", "Inspeção da suspensão", {
        shopping_classification: "service_only",
        recommendation_type: "inspect_only",
      }),
    ];
    const kinds = buildJarvysVisualGroups(items).map((g) => g.kind);
    expect(kinds).toEqual([
      "oil_and_oil_filter",
      "filters_kit",
      "brake_pads_discs",
      "timing_kit",
      "spark_plugs_cables",
      "coolant_additive",
      "individual",
      "service_only",
    ]);
  });

  test("item consumido não reaparece como fallback", () => {
    const groups = buildJarvysVisualGroups([
      makeItem("oleo_motor", "Óleo do motor"),
      makeItem("filtro_oleo", "Filtro de óleo"),
    ]);
    expect(groups.length).toBe(1);
    const allKeys = groups.flatMap((g) => g.sourceItemKeys);
    expect(allKeys.length).toBe(new Set(allKeys).size);
  });

  test("normalização — acentos/underscore/hífen/uppercase", () => {
    const g = buildJarvysVisualGroups([
      makeItem("OLEO-DO-MOTOR", "ÓLEO DO MOTOR 5W30"),
      makeItem("FILTRO_DE_OLEO", "FILTRO_DE_ÓLEO"),
    ])[0]!;
    expect(g.kind).toBe("oil_and_oil_filter");
    expect(g.sourceItems.length).toBe(2);
  });
});
