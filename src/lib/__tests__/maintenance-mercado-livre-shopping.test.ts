// Build 6.44 — Testes do helper de shopping Mercado Livre por item de revisão.

import { describe, test, expect } from "bun:test";
import {
  buildMaintenanceMercadoLivreShoppingLink,
} from "../maintenance-mercado-livre-shopping";
import { MERCADO_LIVRE_SHOPPING_WARNINGS } from "../mercado-livre-affiliate-links";

describe("buildMaintenanceMercadoLivreShoppingLink — searchQuery", () => {
  test("monta query com veículo completo", () => {
    const r = buildMaintenanceMercadoLivreShoppingLink({
      itemTitle: "Óleo e filtro de óleo",
      vehicle: {
        brand: "Citroën",
        model: "C3",
        version: "GLX",
        engine: "1.4",
        year: 2008,
      },
    });
    expect(r.searchQuery).toBe(
      "Óleo e filtro de óleo Citroën C3 GLX 1.4 ano 2008",
    );
  });

  test("funciona com veículo parcial", () => {
    const r = buildMaintenanceMercadoLivreShoppingLink({
      itemTitle: "Pastilhas de freio",
      vehicle: { model: "Compass", engine: "2.0", year: 2020 },
    });
    expect(r.searchQuery).toBe("Pastilhas de freio Compass 2.0 ano 2020");
  });

  test("não gera espaços duplos nem 'ano' órfão", () => {
    const r = buildMaintenanceMercadoLivreShoppingLink({
      itemTitle: "Velas",
      vehicle: { brand: "", model: undefined, engine: "  ", version: "" },
    });
    expect(r.searchQuery).toBe("Velas");
    expect(r.searchQuery.includes("  ")).toBe(false);
    expect(r.searchQuery.includes("ano")).toBe(false);
  });
});

describe("buildMaintenanceMercadoLivreShoppingLink — URL afiliada", () => {
  test("URL contém base e parâmetros afiliados", () => {
    const r = buildMaintenanceMercadoLivreShoppingLink({
      itemTitle: "Óleo e filtro de óleo",
      vehicle: {
        brand: "Citroën",
        model: "C3",
        version: "GLX",
        engine: "1.4",
        year: 2008,
      },
    });
    expect(r.mercadoLivre.url.startsWith("https://lista.mercadolivre.com.br/")).toBe(
      true,
    );
    expect(r.mercadoLivre.url).toContain("matt_word=jarvys_ia");
    expect(r.mercadoLivre.url).toContain("matt_tool=49601394");
    expect(r.mercadoLivre.url).toContain("forceInApp=true");
  });

  test("trackingStatus preservado", () => {
    const r = buildMaintenanceMercadoLivreShoppingLink({
      itemTitle: "Óleo motor",
    });
    expect(r.mercadoLivre.trackingStatus).toBe("validated_click_pending_sale");
  });

  test("caso kit sincronismo Citroën C3 GLX 1.4 2008", () => {
    const r = buildMaintenanceMercadoLivreShoppingLink({
      itemTitle: "Troca do kit sincronismo",
      vehicle: {
        brand: "Citroën",
        model: "C3",
        version: "GLX",
        engine: "1.4",
        year: 2008,
      },
    });
    expect(r.mercadoLivre.slug).toBe(
      "troca-do-kit-sincronismo-citroen-c3-glx-1-4-ano-2008",
    );
    expect(r.mercadoLivre.url).toContain("matt_word=jarvys_ia");
  });
});

describe("buildMaintenanceMercadoLivreShoppingLink — erros", () => {
  test("itemTitle vazio lança empty_item_title", () => {
    let thrown: unknown = null;
    try {
      buildMaintenanceMercadoLivreShoppingLink({ itemTitle: "" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof Error).toBe(true);
    expect((thrown as Error).message).toBe("empty_item_title");
  });

  test("itemTitle só com espaços lança empty_item_title", () => {
    let thrown: unknown = null;
    try {
      buildMaintenanceMercadoLivreShoppingLink({ itemTitle: "   " });
    } catch (e) {
      thrown = e;
    }
    expect(thrown instanceof Error).toBe(true);
    expect((thrown as Error).message).toBe("empty_item_title");
  });
});

describe("guardrail: MERCADO_LIVRE_SHOPPING_WARNINGS", () => {
  test("chaves e textos exatos", () => {
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
