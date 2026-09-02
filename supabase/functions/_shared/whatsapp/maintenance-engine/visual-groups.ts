// Build Maintenance-Alert — cópia deliberada de
// src/lib/maintenance-visual-groups.ts (2026-09-02), adaptada pro runtime
// Deno de supabase/functions/_shared/. Mesmo padrão de duplicação de
// arquivo puro já estabelecido no repo (ex: receipt-ocr/parse-receipt.ts
// entre src/lib e supabase/functions/_shared). Sem lógica alterada — cópia
// fiel; só o import de JarvysItem aponta pra ./jarvys-schedule-rules.ts
// (a cópia local) em vez de src/lib.
//
// Build 6.46 — Helper puro: agrupa JarvysItem[] em grupos visuais/comerciais
// para renderização de cards de Revisão + Shopping (Mercado Livre).
//
// Sem React, Supabase, fetch, IA, persistência ou chamada externa.
// Regra migrada 1:1 do Build 6.45A (admin-corpus-smoke).

import type { JarvysItem } from "./jarvys-schedule-rules.ts";

export type JarvysVisualGroupKind =
  | "oil_and_oil_filter"
  | "filters_kit"
  | "brake_pads_discs"
  | "timing_kit"
  | "spark_plugs_cables"
  | "coolant_additive"
  | "individual"
  | "service_only";

export type JarvysVisualGroupIcon =
  | "droplet"
  | "wind"
  | "disc3"
  | "wrench"
  | "zap"
  | "snowflake";

export type JarvysVisualGroupServiceBadge =
  | "Inspeção em oficina"
  | "Serviço especializado";

export type JarvysVisualGroup = {
  groupKey: string;
  kind: JarvysVisualGroupKind;
  title: string;
  description?: string;
  linkItemTitle: string;
  icon: JarvysVisualGroupIcon;
  sourceItems: JarvysItem[];
  sourceItemKeys: string[];
  sourceLabels: string[];
  isServiceOnly: boolean;
  serviceBadgeLabel?: JarvysVisualGroupServiceBadge;
  hasMixedServiceItems?: boolean;
  serviceItemLabels?: string[];
  sortOrder: number;
};

// ─── Normalização ────────────────────────────────────────────────────────

