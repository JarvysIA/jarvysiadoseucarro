// Build 6.51 — Testes dos guards puros do profile técnico Jarvys.

import { describe, expect, test } from "bun:test";

import {
  hasUsableConfidence,
  isUsableJarvysTechnicalProfile,
} from "@/lib/vehicle-technical-profile-guards";

describe("isUsableJarvysTechnicalProfile", () => {
  test("aceita combustao/correia_dentada/automatico/eletrica", () => {
    expect(
      isUsableJarvysTechnicalProfile({
        fuelKind: "combustao",
        timingSystem: "correia_dentada",
        transmissionKind: "automatico",
        steeringKind: "eletrica",
      }),
    ).toBe(true);
  });

  test("aceita hibrido_combustao/corrente/e_cvt/eletrica", () => {
    expect(
      isUsableJarvysTechnicalProfile({
        fuelKind: "hibrido_combustao",
        timingSystem: "corrente",
        transmissionKind: "e_cvt",
        steeringKind: "eletrica",
      }),
    ).toBe(true);
  });

  test("aceita eletrico_puro/nao_aplicavel/caixa_reducao/eletrica", () => {
    expect(
      isUsableJarvysTechnicalProfile({
        fuelKind: "eletrico_puro",
        timingSystem: "nao_aplicavel",
        transmissionKind: "caixa_reducao",
        steeringKind: "eletrica",
      }),
    ).toBe(true);
  });

  test("rejeita combustao com timingSystem nao_aplicavel", () => {
    expect(
      isUsableJarvysTechnicalProfile({
        fuelKind: "combustao",
        timingSystem: "nao_aplicavel",
        transmissionKind: "manual",
        steeringKind: "eletrica",
      }),
    ).toBe(false);
  });

  test("rejeita combustao com transmissionKind caixa_reducao", () => {
    expect(
      isUsableJarvysTechnicalProfile({
        fuelKind: "combustao",
        timingSystem: "corrente",
        transmissionKind: "caixa_reducao",
        steeringKind: "eletrica",
      }),
    ).toBe(false);
  });

  test("rejeita eletrico_puro com correia_dentada/corrente/correia_banhada", () => {
    for (const ts of ["correia_dentada", "corrente", "correia_banhada"]) {
      expect(
        isUsableJarvysTechnicalProfile({
          fuelKind: "eletrico_puro",
          timingSystem: ts,
          transmissionKind: "caixa_reducao",
          steeringKind: "eletrica",
        }),
      ).toBe(false);
    }
  });

  test("rejeita timingSystem desconhecido", () => {
    expect(
      isUsableJarvysTechnicalProfile({
        fuelKind: "combustao",
        timingSystem: "desconhecido",
        transmissionKind: "manual",
        steeringKind: "eletrica",
      }),
    ).toBe(false);
  });

  test("rejeita transmissionKind desconhecido", () => {
    expect(
      isUsableJarvysTechnicalProfile({
        fuelKind: "combustao",
        timingSystem: "correia_dentada",
        transmissionKind: "desconhecido",
        steeringKind: "eletrica",
      }),
    ).toBe(false);
  });

  test("rejeita steeringKind desconhecida", () => {
    expect(
      isUsableJarvysTechnicalProfile({
        fuelKind: "combustao",
        timingSystem: "correia_dentada",
        transmissionKind: "manual",
        steeringKind: "desconhecida",
      }),
    ).toBe(false);
  });

  test("rejeita profile null", () => {
    expect(isUsableJarvysTechnicalProfile(null)).toBe(false);
    expect(isUsableJarvysTechnicalProfile(undefined)).toBe(false);
  });

  test("rejeita objeto incompleto", () => {
    expect(
      isUsableJarvysTechnicalProfile({
        fuelKind: "combustao",
        timingSystem: "correia_dentada",
        transmissionKind: "manual",
      }),
    ).toBe(false);
    expect(isUsableJarvysTechnicalProfile({})).toBe(false);
  });
});

describe("hasUsableConfidence", () => {
  test("aceita high e medium", () => {
    expect(hasUsableConfidence("high")).toBe(true);
    expect(hasUsableConfidence("medium")).toBe(true);
  });

  test("rejeita low, null, undefined e outros", () => {
    expect(hasUsableConfidence("low")).toBe(false);
    expect(hasUsableConfidence(null)).toBe(false);
    expect(hasUsableConfidence(undefined)).toBe(false);
    expect(hasUsableConfidence("HIGH")).toBe(false);
    expect(hasUsableConfidence("")).toBe(false);
    expect(hasUsableConfidence(1)).toBe(false);
  });
});
