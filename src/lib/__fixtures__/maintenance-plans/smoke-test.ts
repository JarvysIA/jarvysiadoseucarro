/**
 * Smoke test puro (sem Supabase, sem React, sem I/O) para o schema
 * `maintenance_plan_json`. Pode ser executado manualmente para verificar
 * que as fixtures válidas passam, as inválidas falham, e duas asserções
 * extras sobre bundles continuam verdadeiras.
 *
 * Não roda automaticamente no app. Não altera runtime.
 */

import { safeParseMaintenancePlanJson } from "../../maintenance-plan-validation";
import { peugeot2008_2017Plan } from "./peugeot-2008-2017";
import { fiatArgo2023Plan } from "./fiat-argo-2023";
import {
  invalidSchemaVersionPlan,
  invalidEmptyMilestonesPlan,
  invalidConfidencePlan,
  invalidNegativeKmPlan,
  invalidBundleWithoutItemsPlan,
  invalidNotApplicableInconsistentPlan,
} from "./invalid-maintenance-plans";

export type SmokeTestResult = {
  validPassed: string[];
  validFailed: { name: string; error: string }[];
  invalidRejected: string[];
  invalidAccepted: string[];
  extraAssertions: { name: string; passed: boolean; detail?: string }[];
};

export function runMaintenancePlanSchemaSmokeTest(): SmokeTestResult {
  const result: SmokeTestResult = {
    validPassed: [],
    validFailed: [],
    invalidRejected: [],
    invalidAccepted: [],
    extraAssertions: [],
  };

  const validCases: { name: string; plan: unknown }[] = [
    { name: "peugeot2008_2017Plan", plan: peugeot2008_2017Plan },
    { name: "fiatArgo2023Plan", plan: fiatArgo2023Plan },
  ];

  for (const { name, plan } of validCases) {
    const parsed = safeParseMaintenancePlanJson(plan);
    if (parsed.success) {
      result.validPassed.push(name);
    } else {
      result.validFailed.push({
        name,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      });
    }
  }

  const invalidCases: { name: string; plan: unknown }[] = [
    { name: "invalidSchemaVersionPlan", plan: invalidSchemaVersionPlan },
    { name: "invalidEmptyMilestonesPlan", plan: invalidEmptyMilestonesPlan },
    { name: "invalidConfidencePlan", plan: invalidConfidencePlan },
    { name: "invalidNegativeKmPlan", plan: invalidNegativeKmPlan },
    {
      name: "invalidBundleWithoutItemsPlan",
      plan: invalidBundleWithoutItemsPlan,
    },
    {
      name: "invalidNotApplicableInconsistentPlan",
      plan: invalidNotApplicableInconsistentPlan,
    },
  ];

  for (const { name, plan } of invalidCases) {
    const parsed = safeParseMaintenancePlanJson(plan);
    if (parsed.success) {
      result.invalidAccepted.push(name);
    } else {
      result.invalidRejected.push(name);
    }
  }

  // Asserções extras sobre bundles.
  const argoHasTimingBeltBundle =
    (fiatArgo2023Plan.purchase_bundles ?? []).some(
      (b) => b.bundle_type === "kit_correia_dentada",
    ) ||
    (fiatArgo2023Plan.purchase_bundles ?? []).some(
      (b) => b.bundle_key === "kit_correia_dentada",
    );

  result.extraAssertions.push({
    name: "Argo NÃO possui bundle comprável de kit_correia_dentada",
    passed: !argoHasTimingBeltBundle,
    detail: argoHasTimingBeltBundle
      ? "Encontrado bundle de correia dentada no Argo (motor é corrente)."
      : undefined,
  });

  const peugeotHasTimingBeltBundle = (
    peugeot2008_2017Plan.purchase_bundles ?? []
  ).some((b) => b.bundle_type === "kit_correia_dentada");

  result.extraAssertions.push({
    name: "Peugeot 2008 POSSUI bundle de kit_correia_dentada",
    passed: peugeotHasTimingBeltBundle,
    detail: peugeotHasTimingBeltBundle
      ? undefined
      : "Bundle de correia dentada ausente no Peugeot (esperado para motor com correia).",
  });

  // Asserção extra: Argo tem item kit_correia_dentada como not_applicable.
  const argoNotApplicableKit = fiatArgo2023Plan.milestones
    .flatMap((m) => m.items)
    .some(
      (i) =>
        i.item_key === "kit_correia_dentada" &&
        i.recommendation_type === "not_applicable" &&
        i.applies === false &&
        i.shopping_classification === "not_applicable",
    );

  result.extraAssertions.push({
    name: "Argo contém kit_correia_dentada como not_applicable",
    passed: argoNotApplicableKit,
  });

  return result;
}
