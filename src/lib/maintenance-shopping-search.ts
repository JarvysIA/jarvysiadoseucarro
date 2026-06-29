// Build 6.42A — Helper puro de buscas de Shopping para próxima revisão.
//
// Transforma o payload de buildNextRevisionPayload (Build 6.41) em grupos de
// busca para Shopping futuro. Não gera URL, não usa afiliado, não persiste,
// não chama IA. Função pura.

// ─── Tipos públicos ───────────────────────────────────────────────────────

export type MaintenanceShoppingGroupType =
  | "engine_oil_kit"
  | "filters_kit"
  | "transmission_oil_kit"
  | "timing_kit"
  | "accessory_belt"
  | "spark_plugs"
  | "water_pump"
  | "brake_parts"
  | "single_part"
  | "service_only";

export type MaintenanceShoppingGroup = {
  groupKey: string;
  type: MaintenanceShoppingGroupType;
  title: string;
  searchQuery: string | null;
  items: Array<{
    itemKey: string;
    label: string;
    category: string | null;
    shoppingClassification: string | null;
    kind: string;
  }>;
  userNote: string;
  compatibilityNote: string | null;
  shouldCreateLink: boolean;
};

export type MaintenanceShoppingSearchPayload = {
  ok: boolean;
  vehicleSearchName: string;
  groups: MaintenanceShoppingGroup[];
  linkGroups: MaintenanceShoppingGroup[];
  serviceGroups: MaintenanceShoppingGroup[];
  footerMessages: {
    cartMessage: string;
    compatibilityMessage: string;
  };
  debug: {
    warnings: string[];
    groupedItemKeys: string[];
    ungroupedItemKeys: string[];
  };
};

// ─── Constantes fixas ─────────────────────────────────────────────────────

const FOOTER_CART_MESSAGE =
  "🛒 Adicione os itens ao seu carrinho e garanta as melhores ofertas para revisar seu carro.";
const FOOTER_COMPATIBILITY_MESSAGE =
  "🔎 Confirme a compatibilidade das peças antes de finalizar a compra.";

const SERVICE_USER_NOTE =
  "Serviço recomendado em oficina ou auto center especializado.";

// ─── Helpers defensivos ───────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeText(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function collapseSpaces(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

// ─── Tipos internos ───────────────────────────────────────────────────────

type RevisionItem = {
  itemKey: string;
  label: string;
  category: string | null;
  shoppingClassification: string | null;
  kind: string;
};

function parseItem(raw: unknown): RevisionItem | null {
  if (!isRecord(raw)) return null;
  const itemKey = asString(raw["itemKey"]);
  if (itemKey === null) return null;
  const label = asString(raw["label"]) ?? itemKey;
  return {
    itemKey,
    label,
    category: asString(raw["category"]),
    shoppingClassification: asString(raw["shoppingClassification"]),
    kind: asString(raw["kind"]) ?? "info_only",
  };
}

function parseItems(v: unknown): RevisionItem[] {
  const out: RevisionItem[] = [];
  for (const raw of asArray(v)) {
    const it = parseItem(raw);
    if (it !== null) out.push(it);
  }
  return out;
}

function haystackOf(item: RevisionItem): string {
  return normalizeText(
    `${item.itemKey} ${item.label} ${item.category ?? ""}`,
  );
}

function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

// ─── Vehicle search name ──────────────────────────────────────────────────

function buildVehicleSearchName(revisionPayload: Record<string, unknown>): string {
  const vs = revisionPayload["vehicleSummary"];
  if (!isRecord(vs)) return "";
  const parts: string[] = [];
  const marca = asString(vs["marca"]);
  const modelo = asString(vs["modeloFipe"]);
  const motor = asString(vs["motorTextual"]);
  const ano = asNumber(vs["anoModelo"]);
  if (marca) parts.push(marca);
  if (modelo) parts.push(modelo);
  if (motor) parts.push(motor);
  if (ano !== null) parts.push(String(ano));
  return collapseSpaces(parts.join(" "));
}

// ─── Empty payload ────────────────────────────────────────────────────────

function emptyPayload(warnings: string[]): MaintenanceShoppingSearchPayload {
  return {
    ok: false,
    vehicleSearchName: "",
    groups: [],
    linkGroups: [],
    serviceGroups: [],
    footerMessages: {
      cartMessage: FOOTER_CART_MESSAGE,
      compatibilityMessage: FOOTER_COMPATIBILITY_MESSAGE,
    },
    debug: {
      warnings,
      groupedItemKeys: [],
      ungroupedItemKeys: [],
    },
  };
}

// ─── Helpers de query/group ───────────────────────────────────────────────

function withVehicle(base: string, vehicle: string): string {
  return collapseSpaces(`${base} ${vehicle}`);
}

function toGroupItem(it: RevisionItem) {
  return {
    itemKey: it.itemKey,
    label: it.label,
    category: it.category,
    shoppingClassification: it.shoppingClassification,
    kind: it.kind,
  };
}

