// Build 7.2 — Card "Revisão Preventiva Jarvys" da aba Shopping.
//
// Não duplica motor determinístico: apenas abre o Sheet existente
// MaintenanceReviewShoppingSheet (que já usa buildJarvysMilestone/visualGroups).
// Sem chamada a IA, FIPE, corpus ou resolver.

import { useState } from "react";
import { Wrench } from "lucide-react";
import { MaintenanceReviewShoppingSheet } from "@/components/maintenance/MaintenanceReviewShoppingSheet";
import type { JarvysVehicleProfile } from "@/lib/maintenance-jarvys-schedule-rules";
import type { MaintenanceShoppingVehicle } from "@/lib/maintenance-mercado-livre-shopping";
import { ShoppingCardShell } from "./ShoppingCardShell";

export type ShoppingRevisionCardProps = {
  hasActiveVehicle: boolean;
  loaded: boolean;
  hasKm: boolean;
  hasUsableProfile: boolean;
  vehicleLabel: string;
  currentKm: number;
  jarvysProfile: JarvysVehicleProfile | null;
  shoppingVehicle: MaintenanceShoppingVehicle;
};

export function ShoppingRevisionCard({
  hasActiveVehicle,
  loaded,
  hasKm,
  hasUsableProfile,
  vehicleLabel,
  currentKm,
  jarvysProfile,
  shoppingVehicle,
}: ShoppingRevisionCardProps) {
  const [open, setOpen] = useState(false);

  const canOpen =
    loaded && hasActiveVehicle && hasKm && hasUsableProfile && jarvysProfile !== null;

  let disabledReason: string | null = null;
  if (loaded) {
    if (!hasActiveVehicle) disabledReason = "Selecione um veículo na garagem.";
    else if (!hasKm) disabledReason = "Atualize a quilometragem do veículo.";
    else if (!hasUsableProfile)
      disabledReason =
        "Não foi possível montar a revisão para este veículo agora.";
  }

  return (
    <>
      <ShoppingCardShell
        icon={<Wrench className="h-5 w-5" />}
        title="Revisão Preventiva Jarvys"
        description="Veja os itens da próxima revisão e ofertas compatíveis para pesquisar."
        cta={canOpen ? "Ver próxima revisão" : undefined}
        disabledText={!canOpen ? disabledReason ?? "Carregando…" : undefined}
        onClick={canOpen ? () => setOpen(true) : undefined}
      />
      {canOpen && jarvysProfile && (
        <MaintenanceReviewShoppingSheet
          open={open}
          onClose={() => setOpen(false)}
          vehicleLabel={vehicleLabel}
          currentKm={currentKm}
          jarvysProfile={jarvysProfile}
          shoppingVehicle={shoppingVehicle}
          showDebug={false}
        />
      )}
    </>
  );
}
