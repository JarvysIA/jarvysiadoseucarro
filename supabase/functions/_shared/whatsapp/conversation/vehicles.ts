// Build 5.7F2A — Resolver determinístico de veículo em foco.
// Puro. Sem fuzzy matching amplo.

import type { ConversationVehicle } from "./types.ts";
import { normalizeCommandText } from "./normalize.ts";

export type VehicleResolveResult =
  | { kind: "matched"; vehicle: ConversationVehicle }
  | { kind: "ambiguous"; candidates: ConversationVehicle[]; options: string[] }
  | { kind: "not_found" }
  | { kind: "no_eligible_vehicle" };

/** Sanitiza placa: uppercase, mantém apenas A-Z0-9. */
export function normalizePlate(value: string | null | undefined): string {
  if (!value) return "";
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function eligible(vehicles: ConversationVehicle[]): ConversationVehicle[] {
  return vehicles.filter((v) => v.isEligible && !v.isArchived);
}

function labelOf(v: ConversationVehicle): string {
  if (v.optionalLabel && v.optionalLabel.trim() !== "") return v.optionalLabel;
  const brand = (v.brand ?? "").trim();
  const model = (v.model ?? "").trim();
  if (brand && model) return `${brand} ${model}`;
  if (model) return model;
  if (brand) return brand;
  if (v.plate) return v.plate;
  return "(sem descrição)";
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export type VehicleResolveInput = {
  text: string | null;
  vehicles: ConversationVehicle[];
  activeVehicleId: string | null;
  contextVehicleId?: string | null;
};

export function resolveVehicle(input: VehicleResolveInput): VehicleResolveResult {
  const pool = eligible(input.vehicles);
  if (pool.length === 0) return { kind: "no_eligible_vehicle" };

  // 1) veículo de contexto explícito
  if (input.contextVehicleId) {
    const ctx = pool.find((v) => v.id === input.contextVehicleId);
    if (ctx) return { kind: "matched", vehicle: ctx };
  }

  const normalized = normalizeCommandText(input.text);
  const plateQuery = normalizePlate(input.text);
  const textUpper = normalized.normalizedText;

  if (textUpper !== "" || plateQuery !== "") {
    // 2) placa exata (7 chars)
    if (plateQuery.length >= 7) {
      const exact = pool.filter((v) => normalizePlate(v.plate) === plateQuery);
      if (exact.length === 1) return { kind: "matched", vehicle: exact[0]! };
    }

    // 3) placa parcial única de 3 ou 4 chars (sufixo)
    if (plateQuery.length === 3 || plateQuery.length === 4) {
      const partial = pool.filter((v) => {
        const p = normalizePlate(v.plate);
        return p !== "" && p.endsWith(plateQuery);
      });
      if (partial.length === 1) return { kind: "matched", vehicle: partial[0]! };
      if (partial.length > 1) {
        return {
          kind: "ambiguous",
          candidates: partial,
          options: unique(partial.map(labelOf)),
        };
      }
    }

    // 4) marca + modelo exatos
    const brandModel = pool.filter((v) => {
      const brand = normalizeCommandText(v.brand).normalizedText;
      const model = normalizeCommandText(v.model).normalizedText;
      if (brand === "" || model === "") return false;
      return textUpper === `${brand} ${model}`;
    });
    if (brandModel.length === 1) return { kind: "matched", vehicle: brandModel[0]! };
    if (brandModel.length > 1) {
      return {
        kind: "ambiguous",
        candidates: brandModel,
        options: unique(brandModel.map(labelOf)),
      };
    }

    // 5) modelo exato único
    const modelMatch = pool.filter(
      (v) => normalizeCommandText(v.model).normalizedText === textUpper && textUpper !== "",
    );
    if (modelMatch.length === 1) return { kind: "matched", vehicle: modelMatch[0]! };
    if (modelMatch.length > 1) {
      return {
        kind: "ambiguous",
        candidates: modelMatch,
        options: unique(modelMatch.map(labelOf)),
      };
    }
  }

  // 6) activeVehicleId ainda elegível
  if (input.activeVehicleId) {
    const active = pool.find((v) => v.id === input.activeVehicleId);
    if (active && textUpper === "") return { kind: "matched", vehicle: active };
  }

  // 7) veículo único elegível (apenas quando não há tentativa de match textual)
  if (pool.length === 1 && textUpper === "" && plateQuery === "") {
    return { kind: "matched", vehicle: pool[0]! };
  }

  return { kind: "not_found" };
}

export function vehicleLabel(v: ConversationVehicle): string {
  return labelOf(v);
}
