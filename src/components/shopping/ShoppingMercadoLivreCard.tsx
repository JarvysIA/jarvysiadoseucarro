// Build 7.2 — Card Mercado Livre da aba Shopping.
// Reutiliza buildMercadoLivreAffiliateSearchUrl (afiliado Jarvys já validado).

import { ShoppingBag } from "lucide-react";
import { buildMercadoLivreAffiliateSearchUrl } from "@/lib/mercado-livre-affiliate-links";
import { ShoppingCardShell } from "./ShoppingCardShell";

const ML_LINK = buildMercadoLivreAffiliateSearchUrl({
  query: "pecas automotivas",
});

export function ShoppingMercadoLivreCard() {
  return (
    <ShoppingCardShell
      icon={<ShoppingBag className="h-5 w-5" />}
      title="Mercado Livre"
      description="Peças e acessórios automotivos em um só lugar."
      cta="Ver ofertas no Mercado Livre"
      href={ML_LINK.url}
      note="Confirme compatibilidade com o vendedor antes da compra."
    />
  );
}
