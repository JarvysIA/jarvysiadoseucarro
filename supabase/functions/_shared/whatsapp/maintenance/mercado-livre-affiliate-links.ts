// PORTA de src/lib/mercado-livre-affiliate-links.ts — cópia deliberada, não reimportar
// de src/lib (Edge Functions rodam em Deno; src/lib usa resolução de
// módulos de bundler/Node). Mesma lógica dos dois lados. Se o motor
// determinístico do app mudar, este arquivo precisa ser atualizado
// manualmente em par. Ver pendência "divergência de vocabulário entre
// os 2 sistemas de reconhecimento" nos documentos de continuidade.

// Build 6.43 — Helper puro para gerar links de busca dinâmica do Mercado Livre
// com parâmetros afiliados do Jarvys.
//
// Cliques com estes parâmetros já foram validados no portal de afiliados.
// A conversão em comissão só é confirmada após venda real, por isso o
// trackingStatus permanece "validated_click_pending_sale".
//
// Sem React, Supabase, fetch, IA, motor de revisão ou persistência.

export const MERCADO_LIVRE_AFFILIATE_PARAMS = {
  matt_word: "jarvys_ia",
  matt_tool: "49601394",
  forceInApp: "true",
} as const;

export const MERCADO_LIVRE_BASE_SEARCH_URL = "https://lista.mercadolivre.com.br/";

export const MERCADO_LIVRE_SHOPPING_WARNINGS = {
  offers: "🛒 As melhores ofertas pra revisar seu carro",
  compatibility: "🔎 Antes da compra, confirme com o vendedor a compatibilidade com seu veículo.",
  officialStores: "Para uma compra mais segura, filtre apenas lojas oficiais.",
} as const;

export type MercadoLivreAffiliateSearchResult = {
  query: string;
  slug: string;
  url: string;
  affiliate: typeof MERCADO_LIVRE_AFFILIATE_PARAMS;
  trackingStatus: "validated_click_pending_sale";
};

// ─── Slug ────────────────────────────────────────────────────────────────

function toSearchSlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── API pública ─────────────────────────────────────────────────────────

export function buildMercadoLivreAffiliateSearchUrl(input: {
  query: string;
}): MercadoLivreAffiliateSearchResult {
  const query = typeof input?.query === "string" ? input.query : "";
  const slug = toSearchSlug(query);
  if (slug === "") {
    throw new Error("empty_query");
  }

  // Usa URL/URLSearchParams para preservar encoding e evitar duplicar '?'.
  const url = new URL(slug, MERCADO_LIVRE_BASE_SEARCH_URL);
  url.searchParams.set("matt_word", MERCADO_LIVRE_AFFILIATE_PARAMS.matt_word);
  url.searchParams.set("matt_tool", MERCADO_LIVRE_AFFILIATE_PARAMS.matt_tool);
  url.searchParams.set("forceInApp", MERCADO_LIVRE_AFFILIATE_PARAMS.forceInApp);

  return {
    query,
    slug,
    url: url.toString(),
    affiliate: MERCADO_LIVRE_AFFILIATE_PARAMS,
    trackingStatus: "validated_click_pending_sale",
  };
}
