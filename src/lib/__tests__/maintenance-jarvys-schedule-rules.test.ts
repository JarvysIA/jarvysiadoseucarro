// Build 6.42F — Testes determinísticos do motor Jarvys.
//
// Suíte de blindagem: garante que o helper puro
// `src/lib/maintenance-jarvys-schedule-rules.ts` não regrida em:
//  - matriz baseline (óleo/filtro/filtros/freios/arrefecimento/ignição);
//  - regras de sincronismo (dentada × corrente × banhada);
//  - regras de câmbio (manual × automático × e-CVT);
//  - regras de direção (elétrica × hidráulica);
//  - matriz elétrica (BYD Dolphin);
//  - ciclo infinito acima de 200.000 km.
//
// Runner: `bun test` (nativo, sem dependências novas).
// Não altera o helper. Se algum assert de nota editorial falhar, a
// mensagem indica a lacuna sem tocar em produção.

// Runner: bun test. Shim de tipos em ./bun-test.d.ts (sem instalar bun-types).
import { describe, test, expect } from "bun:test";
import {
  HIGH_MILEAGE_NOTE,
  buildJarvysMilestone,
  buildJarvysScheduleRange,
  getJarvysBaseMilestoneItems,
  isDeterministicRevisionItem,
  mapRealKmToBaseKm,
  type JarvysMilestone,
  type JarvysVehicleProfile,
} from "../maintenance-jarvys-schedule-rules";

// ─────────────────────────────────────────────────────────────
// Fixtures — 8 perfis oficiais do brief 6.42F
// ─────────────────────────────────────────────────────────────

const PROFILES = {
  argoFireflyCorrente: {
    fuelKind: "combustao",
    timingSystem: "corrente",
    transmissionKind: "manual",
    steeringKind: "eletrica",
  },
  peugeot208Banhada: {
    fuelKind: "combustao",
    timingSystem: "correia_banhada",
    transmissionKind: "manual",
    steeringKind: "eletrica",
  },
  onixTurboBanhadaAT: {
    fuelKind: "combustao",
    timingSystem: "correia_banhada",
    transmissionKind: "automatico",
    steeringKind: "eletrica",
  },
  bydSongDMi: {
    fuelKind: "hibrido_combustao",
    timingSystem: "corrente",
    transmissionKind: "e_cvt",
    steeringKind: "eletrica",
  },
  corollaHibrido: {
    fuelKind: "hibrido_combustao",
    timingSystem: "corrente",
    transmissionKind: "e_cvt",
    steeringKind: "eletrica",
  },
  hiluxDieselAT: {
    fuelKind: "combustao",
    timingSystem: "corrente",
    transmissionKind: "automatico",
    steeringKind: "hidraulica",
  },
  bmw320iAT: {
    fuelKind: "combustao",
    timingSystem: "corrente",
    transmissionKind: "automatico",
    steeringKind: "eletrica",
  },
  bydDolphinEV: {
    fuelKind: "eletrico_puro",
    timingSystem: "desconhecido",
    transmissionKind: "desconhecido",
    steeringKind: "eletrica",
  },
} as const satisfies Record<string, JarvysVehicleProfile>;

const KM_MATRIX = [
  10000, 20000, 40000, 60000, 80000, 90000, 120000, 130000, 160000, 180000, 200000, 220000, 260000,
  410000,
] as const;

// ─────────────────────────────────────────────────────────────
// Listas de itens proibidos por eixo do perfil
// ─────────────────────────────────────────────────────────────

const FORBIDDEN_KIT_SINCRONISMO = ["kit_sincronismo"] as const;
const FORBIDDEN_AUTO_TRANSMISSION_ITEMS = ["oleo_cambio_automatico"] as const;
const FORBIDDEN_HYDRAULIC_STEERING = ["oleo_direcao_hidraulica"] as const;
const FORBIDDEN_E_CVT_ITEMS = ["oleo_cambio_automatico"] as const;

