// Build 6.51 — Guards puros para consumir jarvys_technical_profile na Home.
//
// Zero I/O. Zero React. Zero banco. Zero IA.
// Só valida se um profile salvo é completo/confiável o bastante para gerar o
// cronograma real determinístico Jarvys.

import type {
  JarvysFuelKind,
  JarvysSteeringKind,
  JarvysTransmissionKind,
  JarvysVehicleProfile,
} from "./maintenance-jarvys-schedule-rules";
import type { TimingSystem } from "./maintenance-plan-schema";

const FUEL_KINDS: ReadonlySet<JarvysFuelKind> = new Set<JarvysFuelKind>([
  "combustao",
  "hibrido_combustao",
  "eletrico_puro",
]);

const TIMING_SYSTEMS: ReadonlySet<TimingSystem> = new Set<TimingSystem>([
  "correia_dentada",
  "correia_banhada",
  "corrente",
  "nao_aplicavel",
]);

const TRANSMISSION_KINDS: ReadonlySet<JarvysTransmissionKind> = new Set<JarvysTransmissionKind>([
  "manual",
  "automatico",
  "cvt",
  "e_cvt",
  "automatizado",
  "dupla_embreagem",
  "caixa_reducao",
]);

const STEERING_KINDS: ReadonlySet<JarvysSteeringKind> = new Set<JarvysSteeringKind>([
  "hidraulica",
  "eletrica",
]);

export function isUsableJarvysTechnicalProfile(
  value: unknown,
): value is JarvysVehicleProfile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  const fuelKind = v.fuelKind;
  const timingSystem = v.timingSystem;
  const transmissionKind = v.transmissionKind;
  const steeringKind = v.steeringKind;

  if (typeof fuelKind !== "string" || !FUEL_KINDS.has(fuelKind as JarvysFuelKind)) {
    return false;
  }
  if (
    typeof timingSystem !== "string" ||
    !TIMING_SYSTEMS.has(timingSystem as TimingSystem)
  ) {
    return false;
  }
  if (
    typeof transmissionKind !== "string" ||
    !TRANSMISSION_KINDS.has(transmissionKind as JarvysTransmissionKind)
  ) {
    return false;
  }
  if (
    typeof steeringKind !== "string" ||
    !STEERING_KINDS.has(steeringKind as JarvysSteeringKind)
  ) {
    return false;
  }

  // Regras cruzadas
  if (fuelKind === "combustao" || fuelKind === "hibrido_combustao") {
    if (timingSystem === "nao_aplicavel") return false;
    if (transmissionKind === "caixa_reducao") return false;
  }

  if (fuelKind === "eletrico_puro") {
    if (timingSystem !== "nao_aplicavel") return false;
  }

  return true;
}

export function hasUsableConfidence(
  confidence: unknown,
): confidence is "high" | "medium" {
  return confidence === "high" || confidence === "medium";
}
