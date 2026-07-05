// Build 6.48 — Sheet reutilizável de Revisão + Shopping Mercado Livre.
//
// Componente puro de UI: sem I/O, sem banco, sem IA, sem tracking.
// Reaproveita motor Jarvys real, agrupamento visual e lista Mercado Livre
// já homologados nos Builds 6.43–6.46.
//
// NÃO é integrado à Home neste build.

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MaintenanceReviewShoppingList } from "@/components/maintenance/MaintenanceReviewShoppingList";
import {
  buildJarvysMilestone,
  type JarvysVehicleProfile,
} from "@/lib/maintenance-jarvys-schedule-rules";
import { buildJarvysVisualGroups } from "@/lib/maintenance-visual-groups";
import type { MaintenanceShoppingVehicle } from "@/lib/maintenance-mercado-livre-shopping";
import { nextMilestone } from "@/lib/predictive-maintenance";

const STEP_KM = 10_000;
const MIN_REVISION_KM = 10_000;

function formatKm(km: number): string {
  return km.toLocaleString("pt-BR");
}

export type MaintenanceReviewShoppingSheetProps = {
  open: boolean;
  onClose: () => void;
  vehicleLabel: string;
  currentKm: number;
  initialRevisionKm?: number;
  jarvysProfile: JarvysVehicleProfile;
  shoppingVehicle: MaintenanceShoppingVehicle;
  showDebug?: boolean;
};

export function MaintenanceReviewShoppingSheet({
  open,
  onClose,
  vehicleLabel,
  currentKm,
  initialRevisionKm,
  jarvysProfile,
  shoppingVehicle,
  showDebug,
}: MaintenanceReviewShoppingSheetProps) {
  const computeInitial = (): number =>
    Math.max(
      MIN_REVISION_KM,
      initialRevisionKm ?? nextMilestone(currentKm),
    );

  const [selectedRevisionKm, setSelectedRevisionKm] = useState<number>(
    computeInitial,
  );

  // Reset ao abrir ou quando os inputs de contexto mudam.
  // Não sobrescreve navegação do usuário enquanto o sheet está aberto.
  useEffect(() => {
    if (!open) return;
    setSelectedRevisionKm(
      Math.max(MIN_REVISION_KM, initialRevisionKm ?? nextMilestone(currentKm)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRevisionKm, currentKm]);

  const milestone = useMemo(
    () => buildJarvysMilestone(selectedRevisionKm, jarvysProfile),
    [selectedRevisionKm, jarvysProfile],
  );

  const visualGroups = useMemo(
    () => buildJarvysVisualGroups(milestone.items),
    [milestone.items],
  );

  const canGoLeft = selectedRevisionKm > MIN_REVISION_KM;
  const isBeforeCurrent = selectedRevisionKm < currentKm;

  const handleLeft = () => {
    setSelectedRevisionKm((km) => Math.max(MIN_REVISION_KM, km - STEP_KM));
  };
  const handleRight = () => {
    setSelectedRevisionKm((km) => km + STEP_KM);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-3xl"
      >
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>{vehicleLabel}</SheetTitle>
          <SheetDescription>
            Km atual informado: {formatKm(currentKm)} km
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2 py-2">
          <button
            type="button"
            onClick={handleLeft}
            disabled={!canGoLeft}
            aria-label="Revisão anterior"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-sm font-semibold">
            Revisão de {formatKm(selectedRevisionKm)} km
          </div>
          <button
            type="button"
            onClick={handleRight}
            aria-label="Próxima revisão"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {isBeforeCurrent && (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            Esta revisão é anterior ao km atual informado. Ela pode ser útil
            para veículos seminovos, histórico desconhecido ou revisão
            preventiva de segurança.
          </div>
        )}

        {milestone.isHighMileage && (
          <div className="mt-3 rounded-md border border-border bg-secondary/60 p-2 text-[11px] text-secondary-foreground">
            Ciclo recorrente pós 200.000 km
          </div>
        )}

        <div className="mt-4 text-xs font-medium text-muted-foreground">
          Itens recomendados para esta revisão
        </div>

        <div className="mt-2">
          <MaintenanceReviewShoppingList
            groups={visualGroups}
            vehicle={shoppingVehicle}
            showDebug={showDebug}
          />
        </div>

        {showDebug && (
          <details className="mt-4 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer">debug geral</summary>
            <div className="mt-1 space-y-0.5 font-mono">
              <div>
                <span className="font-semibold">selectedRevisionKm:</span>{" "}
                {selectedRevisionKm.toLocaleString("pt-BR")}
              </div>
              <div>
                <span className="font-semibold">revisionKmReal:</span>{" "}
                {milestone.revisionKmReal.toLocaleString("pt-BR")}
              </div>
              <div>
                <span className="font-semibold">revisionKmBase:</span>{" "}
                {milestone.revisionKmBase.toLocaleString("pt-BR")}
              </div>
              <div>
                <span className="font-semibold">cycleIndex:</span>{" "}
                {milestone.cycleIndex}
              </div>
              <div>
                <span className="font-semibold">isHighMileage:</span>{" "}
                {String(milestone.isHighMileage)}
              </div>
              <div>
                <span className="font-semibold">revisionNumber:</span>{" "}
                {milestone.revisionNumber}
              </div>
              <div>
                <span className="font-semibold">label:</span> {milestone.label}
              </div>
              <div>
                <span className="font-semibold">items.length:</span>{" "}
                {milestone.items.length}
              </div>
              <div>
                <span className="font-semibold">visualGroups.length:</span>{" "}
                {visualGroups.length}
              </div>
              {milestone.notes.length > 0 && (
                <div className="break-all">
                  <span className="font-semibold">notes:</span>{" "}
                  {milestone.notes.join(" | ")}
                </div>
              )}
            </div>
          </details>
        )}
      </SheetContent>
    </Sheet>
  );
}