const FORBIDDEN_EV_ITEMS = [
  // Motor combustão
  "oleo_motor",
  "filtro_oleo",
  "filtro_ar_motor",
  "filtro_combustivel",
  // Ignição
  "velas_ignicao",
  "limpeza_tbi_bicos",
  // Sincronismo / correias de motor a combustão
  "kit_sincronismo",
  "inspecao_corrente_comando",
  "correia_banhada",
  "inspecao_correia_banhada",
  "correia_poly_v",
  // Câmbios de combustão
  "oleo_cambio_manual",
  "oleo_cambio_automatico",
  "diagnostico_e_cvt",
  // Direção hidráulica
  "oleo_direcao_hidraulica",
] as const;

// ─────────────────────────────────────────────────────────────
// Helpers de assert
// ─────────────────────────────────────────────────────────────

function itemKeys(m: JarvysMilestone): string[] {
  return m.items.map((i) => i.item_key);
}

function expectHasItems(m: JarvysMilestone, keys: readonly string[], ctx: string) {
  const present = new Set(itemKeys(m));
  const missing = keys.filter((k) => !present.has(k));
  if (missing.length > 0) {
    throw new Error(
      `[${ctx}] km=${m.revisionKmReal} (base=${m.revisionKmBase}) faltando itens: ${missing.join(", ")}. Presentes: ${[...present].join(", ")}`,
    );
  }
}

function expectNotHasItems(m: JarvysMilestone, keys: readonly string[], ctx: string) {
  const present = new Set(itemKeys(m));
  const leaked = keys.filter((k) => present.has(k));
  if (leaked.length > 0) {
    throw new Error(
      `[${ctx}] km=${m.revisionKmReal} (base=${m.revisionKmBase}) contém itens proibidos: ${leaked.join(", ")}`,
    );
  }
}

function allNotesText(m: JarvysMilestone): string {
  const itemNotes = m.items.flatMap((i) => i.notes ?? []);
  return [...m.notes, ...itemNotes].join(" | ").toLowerCase();
}

function findItem(m: JarvysMilestone, key: string) {
  return m.items.find((i) => i.item_key === key);
}

function itemNotesText(m: JarvysMilestone, key: string): string {
  const it = findItem(m, key);
  if (!it) return "";
  return (it.notes ?? []).join(" | ").toLowerCase();
}

// Constrói milestones para todos os KMs de teste do perfil
function buildAll(profile: JarvysVehicleProfile): JarvysMilestone[] {
  return KM_MATRIX.map((km) => buildJarvysMilestone(km, profile));
}

// Perfis suficientes para materializar todas as factories do catalogo atual.
const CATALOG_PROFILES: readonly JarvysVehicleProfile[] = [
  ...Object.values(PROFILES),
  {
    fuelKind: "combustao",
    timingSystem: "correia_dentada",
    transmissionKind: "manual",
    steeringKind: "desconhecida",
  },
];

function catalogMilestones(): JarvysMilestone[] {
  return CATALOG_PROFILES.flatMap((profile) =>
    buildJarvysScheduleRange({ fromKm: 10000, toKm: 200000, profile }),
  );
}

