// Build 7.2 — Tela inicial da Aba Shopping Jarvys.
//
// Reaproveita:
// - useActiveVehicleId (localStorage store existente).
// - Guards do perfil técnico salvo (sem IA, FIPE, corpus ou resolver).
// - MaintenanceReviewShoppingSheet (motor determinístico interno).
// - Helpers Mercado Livre já homologados.
//
// Não altera Home, motor, BottomNav, banco, pagamentos, OCR, IA ou FIPE.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { useActiveVehicleId } from "@/lib/active-vehicle";
import {
  hasUsableConfidence,
  isUsableJarvysTechnicalProfile,
  normalizeSavedJarvysTechnicalProfile,
} from "@/lib/vehicle-technical-profile-guards";
import type { JarvysVehicleProfile } from "@/lib/maintenance-jarvys-schedule-rules";
import type { MaintenanceShoppingVehicle } from "@/lib/maintenance-mercado-livre-shopping";
import { ShoppingRevisionCard } from "./ShoppingRevisionCard";
import { ShoppingMercadoLivreCard } from "./ShoppingMercadoLivreCard";
import { ShoppingPneusCard } from "./ShoppingPneusCard";
import { ShoppingSeguroCard } from "./ShoppingSeguroCard";
import { ShoppingAutoCenterCard } from "./ShoppingAutoCenterCard";

type ActiveVehicle = {
  id: string;
  placa: string;
  marca: string | null;
  modelo: string | null;
  ano: string | null;
  km_atual: number | null;
  jarvys_technical_profile: unknown;
  jarvys_technical_profile_confidence: string | null;
  jarvys_technical_profile_source: string | null;
  jarvys_technical_profile_updated_at: string | null;
};

export function ShoppingPage() {
  const activeVehicleId = useActiveVehicleId();
  const [vehicle, setVehicle] = useState<ActiveVehicle | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!activeVehicleId) {
      setVehicle(null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    (async () => {
      const { data, error } = await supabase
        .from("veiculos")
        .select(
          "id,placa,marca,modelo,ano,km_atual,jarvys_technical_profile,jarvys_technical_profile_confidence,jarvys_technical_profile_source,jarvys_technical_profile_updated_at",
        )
        .eq("id", activeVehicleId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("[Shopping:vehicle-load-failed]", { reason: error.message });
        setVehicle(null);
      } else {
        setVehicle((data as ActiveVehicle | null) ?? null);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeVehicleId]);

  const jarvysProfile: JarvysVehicleProfile | null = useMemo(
    () => normalizeSavedJarvysTechnicalProfile(vehicle?.jarvys_technical_profile),
    [vehicle?.jarvys_technical_profile],
  );

  const confidenceOk = hasUsableConfidence(vehicle?.jarvys_technical_profile_confidence);
  const profileOk = isUsableJarvysTechnicalProfile(jarvysProfile);
  const hasUsableProfile = confidenceOk && profileOk;

  const kmAtual = vehicle?.km_atual ?? null;
  const hasKm = typeof kmAtual === "number" && Number.isFinite(kmAtual) && kmAtual > 0;

  const vehicleLabel = useMemo(() => {
    if (!vehicle) return "Veículo";
    const parts = [vehicle.marca, vehicle.modelo, vehicle.ano].filter(
      (p): p is string => Boolean(p && p.trim()),
    );
    return parts.join(" ").trim() || "Veículo";
  }, [vehicle]);

  const shoppingVehicle: MaintenanceShoppingVehicle = useMemo(
    () => ({
      brand: vehicle?.marca ?? "",
      model: vehicle?.modelo ?? "",
      year: vehicle?.ano ? Number(vehicle.ano) || undefined : undefined,
    }),
    [vehicle],
  );

  return (
    <div className="relative min-h-screen bg-black pb-32">
      <main className="mx-auto flex w-full max-w-md flex-col px-4 pt-10">
        <h1
          className="text-center font-tech text-2xl uppercase"
          style={{
            color: "#38BDF8",
            textShadow:
              "0 0 8px rgba(56,189,248,0.8), 0 0 22px rgba(56,189,248,0.45)",
          }}
        >
          Shopping Jarvys
        </h1>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Peças, acessórios e serviços para cuidar melhor do seu carro.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <ShoppingRevisionCard
            hasActiveVehicle={Boolean(activeVehicleId)}
            loaded={loaded}
            hasKm={hasKm}
            hasUsableProfile={hasUsableProfile}
            vehicleLabel={vehicleLabel}
            currentKm={hasKm ? (kmAtual as number) : 0}
            jarvysProfile={jarvysProfile}
            shoppingVehicle={shoppingVehicle}
          />
          <ShoppingMercadoLivreCard />
          <ShoppingPneusCard />
          <ShoppingSeguroCard />
          <ShoppingAutoCenterCard />
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
