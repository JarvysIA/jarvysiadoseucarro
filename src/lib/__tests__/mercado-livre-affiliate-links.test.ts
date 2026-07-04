// Build 6.43 — Testes do helper Mercado Livre afiliado.
// Usa apenas describe/test/expect(toBe/toContain) para bater com o shim
// ambient de bun:test criado no Build 6.42F.

import { describe, test, expect } from "bun:test";
import {
  MERCADO_LIVRE_AFFILIATE_PARAMS,
  MERCADO_LIVRE_BASE_SEARCH_URL,
  MERCADO_LIVRE_SHOPPING_WARNINGS,
  buildMercadoLivreAffiliateSearchUrl,
} from "../mercado-livre-affiliate-links";

function expectThrowsEmptyQuery(fn: () => unknown): void {
  let thrown: unknown = null;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown instanceof Error).toBe(true);
  expect((thrown as Error).message).toBe("empty_query");
}

describe("buildMercadoLivreAffiliateSearchUrl — slug", () => {
  test("remove acentos e normaliza pontos", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({
      query: "óleo e filtro C3 1.4 GLX ano 2008",
    });
    expect(r.slug).toBe("oleo-e-filtro-c3-1-4-glx-ano-2008");
  });

  test("colapsa símbolos, barras, vírgulas, parênteses e espaços múltiplos", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({
      query: "  Kit   sincronismo,,  Palio/1.0 (fire)  2012!! ",
    });
    expect(r.slug).toBe("kit-sincronismo-palio-1-0-fire-2012");
    expect(r.slug.includes("--")).toBe(false);
    expect(r.slug.startsWith("-")).toBe(false);
    expect(r.slug.endsWith("-")).toBe(false);
  });

  test("lança empty_query para string vazia", () => {
    expectThrowsEmptyQuery(() =>
      buildMercadoLivreAffiliateSearchUrl({ query: "" }),
    );
  });

  test("lança empty_query para query apenas com símbolos", () => {
    expectThrowsEmptyQuery(() =>
      buildMercadoLivreAffiliateSearchUrl({ query: "!!! --- ///" }),
    );
  });
});

describe("buildMercadoLivreAffiliateSearchUrl — URL", () => {
  test("contém base + slug + parâmetros afiliados", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({
      query: "pastilhas de freio compass 2.0 2020",
    });
    expect(r.url.startsWith(MERCADO_LIVRE_BASE_SEARCH_URL + r.slug)).toBe(true);
    expect(r.url).toContain("matt_word=jarvys_ia");
    expect(r.url).toContain("matt_tool=49601394");
    expect(r.url).toContain("forceInApp=true");
  });

  test("é idempotente para a mesma query", () => {
    const a = buildMercadoLivreAffiliateSearchUrl({ query: "velas gol 1.6" });
    const b = buildMercadoLivreAffiliateSearchUrl({ query: "velas gol 1.6" });
    expect(a.url).toBe(b.url);
    expect(a.slug).toBe(b.slug);
  });

  test("caso real validado com clique confirmado", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({
      query: "óleo e filtro C3 1.4 GLX ano 2008",
    });
    expect(r.url).toBe(
      "https://lista.mercadolivre.com.br/oleo-e-filtro-c3-1-4-glx-ano-2008?matt_word=jarvys_ia&matt_tool=49601394&forceInApp=true",
    );
  });

  test("trackingStatus e affiliate params corretos", () => {
    const r = buildMercadoLivreAffiliateSearchUrl({ query: "óleo motor" });
    expect(r.trackingStatus).toBe("validated_click_pending_sale");
    expect(r.affiliate.matt_word).toBe(MERCADO_LIVRE_AFFILIATE_PARAMS.matt_word);
    expect(r.affiliate.matt_tool).toBe(MERCADO_LIVRE_AFFILIATE_PARAMS.matt_tool);
    expect(r.affiliate.forceInApp).toBe(
      MERCADO_LIVRE_AFFILIATE_PARAMS.forceInApp,
    );
  });
});

describe("MERCADO_LIVRE_SHOPPING_WARNINGS", () => {
  test("contém as 3 chaves esperadas com textos exatos", () => {
    const keys = Object.keys(MERCADO_LIVRE_SHOPPING_WARNINGS).sort().join(",");
    expect(keys).toBe("compatibility,offers,officialStores");
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
