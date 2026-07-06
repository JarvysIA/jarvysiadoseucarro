// Build 7.2 — Card Seguro Auto (placeholder seguro).

import { ShieldCheck } from "lucide-react";
import { ShoppingCardShell } from "./ShoppingCardShell";

export function ShoppingSeguroCard() {
  return (
    <ShoppingCardShell
      icon={<ShieldCheck className="h-5 w-5" />}
      title="Seguro Auto"
      description="Em breve: cotação de seguro auto com parceiros Jarvys."
      badge="Em breve"
    />
  );
}
