// Build 7.2 — Card "Auto Center Próximo" da aba Shopping.
//
// Abre link universal do Google Maps. Sem SDK, sem geolocation API,
// sem promessa de filtro por avaliação.

import { MapPin } from "lucide-react";
import { ShoppingCardShell } from "./ShoppingCardShell";

const MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=auto+center+pr%C3%B3ximo";

export function ShoppingAutoCenterCard() {
  return (
    <ShoppingCardShell
      icon={<MapPin className="h-5 w-5" />}
      title="Auto Center Próximo"
      description="Encontre auto centers próximos e verifique as avaliações antes de escolher."
      cta="Buscar auto centers"
      href={MAPS_URL}
    />
  );
}
