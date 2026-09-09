// Build 7.2 — Card "Revisão Preventiva Jarvys" da aba Shopping.
//
// Não duplica motor determinístico: apenas abre o Sheet existente
// MaintenanceReviewShoppingSheet (que já usa buildJarvysMilestone/visualGroups).
// Sem chamada a IA, FIPE, corpus ou resolver.

import { useState } from "react";
import { Wrench } from "lucide-react";
import { MaintenanceReviewShoppingSheet } from "@/components/maintenance/MaintenanceReviewShoppingSheet";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { JarvysVehicleProfile } from "@/lib/maintenance-jarvys-schedule-rules";
import type { MaintenanceShoppingVehicle } from "@/lib/maintenance-mercado-livre-shopping";
import { useGuidedTourStep } from "@/lib/use-guided-tour-step";
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
  const shoppingTour = useGuidedTourStep("shopping");

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
      <Popover open={loaded && shoppingTour.shouldShow}>
        <PopoverAnchor>
          <ShoppingCardShell
            icon={<Wrench className="h-5 w-5" />}
            title="Revisão Preventiva Jarvys"
            description="Confira a próxima revisão do seu carro com os itens indicados."
            cta={canOpen ? "Ver próxima revisão" : undefined}
            disabledText={!canOpen ? disabledReason ?? "Carregando…" : undefined}
            onClick={canOpen ? () => setOpen(true) : undefined}
          />
        </PopoverAnchor>
        <PopoverContent side="bottom" className="w-72">
          <p className="text-sm text-foreground">
            Os links aqui te levam para lojas dos principais marketplaces com as melhores
            ofertas para seu veículo. Prefira sempre as lojas oficiais e confirme
            compatibilidade antes da compra.
          </p>
          <button
            type="button"
            onClick={() => shoppingTour.markSeen()}
            className="glow-neon mt-3 w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            Entendi
          </button>
        </PopoverContent>
      </Popover>
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
