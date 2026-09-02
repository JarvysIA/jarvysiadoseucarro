// Build Maintenance-Alert — testes de buildMilestoneAlertMessage.
// Runner: bun test. Sem mock.module (não é necessário aqui — função pura,
// sem I/O).

import { describe, expect, test } from "bun:test";
import { buildMilestoneAlertMessage, MAINTENANCE_ALERT_MAX_CHARS } from "../message-builder.ts";
import { buildMercadoLivreAffiliateSearchUrl, MERCADO_LIVRE_SHOPPING_WARNINGS } from "../affiliate-links.ts";
import type { JarvysVisualGroup } from "../visual-groups.ts";
import type { JarvysItem } from "../jarvys-schedule-rules.ts";

function fakeItem(overrides: Partial<JarvysItem> & { item_key: string }): JarvysItem {
  return {
    label: overrides.item_key,
    category: "motor",
    action: "trocar",
    recommendation_type: "required",
    shopping_classification: "safe_to_buy",
    applies: true,
    confidence: 90,
    source_type: "experiencia_preventiva",
    group_key: null,
    requires_confirmation: false,
    ...overrides,
  };
}

// Grupo 1: crítico (kind "oil_and_oil_filter" é sempre crítico,
// independente dos sourceItems).
const CRITICAL_GROUP: JarvysVisualGroup = {
  groupKey: "oleo_e_filtro_oleo",
  kind: "oil_and_oil_filter",
  title: "Óleo e filtro de óleo",
  description: "Óleo do motor + filtro de óleo",
  linkItemTitle: "Óleo e filtro de óleo",
  icon: "droplet",
  sourceItems: [fakeItem({ item_key: "oleo_motor" }), fakeItem({ item_key: "filtro_oleo" })],
  sourceItemKeys: ["oleo_motor", "filtro_oleo"],
  sourceLabels: ["Óleo do motor", "Filtro de óleo"],
  isServiceOnly: false,
  sortOrder: 1,
};

// Grupo 2: service_only, NÃO crítico (item_key não está em
// CRITICAL_ITEM_KEYS).
const SERVICE_ONLY_GROUP: JarvysVisualGroup = {
  groupKey: "individual_sangria_freio",
  kind: "service_only",
  title: "Sangria do sistema de freio (serviço)",
  linkItemTitle: "Sangria do sistema de freio (serviço)",
  icon: "wrench",
  sourceItems: [fakeItem({ item_key: "sangria_freio", shopping_classification: "service_only" })],
  sourceItemKeys: ["sangria_freio"],
  sourceLabels: ["Sangria do sistema de freio (serviço)"],
  isServiceOnly: true,
  serviceBadgeLabel: "Serviço especializado",
  sortOrder: 2,
};

// Grupo 3: normal — não crítico, não service_only.
const NORMAL_GROUP: JarvysVisualGroup = {
  groupKey: "velas_e_cabos",
  kind: "spark_plugs_cables",
  title: "Velas e cabos",
  description: "Velas de ignição e cabos de vela",
  linkItemTitle: "Velas e cabos",
  icon: "zap",
  sourceItems: [fakeItem({ item_key: "velas_ignicao" })],
  sourceItemKeys: ["velas_ignicao"],
  sourceLabels: ["Velas de ignição"],
  isServiceOnly: false,
  sortOrder: 5,
};