function normalizeJarvysText(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemHaystack(item: JarvysItem): string {
  return `${normalizeJarvysText(item.item_key)} ${normalizeJarvysText(item.label)}`;
}

function itemMatchesAny(item: JarvysItem, needles: string[]): boolean {
  const hay = itemHaystack(item);
  return needles.some((n) => hay.includes(n));
}

// ─── Criticidade ─────────────────────────────────────────────────────────

const CRITICAL_ITEM_KEYS = new Set([
  "oleo_cambio_automatico",
  "oleo_caixa_reducao",
  "correia_banhada",
  "inspecao_correia_banhada",
  "inspecao_corrente_comando",
]);

function isCriticalGroup(kind: JarvysVisualGroupKind, sourceItems: JarvysItem[]): boolean {
  if (kind === "oil_and_oil_filter") return true;
  if (kind === "timing_kit") return true;
  if (kind === "individual" || kind === "service_only") {
    return sourceItems.some((it) => CRITICAL_ITEM_KEYS.has(it.item_key));
  }
  return false;
}

export function isJarvysVisualGroupCritical(group: JarvysVisualGroup): boolean {
  return isCriticalGroup(group.kind, group.sourceItems);
}

// ─── Finalização de grupo (service_only puro / misto) ────────────────────

type DraftGroup = Omit<
  JarvysVisualGroup,
  | "sourceItemKeys"
  | "sourceLabels"
  | "isServiceOnly"
  | "serviceBadgeLabel"
  | "hasMixedServiceItems"
  | "serviceItemLabels"
> & {
  isServiceOnly?: boolean;
  serviceBadgeLabel?: JarvysVisualGroupServiceBadge;
};

function finalizeGroup(draft: DraftGroup): JarvysVisualGroup {
  const sourceItems = draft.sourceItems;
  const serviceItems = sourceItems.filter(
    (it) => it.shopping_classification === "service_only",
  );
  const allService =
    sourceItems.length > 0 && serviceItems.length === sourceItems.length;
  const anyInspect = sourceItems.some(
    (it) => it.recommendation_type === "inspect_only",
  );

  const isServiceOnly = allService;
  const kind: JarvysVisualGroupKind = isServiceOnly
    ? "service_only"
    : draft.kind;

  const serviceBadgeLabel: JarvysVisualGroupServiceBadge | undefined =
    isServiceOnly
      ? anyInspect
        ? "Inspeção em oficina"
        : "Serviço especializado"
      : undefined;

  const hasMixedServiceItems =
    !isServiceOnly && serviceItems.length > 0 && serviceItems.length < sourceItems.length;

  return {
    groupKey: draft.groupKey,
    kind,
    title: draft.title,
    description: draft.description,
    linkItemTitle: draft.linkItemTitle,
    icon: draft.icon,
    sourceItems,
    sourceItemKeys: sourceItems.map((it) => it.item_key),
    sourceLabels: sourceItems.map((it) => it.label),
    isServiceOnly,
    serviceBadgeLabel,
    hasMixedServiceItems: hasMixedServiceItems ? true : undefined,
    serviceItemLabels: hasMixedServiceItems
      ? serviceItems.map((it) => it.label)
      : undefined,
    sortOrder: draft.sortOrder,
  };
}

// ─── API pública ─────────────────────────────────────────────────────────

export function buildJarvysVisualGroups(
  items: JarvysItem[],
): JarvysVisualGroup[] {
  const consumed = new Set<string>();
  const groups: JarvysVisualGroup[] = [];

  const take = (predicate: (it: JarvysItem) => boolean): JarvysItem[] => {
    const matched: JarvysItem[] = [];
    for (const it of items) {
      if (consumed.has(it.item_key)) continue;
      if (predicate(it)) {
        matched.push(it);
        consumed.add(it.item_key);
      }
    }
    return matched;
  };

  // 1) Óleo e filtro de óleo
  {
    const oil = take((it) =>
      itemMatchesAny(it, ["oleo motor", "oleo do motor"]),
    );
    const oilFilter = take((it) =>
      itemMatchesAny(it, ["filtro oleo", "filtro de oleo"]),
    );
    const src = [...oil, ...oilFilter];
    if (src.length > 0) {
      let description: string;
      if (oil.length > 0 && oilFilter.length > 0) {
        description = "Óleo do motor + filtro de óleo";
      } else if (oil.length > 0) {
        description = "Óleo do motor";
      } else {
        description = "Filtro de óleo";
      }
      groups.push(
        finalizeGroup({
          groupKey: "oleo_e_filtro_oleo",
          kind: "oil_and_oil_filter",
          title: "Óleo e filtro de óleo",
          description,
          linkItemTitle: "Óleo e filtro de óleo",
          icon: "droplet",
          sourceItems: src,
          sortOrder: 1,
        }),
      );
    }
  }

  // 2) Kit filtros (ar + cabine + combustível)
  {
    const ar = take((it) => itemMatchesAny(it, ["filtro ar"]));
    const cabine = take((it) => itemMatchesAny(it, ["filtro cabine"]));
    const combustivel = take((it) =>
      itemMatchesAny(it, ["filtro combustivel"]),
    );
    const src = [...ar, ...cabine, ...combustivel];
    if (src.length > 0) {
      const parts: string[] = [];
      if (ar.length > 0) parts.push("ar");
      if (cabine.length > 0) parts.push("cabine");
      if (combustivel.length > 0) parts.push("combustível");
      let description: string;
      if (parts.length === 3) {
        description = "Filtro de ar, cabine e combustível";
      } else if (parts.length === 2) {
        description = `Filtro de ${parts[0]} e ${parts[1]}`;
      } else {
        description = `Filtro de ${parts[0]}`;
      }
      groups.push(
        finalizeGroup({
          groupKey: "kit_filtros",
          kind: "filters_kit",
          title: "Kit filtros",
          description,
          linkItemTitle: "Kit filtros",
          icon: "wind",
          sourceItems: src,
          sortOrder: 2,
        }),
      );
    }
  }

  // 3) Pastilhas / discos de freio
  {
    const pastilhas = take(
      (it) =>
        itemMatchesAny(it, ["pastilha"]) && itemHaystack(it).includes("freio"),
    );
    const discos = take(
      (it) =>
        itemMatchesAny(it, ["disco"]) && itemHaystack(it).includes("freio"),
    );
    const src = [...pastilhas, ...discos];
    if (src.length > 0) {
      let title: string;
      if (pastilhas.length > 0 && discos.length > 0) {
        title = "Pastilhas e discos de freio";
      } else if (pastilhas.length > 0) {
        title = "Pastilhas de freio";
      } else {
        title = "Discos de freio";
      }
      groups.push(
        finalizeGroup({
          groupKey: "freio_pastilhas_discos",
          kind: "brake_pads_discs",
          title,
          description: "Componentes de freio conforme aplicação",
          linkItemTitle: title,
          icon: "disc3",
          sourceItems: src,
          sortOrder: 3,
        }),
      );
    }
  }

  // 4) Kit sincronismo
  {
    const src = take((it) =>
      itemMatchesAny(it, [
        "correia dentada",
        "kit sincronismo",
        "sincronismo",
        "tensor",
        "rolamento",
      ]),
    );
    if (src.length > 0) {
      groups.push(
        finalizeGroup({
          groupKey: "kit_sincronismo",
          kind: "timing_kit",
          title: "Troca do kit sincronismo",
          description: "Correia dentada, tensor e rolamentos",
          linkItemTitle: "Kit sincronismo",
          icon: "wrench",
          sourceItems: src,
          sortOrder: 4,
        }),
      );
    }
  }

  // 5) Velas e cabos
  {
    const src = take((it) =>
      itemMatchesAny(it, ["vela", "cabo vela", "cabo de vela", "bobina"]),
    );
    if (src.length > 0) {
      groups.push(
        finalizeGroup({
          groupKey: "velas_e_cabos",
          kind: "spark_plugs_cables",
          title: "Velas e cabos",
          description: "Velas de ignição e cabos de vela",
          linkItemTitle: "Velas e cabos",
          icon: "zap",
          sourceItems: src,
          sortOrder: 5,
        }),
      );
    }
  }

  // 6) Aditivo de arrefecimento
  {
    const src = take((it) =>
      itemMatchesAny(it, [
        "aditivo",
        "arrefecimento",
        "liquido arrefecimento",
        "liquido de arrefecimento",
      ]),
    );
    if (src.length > 0) {
      groups.push(
        finalizeGroup({
          groupKey: "aditivo_arrefecimento",
          kind: "coolant_additive",
          title: "Aditivo de arrefecimento",
          description: "Aditivo + limpeza do sistema",
          linkItemTitle: "Aditivo de arrefecimento",
          icon: "snowflake",
          sourceItems: src,
          sortOrder: 6,
        }),
      );
    }
  }

  // 7 / 8) Fallback individual (mantém ordem relativa do input)
  let individualIndex = 0;
  for (const it of items) {
    if (consumed.has(it.item_key)) continue;
    consumed.add(it.item_key);
    const isServiceOnly = it.shopping_classification === "service_only";
    const description =
      it.notes && it.notes.length > 0 ? it.notes.join(" • ") : undefined;
    const kind: JarvysVisualGroupKind = isServiceOnly
      ? "service_only"
      : "individual";
    const serviceBadgeLabel: JarvysVisualGroupServiceBadge | undefined =
      isServiceOnly
        ? it.recommendation_type === "inspect_only"
          ? "Inspeção em oficina"
          : "Serviço especializado"
        : undefined;
    groups.push({
      groupKey: `individual_${it.item_key}`,
      kind,
      title: it.label,
      description,
      linkItemTitle: it.label,
      icon: "wrench",
      sourceItems: [it],
      sourceItemKeys: [it.item_key],
      sourceLabels: [it.label],
      isServiceOnly,
      serviceBadgeLabel,
      hasMixedServiceItems: undefined,
      serviceItemLabels: undefined,
      sortOrder: (isServiceOnly ? 8000 : 7000) + individualIndex,
    });
    individualIndex += 1;
  }

  return groups.sort((a, b) => a.sortOrder - b.sortOrder);
}
