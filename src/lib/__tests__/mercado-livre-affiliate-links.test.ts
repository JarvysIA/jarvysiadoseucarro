// Build 6.43 — Testes do helper Mercado Livre afiliado.

import { describe, expect, it } from "bun:test";
import {
  MERCADO_LIVRE_AFFILIATE_PARAMS,
  MERCADO_LIVRE_BASE_SEARCH_URL,
  MERCADO_LIVRE_SHOPPING_WARNINGS,
  buildMercadoLivreAffiliateSearchUrl,
} from "../mercado-livre-affiliate-links";

describe("buildMercadoLivreAffiliateSearchUrl — slug", () => {
  it("remove acentos e normaliza pontos", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({
      query: "óleo e filtro C3 1.4 GLX ano 2008",
    });
    expect(r.slug).toBe("oleo-e-filtro-c3-1-4-glx-ano-2008");
  });

  it("colapsa símbolos, barras, vírgulas, parênteses e espaços múltiplos", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({
      query: "  Kit   sincronismo,,  Palio/1.0 (fire)  2012!! ",
    });
    expect(r.slug).toBe("kit-sincronismo-palio-1-0-fire-2012");
    // Nunca deve conter hífens duplicados nem pontas com hífen.
    expect(r.slug.includes("--")).toBe(false);
    expect(r.slug.startsWith("-")).toBe(false);
    expect(r.slug.endsWith("-")).toBe(false);
  });

  it("lança empty_query para string vazia", () => {
    expect(() => buildMercadoLivreAffiliateSearchUrl({ query: "" })).toThrow(
      "empty_query",
    );
  });

  it("lança empty_query para query apenas com símbolos", () => {
    expect(() =>
      buildMercadoLivreAffiliateSearchUrl({ query: "!!! --- ///" }),
    ).toThrow("empty_query");
  });
});

describe("buildMercadoLivreAffiliateSearchUrl — URL", () => {
  it("contém base + slug + parâmetros afiliados", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({
      query: "pastilhas de freio compass 2.0 2020",
    });
    expect(r.url.startsWith(MERCADO_LIVRE_BASE_SEARCH_URL + r.slug)).toBe(true);
    expect(r.url).toContain("matt_word=jarvys_ia");
    expect(r.url).toContain("matt_tool=49601394");
    expect(r.url).toContain("forceInApp=true");
  });

  it("é idempotente para a mesma query", () => {
    const a = buildMercadoLivreAffiliateSearchUrl({ query: "velas gol 1.6" });
    const b = buildMercadoLivreAffiliateSearchUrl({ query: "velas gol 1.6" });
    expect(a.url).toBe(b.url);
    expect(a.slug).toBe(b.slug);
  });

  it("caso real validado com clique confirmado", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({
      query: "óleo e filtro C3 1.4 GLX ano 2008",
    });
    expect(r.url).toBe(
      "https://lista.mercadolivre.com.br/oleo-e-filtro-c3-1-4-glx-ano-2008?matt_word=jarvys_ia&matt_tool=49601394&forceInApp=true",
    );
  });

  it("trackingStatus e affiliate params corretos", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({ query: "óleo motor" });
    expect(r.trackingStatus).toBe("validated_click_pending_sale");
    expect(r.affiliate).toEqual(MERCADO_LIVRE_AFFILIATE_PARAMS);
  });
});

describe("MERCADO_LIVRE_SHOPPING_WARNINGS", () => {
  it("contém as 3 chaves esperadas com textos exatos", () => {
    expect(Object.keys(MERCADO_LIVRE_SHOPPING_WARNINGS).sort()).toEqual([
      "compatibility",
      "offers",
      "officialStores",
    ]);
    expect(MERCADO_LIVRE_SHOPPING_WARNINGS.offers).toBe(
      "🛒 As melhores ofertas pra revisar seu carro",
    );
    expect(MERCADO_LIVRE_SHOPPING_WARNINGS.compatibility).toBe(
      "🔎 Antes da compra, confirme com o vendedor a compatibilidade com seu veículo.",
    );
    expect(MERCADO_LIVRE_SHOPPING_WARNINGS.officialStores).toBe(
      "Para uma compra mais segura, filtre apenas lojas oficiais.",
    );
  });
});