describe("buildMilestoneAlertMessage", () => {
  test("texto exato com 1 grupo crítico, 1 service_only, 1 normal, nesta ordem", () => {
    const marca = "Toyota";
    const modelo = "Corolla";
    const urlCritical = buildMercadoLivreAffiliateSearchUrl({
      query: `${marca} ${modelo} ${CRITICAL_GROUP.linkItemTitle}`,
    }).url;
    const urlNormal = buildMercadoLivreAffiliateSearchUrl({
      query: `${marca} ${modelo} ${NORMAL_GROUP.linkItemTitle}`,
    }).url;

    const text = buildMilestoneAlertMessage({
      marca,
      modelo,
      kmAtual: 118500,
      targetKm: 120000,
      groups: [CRITICAL_GROUP, SERVICE_ONLY_GROUP, NORMAL_GROUP],
    });

    const expected = [
      "🔧 Revisão de 120.000 km chegando pro seu TOYOTA COROLLA!",
      "Km atual: 118.500 km",
      "",
      "Itens recomendados para esta revisão:",
      "",
      "💧 Óleo e filtro de óleo ⚠️ Item crítico",
      "Óleo do motor + filtro de óleo",
      `🛒 Ver ofertas no Mercado Livre: ${urlCritical}`,
      "",
      "🔧 Sangria do sistema de freio (serviço)",
      "Serviço especializado",
      "",
      "⚡ Velas e cabos",
      "Velas de ignição e cabos de vela",
      `🛒 Ver ofertas no Mercado Livre: ${urlNormal}`,
      "",
      MERCADO_LIVRE_SHOPPING_WARNINGS.offers,
      MERCADO_LIVRE_SHOPPING_WARNINGS.compatibility,
      MERCADO_LIVRE_SHOPPING_WARNINGS.officialStores,
    ].join("\n");

    expect(text).toBe(expected);
  });

  test("ícones mapeados corretamente: droplet=💧 wind=🌬️ disc3=🛞 wrench=🔧 zap=⚡ snowflake=❄️", () => {
    const icons: Array<[JarvysVisualGroup["icon"], string]> = [
      ["droplet", "💧"],
      ["wind", "🌬️"],
      ["disc3", "🛞"],
      ["wrench", "🔧"],
      ["zap", "⚡"],
      ["snowflake", "❄️"],
    ];
    for (const [icon, emoji] of icons) {
      const group: JarvysVisualGroup = {
        ...NORMAL_GROUP,
        icon,
        description: undefined,
        isServiceOnly: true,
        serviceBadgeLabel: "Serviço especializado",
      };
      const text = buildMilestoneAlertMessage({
        marca: "Fiat",
        modelo: "Argo",
        kmAtual: 1000,
        targetKm: 10000,
        groups: [group],
      });
      expect(text.includes(`${emoji} ${group.title}`)).toBe(true);
    }
  });

  test("ícone desconhecido cai no fallback 🔧", () => {
    const group: JarvysVisualGroup = {
      ...NORMAL_GROUP,
      icon: "unknown-icon" as JarvysVisualGroup["icon"],
      isServiceOnly: true,
      serviceBadgeLabel: "Serviço especializado",
    };
    const text = buildMilestoneAlertMessage({
      marca: "Fiat",
      modelo: "Argo",
      kmAtual: 1000,
      targetKm: 10000,
      groups: [group],
    });
    expect(text.includes(`🔧 ${group.title}`)).toBe(true);
  });

  test("grupo não crítico não recebe sufixo de item crítico", () => {
    const text = buildMilestoneAlertMessage({
      marca: "Fiat",
      modelo: "Argo",
      kmAtual: 1000,
      targetKm: 10000,
      groups: [NORMAL_GROUP],
    });
    expect(text.includes("⚠️ Item crítico")).toBe(false);
  });

  test("preserva a ordem dos grupos exatamente como recebida", () => {
    const text = buildMilestoneAlertMessage({
      marca: "Fiat",
      modelo: "Argo",
      kmAtual: 1000,
      targetKm: 10000,
      groups: [NORMAL_GROUP, SERVICE_ONLY_GROUP, CRITICAL_GROUP],
    });
    const idxNormal = text.indexOf("Velas e cabos");
    const idxService = text.indexOf("Sangria do sistema de freio");
    const idxCritical = text.indexOf("Óleo e filtro de óleo");
    expect(idxNormal).toBeGreaterThan(-1);
    expect(idxService).toBeGreaterThan(idxNormal);
    expect(idxCritical).toBeGreaterThan(idxService);
  });

  test("textos oficiais de rodapé aparecem literais (sem prefixo de emoji duplicado)", () => {
    const text = buildMilestoneAlertMessage({
      marca: "Fiat",
      modelo: "Argo",
      kmAtual: 1000,
      targetKm: 10000,
      groups: [NORMAL_GROUP],
    });
    expect(text.includes(MERCADO_LIVRE_SHOPPING_WARNINGS.offers)).toBe(true);
    expect(text.includes(MERCADO_LIVRE_SHOPPING_WARNINGS.compatibility)).toBe(true);
    expect(text.includes(MERCADO_LIVRE_SHOPPING_WARNINGS.officialStores)).toBe(true);
    // Nunca duplica o emoji do início de offers/compatibility.
    expect(text.includes("🛒 🛒")).toBe(false);
    expect(text.includes("🔎 🔎")).toBe(false);
  });

  test("trunca defensivamente se ultrapassar MAINTENANCE_ALERT_MAX_CHARS, cortando grupos inteiros do fim (nunca pela metade)", () => {
    // Monta muitos grupos "normais" pra forçar ultrapassar o limite.
    const manyGroups: JarvysVisualGroup[] = Array.from({ length: 80 }, (_, i) => ({
      ...NORMAL_GROUP,
      groupKey: `g${i}`,
      title: `Item de teste número ${i} com um texto bem mais longo pra engordar a mensagem de propósito`,
      description: `Descrição bem detalhada do item ${i}, cheia de texto só pra ocupar espaço mesmo`,
    }));

    const text = buildMilestoneAlertMessage({
      marca: "Fiat",
      modelo: "Argo",
      kmAtual: 1000,
      targetKm: 800000,
      groups: manyGroups,
    });

    expect(text.length).toBeLessThanOrEqual(MAINTENANCE_ALERT_MAX_CHARS);
    // Rodapé continua íntegro (nunca cortado).
    expect(text.includes(MERCADO_LIVRE_SHOPPING_WARNINGS.officialStores)).toBe(true);
    // Prova de que nenhum grupo foi cortado pela metade: título e descrição
    // sempre andam juntos no mesmo bloco (nunca um sem o outro), então as
    // contagens de ocorrência de cada marcador têm que bater exatamente.
    const titleCount = (text.match(/Item de teste número/g) ?? []).length;
    const descriptionCount = (text.match(/Descrição bem detalhada do item/g) ?? []).length;
    expect(titleCount).toBe(descriptionCount);
    // Efetivamente truncou (nem todos os 80 grupos couberam).
    expect(titleCount).toBeLessThan(manyGroups.length);
  });
});