describe("isDeterministicRevisionItem", () => {
  const revisionKeys = [
    "oleo_motor",
    "filtro_oleo",
    "limpeza_arrefecimento",
    "alinhamento_balanceamento",
    "sangria_freio",
    "inspecao_suspensao",
    "diagnostico_e_cvt",
    "limpeza_tbi_bicos",
    "inspecao_mangueiras",
    "oleo_cambio_automatico",
  ] as const;

  for (const itemKey of revisionKeys) {
    test(`reconhece key canonica do motor: ${itemKey}`, () => {
      expect(isDeterministicRevisionItem(itemKey)).toBe(true);
    });
  }

  const externalKeys = [
    "pneus",
    "lavagem",
    "ar_condicionado",
    "botao_vidro_eletrico",
    "item_que_nao_existe_9f72",
  ] as const;

  for (const itemKey of externalKeys) {
    test(`rejeita key externa ao motor: ${itemKey}`, () => {
      expect(isDeterministicRevisionItem(itemKey)).toBe(false);
    });
  }

  const invalidInputs = [
    "",
    "   ",
    " oleo_motor ",
    "OLEO_MOTOR",
    "limpeza de arrefecimento",
  ] as const;

  for (const itemKey of invalidInputs) {
    test(`nao normaliza entrada: ${JSON.stringify(itemKey)}`, () => {
      expect(isDeterministicRevisionItem(itemKey)).toBe(false);
    });
  }

  test("catalogo materializado possui 28 keys unicas, todas nao vazias", () => {
    const items = catalogMilestones().flatMap((milestone) => milestone.items);
    const keys = items.map((item) => item.item_key);
    const uniqueKeys = new Set(keys);

    expect(keys.every((key) => key.length > 0)).toBe(true);
    expect(uniqueKeys.size).toBe(28);
    for (const key of uniqueKeys) {
      expect(isDeterministicRevisionItem(key)).toBe(true);
    }
  });

  test("cada milestone continua sem duplicatas de item_key", () => {
    for (const milestone of catalogMilestones()) {
      const keys = milestone.items.map((item) => item.item_key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test("pertencimento independe de shopping_classification", () => {
    const items = catalogMilestones().flatMap((milestone) => milestone.items);
    const classifications = new Set(items.map((item) => item.shopping_classification));

    expect(classifications.size).toBe(4);
    for (const classification of [
      "safe_to_buy",
      "inspect_before_buy",
      "bundle_preferred",
      "service_only",
    ] as const) {
      expect(classifications.has(classification)).toBe(true);
    }
    for (const item of items) {
      expect(isDeterministicRevisionItem(item.item_key)).toBe(true);
    }
  });

  test("service_only, inspecao e diagnostico pertencem ao catalogo", () => {
    expect(isDeterministicRevisionItem("sangria_freio")).toBe(true);
    expect(isDeterministicRevisionItem("inspecao_suspensao")).toBe(true);
    expect(isDeterministicRevisionItem("diagnostico_e_cvt")).toBe(true);
  });

  test("buildJarvysScheduleRange preserva a saida dos builders existentes", () => {
    const profile = PROFILES.bmw320iAT;
    const range = buildJarvysScheduleRange({
      fromKm: 10000,
      toKm: 200000,
      profile,
    });
    const individual = Array.from({ length: 20 }, (_, index) =>
      buildJarvysMilestone((index + 1) * 10000, profile),
    );

    expect(JSON.stringify(range)).toBe(JSON.stringify(individual));
  });
});

// ─────────────────────────────────────────────────────────────
// mapRealKmToBaseKm — tabela oficial do brief
// ─────────────────────────────────────────────────────────────

describe("mapRealKmToBaseKm — ciclo infinito", () => {
  const cases: Array<[number, number, number]> = [
    // realKm, baseKm, cycleIndex
    [10000, 10000, 0],
    [200000, 200000, 0],
    [210000, 10000, 1],
    [220000, 20000, 1],
    [260000, 60000, 1],
    [300000, 100000, 1],
    [320000, 120000, 1],
    [400000, 200000, 1],
    [410000, 10000, 2],
    [430000, 30000, 2],
  ];
  for (const [realKm, baseKm, cycleIndex] of cases) {
    test(`realKm=${realKm} → base=${baseKm}, cycle=${cycleIndex}`, () => {
      const r = mapRealKmToBaseKm(realKm);
      expect(r.baseKm).toBe(baseKm);
      expect(r.cycleIndex).toBe(cycleIndex);
    });
  }
});

// ─────────────────────────────────────────────────────────────
// buildJarvysMilestone — alta quilometragem
// ─────────────────────────────────────────────────────────────

describe("buildJarvysMilestone — alta quilometragem", () => {
  const profiles: Array<[string, JarvysVehicleProfile]> = [
    ["combustao/BMW", PROFILES.bmw320iAT],
    ["hibrido/BYD DMi", PROFILES.bydSongDMi],
    ["EV/Dolphin", PROFILES.bydDolphinEV],
  ];
  for (const [name, profile] of profiles) {
    test(`${name} — 220k usa base 20k`, () => {
      const m = buildJarvysMilestone(220000, profile);
      expect(m.revisionKmReal).toBe(220000);
      expect(m.revisionKmBase).toBe(20000);
      expect(m.cycleIndex).toBe(1);
      expect(m.isHighMileage).toBe(true);
      expect(m.notes).toContain(HIGH_MILEAGE_NOTE);
    });
    test(`${name} — 260k usa base 60k`, () => {
      const m = buildJarvysMilestone(260000, profile);
      expect(m.revisionKmBase).toBe(60000);
      expect(m.cycleIndex).toBe(1);
      expect(m.isHighMileage).toBe(true);
    });
    test(`${name} — 410k usa base 10k / cycleIndex=2`, () => {
      const m = buildJarvysMilestone(410000, profile);
      expect(m.revisionKmBase).toBe(10000);
      expect(m.cycleIndex).toBe(2);
      expect(m.isHighMileage).toBe(true);
      expect(m.notes).toContain(HIGH_MILEAGE_NOTE);
    });
  }
  test("200k NÃO é alta quilometragem", () => {
    const m = buildJarvysMilestone(200000, PROFILES.bmw320iAT);
    expect(m.cycleIndex).toBe(0);
    expect(m.isHighMileage).toBe(false);
    expect(m.notes).not.toContain(HIGH_MILEAGE_NOTE);
  });
});

// ─────────────────────────────────────────────────────────────
// Perfis — validação por KM
// ─────────────────────────────────────────────────────────────

describe("Fiat Argo Firefly — corrente/manual", () => {
  const ms = buildAll(PROFILES.argoFireflyCorrente);
  for (const m of ms) {
    test(`km=${m.revisionKmReal} — sem kit_sincronismo e sem câmbio automático`, () => {
      expectNotHasItems(m, FORBIDDEN_KIT_SINCRONISMO, "Argo");
      expectNotHasItems(m, FORBIDDEN_AUTO_TRANSMISSION_ITEMS, "Argo");
    });
    test(`km=${m.revisionKmReal} — óleo motor + filtro em todo marco`, () => {
      expectHasItems(m, ["oleo_motor", "filtro_oleo"], "Argo");
    });
  }
  const evenPares = [20000, 40000, 60000, 80000, 120000, 160000, 200000];
  for (const km of evenPares) {
    test(`Argo — km=${km} inclui filtros de ar/cabine/combustível`, () => {
      const m = buildJarvysMilestone(km, PROFILES.argoFireflyCorrente);
      expectHasItems(
        m,
        ["filtro_ar_motor", "filtro_cabine", "filtro_combustivel"],
        "Argo filtros pares",
      );
    });
  }
  test("Argo — 60k inclui inspeção de corrente (e nada de dentada)", () => {
    const m = buildJarvysMilestone(60000, PROFILES.argoFireflyCorrente);
    expectHasItems(m, ["inspecao_corrente_comando"], "Argo");
    expectNotHasItems(m, ["kit_sincronismo"], "Argo");
  });
});

describe("Peugeot 208 PureTech — correia banhada/manual", () => {
  const ms = buildAll(PROFILES.peugeot208Banhada);
  for (const m of ms) {
    test(`km=${m.revisionKmReal} — sem kit_sincronismo seco`, () => {
      expectNotHasItems(m, FORBIDDEN_KIT_SINCRONISMO, "Peugeot");
      expectNotHasItems(m, FORBIDDEN_AUTO_TRANSMISSION_ITEMS, "Peugeot");
    });
  }
  test("Peugeot — 60k contém Poly V", () => {
    const m = buildJarvysMilestone(60000, PROFILES.peugeot208Banhada);
    expectHasItems(m, ["correia_poly_v", "pastilhas_freio"], "Peugeot 60k");
  });
  test("Peugeot — 90k contém correia banhada (link/confirm)", () => {
    const m = buildJarvysMilestone(90000, PROFILES.peugeot208Banhada);
    expectHasItems(m, ["correia_banhada"], "Peugeot 90k");
    const item = findItem(m, "correia_banhada");
    expect(item?.requires_confirmation).toBe(true);
    expect(itemNotesText(m, "correia_banhada")).toContain("confirm");
    expect(itemNotesText(m, "correia_banhada")).toContain("especializad");
  });
  test("Peugeot — 180k contém correia banhada (link/confirm)", () => {
    const m = buildJarvysMilestone(180000, PROFILES.peugeot208Banhada);
    expectHasItems(m, ["correia_banhada"], "Peugeot 180k");
    expect(itemNotesText(m, "correia_banhada")).toContain("confirm");
  });
  test("Peugeot — 40k contém velas (ignição) e filtros", () => {
    const m = buildJarvysMilestone(40000, PROFILES.peugeot208Banhada);
    expectHasItems(
      m,
      ["velas_ignicao", "filtro_ar_motor", "filtro_cabine", "filtro_combustivel"],
      "Peugeot 40k",
    );
  });
});

describe("Chevrolet Onix 1.0 Turbo — correia banhada/automático", () => {
  const ms = buildAll(PROFILES.onixTurboBanhadaAT);
  for (const m of ms) {
    test(`km=${m.revisionKmReal} — sem kit_sincronismo seco`, () => {
      expectNotHasItems(m, FORBIDDEN_KIT_SINCRONISMO, "Onix");
    });
  }
  const autoMilestones = [40000, 80000, 120000, 160000, 200000];
  for (const km of autoMilestones) {
    test(`Onix — km=${km} contém óleo do câmbio automático`, () => {
      const m = buildJarvysMilestone(km, PROFILES.onixTurboBanhadaAT);
      expectHasItems(m, ["oleo_cambio_automatico"], "Onix AT");
      const notes = itemNotesText(m, "oleo_cambio_automatico");
      expect(notes).toContain("completa");
      expect(notes).toContain("especializad");
      expect(notes).not.toContain("parcial\n");
      // "nunca troca parcial" e "evite flush" fazem parte da nota, o que
      // é intencional: o helper alerta contra parcial/flush. Verificamos
      // que orienta troca completa E menciona o alerta explícito.
      expect(notes).toContain("nunca troca parcial");
      expect(notes).toContain("flush");
    });
  }
  test("Onix — 90k e 180k contêm correia banhada", () => {
    const m90 = buildJarvysMilestone(90000, PROFILES.onixTurboBanhadaAT);
    const m180 = buildJarvysMilestone(180000, PROFILES.onixTurboBanhadaAT);
    expectHasItems(m90, ["correia_banhada"], "Onix 90k");
    expectHasItems(m180, ["correia_banhada"], "Onix 180k");
  });
});

describe("BYD Song Plus DM-i — híbrido/e-CVT", () => {
  const ms = buildAll(PROFILES.bydSongDMi);
  for (const m of ms) {
    test(`km=${m.revisionKmReal} — sem kit_sincronismo, sem câmbio automático convencional`, () => {
      expectNotHasItems(m, FORBIDDEN_KIT_SINCRONISMO, "BYD DMi");
      expectNotHasItems(m, FORBIDDEN_E_CVT_ITEMS, "BYD DMi");
    });
    test(`km=${m.revisionKmReal} — óleo motor + filtro presentes (motor a combustão)`, () => {
      expectHasItems(m, ["oleo_motor", "filtro_oleo"], "BYD DMi");
    });
  }
  test("BYD DMi — diagnóstico e-CVT apenas em 100k e 200k", () => {
    const kmsWithDiag = [100000, 200000];
    for (const km of kmsWithDiag) {
      const m = buildJarvysMilestone(km, PROFILES.bydSongDMi);
      expectHasItems(m, ["diagnostico_e_cvt"], "BYD DMi diag");
    }
    for (const km of [10000, 40000, 60000, 80000, 120000, 160000, 180000]) {
      const m = buildJarvysMilestone(km, PROFILES.bydSongDMi);
      expectNotHasItems(m, ["diagnostico_e_cvt"], "BYD DMi fora de diag");
    }
  });
});

describe("Toyota Corolla híbrido — híbrido/e-CVT", () => {
  const ms = buildAll(PROFILES.corollaHibrido);
  for (const m of ms) {
    test(`km=${m.revisionKmReal} — sem kit_sincronismo, sem câmbio automático`, () => {
      expectNotHasItems(m, FORBIDDEN_KIT_SINCRONISMO, "Corolla");
      expectNotHasItems(m, FORBIDDEN_E_CVT_ITEMS, "Corolla");
    });
  }
  test("Corolla — 100k contém diagnóstico e-CVT", () => {
    const m = buildJarvysMilestone(100000, PROFILES.corollaHibrido);
    expectHasItems(m, ["diagnostico_e_cvt"], "Corolla 100k");
  });
});

describe("Toyota Hilux diesel — corrente/automático/hidráulica", () => {
  const ms = buildAll(PROFILES.hiluxDieselAT);
  for (const m of ms) {
    test(`km=${m.revisionKmReal} — sem kit_sincronismo`, () => {
      expectNotHasItems(m, FORBIDDEN_KIT_SINCRONISMO, "Hilux");
    });
  }
  for (const km of [40000, 80000, 120000, 160000, 200000]) {
    test(`Hilux — km=${km} contém câmbio automático`, () => {
      const m = buildJarvysMilestone(km, PROFILES.hiluxDieselAT);
      expectHasItems(m, ["oleo_cambio_automatico"], "Hilux AT");
    });
  }
  for (const km of [50000, 100000, 150000, 200000]) {
    test(`Hilux — km=${km} contém óleo direção hidráulica`, () => {
      const m = buildJarvysMilestone(km, PROFILES.hiluxDieselAT);
      expectHasItems(m, ["oleo_direcao_hidraulica"], "Hilux direção");
    });
  }
  test("Hilux — 60k contém inspeção de corrente", () => {
    const m = buildJarvysMilestone(60000, PROFILES.hiluxDieselAT);
    expectHasItems(m, ["inspecao_corrente_comando"], "Hilux corrente");
  });
});

describe("BMW 320i — corrente/automático/elétrica", () => {
  const ms = buildAll(PROFILES.bmw320iAT);
  for (const m of ms) {
    test(`km=${m.revisionKmReal} — sem kit_sincronismo e sem direção hidráulica`, () => {
      expectNotHasItems(m, FORBIDDEN_KIT_SINCRONISMO, "BMW");
      expectNotHasItems(m, FORBIDDEN_HYDRAULIC_STEERING, "BMW");
    });
  }
  for (const km of [40000, 80000, 120000, 160000, 200000]) {
    test(`BMW — km=${km} contém câmbio automático`, () => {
      const m = buildJarvysMilestone(km, PROFILES.bmw320iAT);
      expectHasItems(m, ["oleo_cambio_automatico"], "BMW AT");
    });
  }
});

describe("BYD Dolphin — elétrico puro", () => {
  const ms = buildAll(PROFILES.bydDolphinEV);
  for (const m of ms) {
    test(`km=${m.revisionKmReal} — sem qualquer item de combustão`, () => {
      expectNotHasItems(m, FORBIDDEN_EV_ITEMS, "Dolphin EV");
    });
  }
  test("Dolphin — 20k contém filtro cabine + fluido freio + sangria", () => {
    const m = buildJarvysMilestone(20000, PROFILES.bydDolphinEV);
    expectHasItems(m, ["filtro_cabine", "fluido_freio", "sangria_freio"], "Dolphin 20k");
  });
  test("Dolphin — 30k contém aditivo + limpeza arrefecimento", () => {
    const m = buildJarvysMilestone(30000, PROFILES.bydDolphinEV);
    expectHasItems(m, ["aditivo_arrefecimento", "limpeza_arrefecimento"], "Dolphin 30k");
    expect(itemNotesText(m, "aditivo_arrefecimento")).toContain("confirm");
    expect(itemNotesText(m, "aditivo_arrefecimento")).toContain("arrefec");
  });
  test("Dolphin — 40k contém óleo caixa de redução", () => {
    const m = buildJarvysMilestone(40000, PROFILES.bydDolphinEV);
    expectHasItems(m, ["oleo_caixa_reducao"], "Dolphin 40k");
    const notes = itemNotesText(m, "oleo_caixa_reducao");
    expect(notes).toContain("confirm");
    expect(notes).toContain("elétric");
  });
  test("Dolphin — 130k NÃO contém filtro cabine (via revisionKmBase===130000)", () => {
    const m = buildJarvysMilestone(130000, PROFILES.bydDolphinEV);
    expect(m.revisionKmBase).toBe(130000);
    expectNotHasItems(m, ["filtro_cabine"], "Dolphin 130k");
  });
  test("Dolphin — 220k usa base 20k e mantém regras EV", () => {
    const m = buildJarvysMilestone(220000, PROFILES.bydDolphinEV);
    expect(m.revisionKmBase).toBe(20000);
    expectHasItems(m, ["filtro_cabine", "fluido_freio", "sangria_freio"], "Dolphin 220k");
    expectNotHasItems(m, FORBIDDEN_EV_ITEMS, "Dolphin 220k");
  });
  test("Dolphin — 260k usa base 60k", () => {
    const m = buildJarvysMilestone(260000, PROFILES.bydDolphinEV);
    expect(m.revisionKmBase).toBe(60000);
    expectHasItems(m, ["filtro_cabine"], "Dolphin 260k");
  });
  test("Dolphin — 410k usa base 10k e cycleIndex=2", () => {
    const m = buildJarvysMilestone(410000, PROFILES.bydDolphinEV);
    expect(m.revisionKmBase).toBe(10000);
    expect(m.cycleIndex).toBe(2);
    expectNotHasItems(m, FORBIDDEN_EV_ITEMS, "Dolphin 410k");
  });
});

// ─────────────────────────────────────────────────────────────
// getJarvysBaseMilestoneItems — sanidade EV vs combustão
// ─────────────────────────────────────────────────────────────

describe("getJarvysBaseMilestoneItems — separação EV × combustão", () => {
  test("EV nunca retorna oleo_motor em nenhum baseKm 10k–200k", () => {
    for (let km = 10000; km <= 200000; km += 10000) {
      const items = getJarvysBaseMilestoneItems(km, PROFILES.bydDolphinEV);
      expect(items.some((i) => i.item_key === "oleo_motor")).toBe(false);
    }
  });
  test("Combustão sempre retorna oleo_motor + filtro_oleo em baseKm 10k–200k", () => {
    for (let km = 10000; km <= 200000; km += 10000) {
      const items = getJarvysBaseMilestoneItems(km, PROFILES.bmw320iAT);
      const keys = items.map((i) => i.item_key);
      expect(keys).toContain("oleo_motor");
      expect(keys).toContain("filtro_oleo");
    }
  });
});