// ─── API pública ──────────────────────────────────────────────────────────

export function buildMaintenanceShoppingSearchPayload(
  revisionPayload: unknown,
): MaintenanceShoppingSearchPayload {
  if (!isRecord(revisionPayload)) {
    return emptyPayload(["payload_invalido_ou_nao_ok"]);
  }
  if (revisionPayload["ok"] !== true) {
    return emptyPayload(["payload_invalido_ou_nao_ok"]);
  }

  const vehicleSearchName = buildVehicleSearchName(revisionPayload);
  const candidates = parseItems(revisionPayload["itemsShoppingCandidates"]);
  const serviceItems = parseItems(revisionPayload["itemsServiceOnly"]);

  const consumed = new Set<string>();
  const linkGroups: MaintenanceShoppingGroup[] = [];
  const warnings: string[] = [];

  const byKey = new Map<string, RevisionItem>();
  for (const it of candidates) {
    if (!byKey.has(it.itemKey)) byKey.set(it.itemKey, it);
  }

  const findByKeys = (keys: string[]): RevisionItem[] =>
    keys
      .map((k) => byKey.get(k))
      .filter((x): x is RevisionItem => x !== undefined && !consumed.has(x.itemKey));

  const findByKeyword = (needles: string[]): RevisionItem[] =>
    candidates.filter(
      (it) => !consumed.has(it.itemKey) && hasAny(haystackOf(it), needles),
    );

  const consume = (items: RevisionItem[]): void => {
    for (const it of items) consumed.add(it.itemKey);
  };

  // 1) engine_oil_kit — oleo_motor + filtro_oleo simultaneamente.
  {
    const matched = findByKeys(["oleo_motor", "filtro_oleo"]);
    if (matched.length === 2) {
      consume(matched);
      linkGroups.push({
        groupKey: "kit_oleo_filtro_motor",
        type: "engine_oil_kit",
        title: "Óleo + filtro de óleo do motor",
        searchQuery: withVehicle("kit óleo e filtro", vehicleSearchName),
        items: matched.map(toGroupItem),
        userNote: "Busca agrupada para óleo do motor e filtro de óleo.",
        compatibilityNote:
          "Confirme a compatibilidade do óleo e do filtro antes da compra.",
        shouldCreateLink: true,
      });
    }
  }

  // 2) filters_kit — ≥2 entre ar/cabine/combustível.
  {
    const filterKeys = ["filtro_ar_motor", "filtro_cabine", "filtro_combustivel"];
    const matched = findByKeys(filterKeys);
    if (matched.length >= 2) {
      consume(matched);
      linkGroups.push({
        groupKey: "kit_filtros",
        type: "filters_kit",
        title: "Kit filtros: ar do motor + cabine + combustível",
        searchQuery: withVehicle("kit filtros", vehicleSearchName),
        items: matched.map(toGroupItem),
        userNote: "Busca agrupada para filtros da revisão.",
        compatibilityNote:
          "Confirme a aplicação dos filtros conforme a versão do veículo.",
        shouldCreateLink: true,
      });
    }
  }

  // 3) transmission_oil_kit — apenas candidatos.
  {
    const needles = [
      "oleo_cambio",
      "fluido_cambio",
      "filtro_cambio",
      "kit_cambio_automatico",
      "transmissao",
      "cambio_automatico",
      "cambio_cvt",
      "oleo cambio",
      "fluido cambio",
      "filtro cambio",
      "cambio automatico",
      "cambio cvt",
    ];
    const matched = findByKeyword(needles);
    if (matched.length > 0) {
      consume(matched);
      const hay = matched.map(haystackOf).join(" ");
      let base: string;
      if (hay.includes("cvt")) {
        base = "kit troca óleo câmbio CVT com filtro";
      } else if (
        hay.includes("atf") ||
        hay.includes("automatico") ||
        hay.includes("automático")
      ) {
        base = "kit troca óleo câmbio automático ATF com filtro";
      } else {
        base = "kit troca óleo câmbio com filtro";
      }
      linkGroups.push({
        groupKey: "kit_oleo_cambio",
        type: "transmission_oil_kit",
        title: "Kit troca de óleo do câmbio",
        searchQuery: withVehicle(base, vehicleSearchName),
        items: matched.map(toGroupItem),
        userNote: "Busca agrupada para troca de óleo do câmbio.",
        compatibilityNote:
          "Confirme a especificação correta do óleo de câmbio antes da compra.",
        shouldCreateLink: true,
      });
    }
  }

  // 4) timing_kit.
  {
    const needles = [
      "kit_sincronismo",
      "correia_dentada",
      "kit_correia_dentada",
      "sincronismo",
      "correia dentada",
    ];
    const matched = findByKeyword(needles);
    if (matched.length > 0) {
      consume(matched);
      linkGroups.push({
        groupKey: "kit_sincronismo",
        type: "timing_kit",
        title: "Kit sincronismo",
        searchQuery: withVehicle("kit sincronismo", vehicleSearchName),
        items: matched.map(toGroupItem),
        userNote: "Busca agrupada para kit de sincronismo.",
        compatibilityNote:
          "Confirme se o veículo usa correia dentada e se o kit é compatível.",
        shouldCreateLink: true,
      });
    }
  }

  // 5) water_pump.
  {
    const needles = ["bomba_agua", "bomba_dagua", "bomba d'agua", "bomba dagua", "bomba agua"];
    const matched = findByKeyword(needles);
    if (matched.length > 0) {
      consume(matched);
      linkGroups.push({
        groupKey: "bomba_agua",
        type: "water_pump",
        title: "Bomba d’água",
        searchQuery: withVehicle("bomba d água", vehicleSearchName),
        items: matched.map(toGroupItem),
        userNote: "Busca para bomba d’água do motor.",
        compatibilityNote: "Confirme a compatibilidade da bomba antes da compra.",
        shouldCreateLink: true,
      });
    }
  }

  // 6) accessory_belt.
  {
    const needles = [
      "correia_acessorios",
      "correia acessorios",
      "poly",
      "poly-v",
      "poly v",
      "correia alternador",
      "correia ar condicionado",
      "correia ar-condicionado",
    ];
    const matched = findByKeyword(needles);
    if (matched.length > 0) {
      consume(matched);
      linkGroups.push({
        groupKey: "correia_acessorios",
        type: "accessory_belt",
        title: "Correia Poly V / acessórios",
        searchQuery: withVehicle("correia poly v acessórios", vehicleSearchName),
        items: matched.map(toGroupItem),
        userNote: "Busca para correia de acessórios (Poly V).",
        compatibilityNote: "Confirme a compatibilidade da correia antes da compra.",
        shouldCreateLink: true,
      });
    }
  }

  // 7) spark_plugs.
  {
    const needles = ["velas", "vela_ignicao", "velas_ignicao", "ignicao", "ignição"];
    const matched = findByKeyword(needles);
    if (matched.length > 0) {
      consume(matched);
      linkGroups.push({
        groupKey: "velas_ignicao",
        type: "spark_plugs",
        title: "Velas de ignição",
        searchQuery: withVehicle("jogo velas ignição", vehicleSearchName),
        items: matched.map(toGroupItem),
        userNote: "Busca para jogo de velas de ignição.",
        compatibilityNote:
          "Confirme a especificação correta das velas antes da compra.",
        shouldCreateLink: true,
      });
    }
  }

  // 8) brake_parts.
  {
    const needles = ["pastilha", "pastilhas", "freio"];
    const matched = findByKeyword(needles);
    if (matched.length > 0) {
      consume(matched);
      linkGroups.push({
        groupKey: "pastilhas_freio",
        type: "brake_parts",
        title: "Pastilhas de freio",
        searchQuery: withVehicle("pastilhas de freio", vehicleSearchName),
        items: matched.map(toGroupItem),
        userNote: "Busca para pastilhas de freio.",
        compatibilityNote:
          "Confirme a compatibilidade das pastilhas conforme o eixo e a versão.",
        shouldCreateLink: true,
      });
    }
  }

  // 9) single_part fallback.
  for (const it of candidates) {
    if (consumed.has(it.itemKey)) continue;
    consumed.add(it.itemKey);
    linkGroups.push({
      groupKey: `peca_${it.itemKey}`,
      type: "single_part",
      title: it.label,
      searchQuery: withVehicle(it.label, vehicleSearchName),
      items: [toGroupItem(it)],
      userNote: "Busca individual para item da revisão.",
      compatibilityNote: "Confirme a compatibilidade da peça antes da compra.",
      shouldCreateLink: true,
    });
  }

  // Service groups.
  const serviceGroups: MaintenanceShoppingGroup[] = [];
  for (const it of serviceItems) {
    serviceGroups.push({
      groupKey: `servico_${it.itemKey}`,
      type: "service_only",
      title: it.label,
      searchQuery: null,
      items: [toGroupItem(it)],
      userNote: SERVICE_USER_NOTE,
      compatibilityNote: null,
      shouldCreateLink: false,
    });
  }

  const groupedItemKeys = Array.from(consumed);
  const ungroupedItemKeys = candidates
    .filter((it) => !consumed.has(it.itemKey))
    .map((it) => it.itemKey);

  return {
    ok: true,
    vehicleSearchName,
    groups: [...linkGroups, ...serviceGroups],
    linkGroups,
    serviceGroups,
    footerMessages: {
      cartMessage: FOOTER_CART_MESSAGE,
      compatibilityMessage: FOOTER_COMPATIBILITY_MESSAGE,
    },
    debug: {
      warnings,
      groupedItemKeys,
      ungroupedItemKeys,
    },
  };
}
