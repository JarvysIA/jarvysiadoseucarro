// PORTA de src/lib/maintenance-mercado-livre-shopping.ts — cópia deliberada, não reimportar
// de src/lib (Edge Functions rodam em Deno; src/lib usa resolução de
// módulos de bundler/Node). Mesma lógica dos dois lados. Se o motor
// determinístico do app mudar, este arquivo precisa ser atualizado
// manualmente em par. Ver pendência "divergência de vocabulário entre
// os 2 sistemas de reconhecimento" nos documentos de continuidade.

// Build 6.44 — Helper puro: converte item de revisão + veículo em link
// afiliado Mercado Livre reaproveitando o helper do Build 6.43.
//
// Sem React, Supabase, fetch, IA, persistência ou chamada externa.

import {
  buildMercadoLivreAffiliateSearchUrl,
  type MercadoLivreAffiliateSearchResult,
} from "./mercado-livre-affiliate-links.ts";

export type MaintenanceShoppingVehicle = {
  brand?: string;
  model?: string;
  version?: string;
  engine?: string;
  year?: string | number;
};

export type MaintenanceShoppingItemInput = {
  itemTitle: string;
  itemDescription?: string;
  vehicle?: MaintenanceShoppingVehicle;
};

export type MaintenanceMercadoLivreShoppingLink = {
  itemTitle: string;
  itemDescription?: string;
  searchQuery: string;
  mercadoLivre: MercadoLivreAffiliateSearchResult;
};

function normalizePart(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
  const t = s.trim();
  return t === "" ? null : t;
}

export function buildMaintenanceMercadoLivreShoppingLink(
  input: MaintenanceShoppingItemInput,
): MaintenanceMercadoLivreShoppingLink {
  const title = normalizePart(input?.itemTitle);
  if (title === null) {
    throw new Error("empty_item_title");
  }

  const v = input.vehicle ?? {};
  const brand = normalizePart(v.brand);
  const model = normalizePart(v.model);
  const version = normalizePart(v.version);
  const engine = normalizePart(v.engine);
  const year = normalizePart(v.year);

  const parts: string[] = [title];
  if (brand) parts.push(brand);
  if (model) parts.push(model);
  if (version) parts.push(version);
  if (engine) parts.push(engine);
  if (year) {
    parts.push("ano");
    parts.push(year);
  }

  const searchQuery = parts.join(" ").replace(/\s+/g, " ").trim();
  const mercadoLivre = buildMercadoLivreAffiliateSearchUrl({
    query: searchQuery,
  });

  return {
    itemTitle: title,
    itemDescription: input.itemDescription,
    searchQuery,
    mercadoLivre,
  };
}
