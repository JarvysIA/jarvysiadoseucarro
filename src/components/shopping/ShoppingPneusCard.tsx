// Build 7.2 — Card Pneus (placeholder seguro, sem link ainda).

import { CircleDot } from "lucide-react";
import { ShoppingCardShell } from "./ShoppingCardShell";

export function ShoppingPneusCard() {
  return (
    <ShoppingCardShell
      icon={<CircleDot className="h-5 w-5" />}
      title="Pneus"
      description="Em breve: ofertas de pneus para pesquisar com mais praticidade."
      badge="Em breve"
    />
  );
}
