// Build 6.50D — Testes do helper IA puro de perfil técnico Jarvys.
// Sem chamada real de IA. Apenas prompt e validador.

import { describe, expect, test } from "bun:test";

import {
  buildAiPrompt,
  validateAiResolvedTechnicalProfile,
} from "@/lib/vehicle-technical-profile-ai";

describe("buildAiPrompt", () => {
  test("inclui dados do veículo, enums e proibição de cronograma", () => {
    const { system, user } = buildAiPrompt({
      marca: "Hyundai",
      modelo: "i30",
      modelo_fipe: "i30 2.0 16V 145cv 5p Aut.",
      ano: 2012,
      ano_modelo: 2012,
      combustivel_fipe: "Gasolina",
      motorizacao: "2.0",
      cilindradas: 2000,
    });
    expect(system.toLowerCase()).toContain("classificador");
    expect(system.toLowerCase()).toContain("json");
    expect(user).toContain("Hyundai");
    expect(user).toContain("i30");
    expect(user).toContain("fuelKind");
    expect(user).toContain("timingSystem");
    expect(user).toContain("transmissionKind");
    expect(user).toContain("steeringKind");
    expect(user).toContain("confidence");
    expect(user).toContain("caixa_reducao");
    expect(user).toContain("nao_aplicavel");
    expect(user.toLowerCase()).toContain("não assuma que todo híbrido");
    expect(user.toLowerCase()).toContain("nunca use high");
  });

  test("não inclui placa/chassi/user_id", () => {
    const { user } = buildAiPrompt({ marca: "Fiat", modelo: "Argo" });
    expect(user.toLowerCase().includes("placa")).toBe(false);
    expect(user.toLowerCase().includes("chassi")).toBe(false);
    expect(user.toLowerCase().includes("user_id")).toBe(false);
  });
});

describe("validateAiResolvedTechnicalProfile", () => {
  const i30Ok = {
    fuelKind: "combustao",
    timingSystem: "correia_dentada",
    transmissionKind: "automatico",
    steeringKind: "eletrica",
    confidence: "medium",
    evidence: ["Modelo FIPE indica Hyundai i30 2.0 automático"],
    warnings: [],
  };

  test("aceita i30 combustao/correia_dentada/automatico/eletrica/medium", () => {
    const r = validateAiResolvedTechnicalProfile(i30Ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.confidence).toBe("medium");
      expect(r.profile.fuelKind).toBe("combustao");
      expect(r.profile.timingSystem).toBe("correia_dentada");
      expect(r.profile.transmissionKind).toBe("automatico");
      expect(r.profile.steeringKind).toBe("eletrica");
    }
  });

  test("aceita EV eletrico_puro/nao_aplicavel/caixa_reducao/eletrica/medium", () => {
    const r = validateAiResolvedTechnicalProfile({
      fuelKind: "eletrico_puro",
      timingSystem: "nao_aplicavel",
      transmissionKind: "caixa_reducao",
      steeringKind: "eletrica",
      confidence: "medium",
      evidence: ["Modelo identificado como BEV"],
      warnings: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.fuelKind).toBe("eletrico_puro");
      expect(r.profile.timingSystem).toBe("nao_aplicavel");
      expect(r.profile.transmissionKind).toBe("caixa_reducao");
    }
  });

  test("aceita híbrido com e_cvt quando evidence indica modelo/versão", () => {
    const r = validateAiResolvedTechnicalProfile({
      fuelKind: "hibrido_combustao",
      timingSystem: "corrente",
      transmissionKind: "e_cvt",
      steeringKind: "eletrica",
      confidence: "medium",
      evidence: [
        "Toyota Corolla Hybrid usa transaxle e-CVT (Hybrid Synergy Drive)",
      ],
      warnings: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.transmissionKind).toBe("e_cvt");
    }
  });

  test("aceita string JSON válida", () => {
    const r = validateAiResolvedTechnicalProfile(JSON.stringify(i30Ok));
    expect(r.ok).toBe(true);
  });

  test("rejeita timingSystem desconhecido", () => {
    const r = validateAiResolvedTechnicalProfile({
      ...i30Ok,
      timingSystem: "desconhecido",
    });
    expect(r.ok).toBe(false);
  });

  test("rejeita transmissionKind desconhecido", () => {
    const r = validateAiResolvedTechnicalProfile({
      ...i30Ok,
      transmissionKind: "desconhecido",
    });
    expect(r.ok).toBe(false);
  });

  test("rejeita steeringKind desconhecida", () => {
    const r = validateAiResolvedTechnicalProfile({
      ...i30Ok,
      steeringKind: "desconhecida",
    });
    expect(r.ok).toBe(false);
  });

  test("rejeita confidence high", () => {
    const r = validateAiResolvedTechnicalProfile({
      ...i30Ok,
      confidence: "high",
    });
    expect(r.ok).toBe(false);
  });

  test("rejeita confidence ausente", () => {
    const raw = { ...i30Ok } as Record<string, unknown>;
    delete raw.confidence;
    const r = validateAiResolvedTechnicalProfile(raw);
    expect(r.ok).toBe(false);
  });

  test("rejeita valores fora do enum", () => {
    const r = validateAiResolvedTechnicalProfile({
      ...i30Ok,
      fuelKind: "hidrogenio",
    });
    expect(r.ok).toBe(false);
  });

  test("rejeita JSON inválido", () => {
    const r = validateAiResolvedTechnicalProfile("not-a-json {");
    expect(r.ok).toBe(false);
  });

  test("rejeita markdown wrapper", () => {
    const wrapped =
      "```json\n" + JSON.stringify(i30Ok) + "\n```";
    const r = validateAiResolvedTechnicalProfile(wrapped);
    expect(r.ok).toBe(false);
  });

  test("rejeita combustão com nao_aplicavel", () => {
    const r = validateAiResolvedTechnicalProfile({
      ...i30Ok,
      timingSystem: "nao_aplicavel",
    });
    expect(r.ok).toBe(false);
  });

  test("rejeita elétrico puro com correia_dentada", () => {
    const r = validateAiResolvedTechnicalProfile({
      fuelKind: "eletrico_puro",
      timingSystem: "correia_dentada",
      transmissionKind: "caixa_reducao",
      steeringKind: "eletrica",
      confidence: "medium",
      evidence: ["ok"],
      warnings: [],
    });
    expect(r.ok).toBe(false);
  });

  test("rejeita elétrico puro com corrente", () => {
    const r = validateAiResolvedTechnicalProfile({
      fuelKind: "eletrico_puro",
      timingSystem: "corrente",
      transmissionKind: "caixa_reducao",
      steeringKind: "eletrica",
      confidence: "medium",
      evidence: ["ok"],
      warnings: [],
    });
    expect(r.ok).toBe(false);
  });

  test("rejeita combustão com transmissionKind caixa_reducao", () => {
    const r = validateAiResolvedTechnicalProfile({
      ...i30Ok,
      transmissionKind: "caixa_reducao",
    });
    expect(r.ok).toBe(false);
  });

  test("rejeita medium sem evidence", () => {
    const r = validateAiResolvedTechnicalProfile({
      ...i30Ok,
      evidence: [],
    });
    expect(r.ok).toBe(false);
  });
});
