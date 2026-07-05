// Build 6.50A — Testes do helper puro de perfil técnico Jarvys.

import { describe, expect, test } from "bun:test";

import {
  JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE,
  normalizeFuelKind,
  normalizeSteeringKind,
  normalizeTimingSystem,
  normalizeTransmissionKind,
  resolveVehicleTechnicalProfile,
  type VehicleMaintenanceCorpusProfile,
} from "@/lib/vehicle-technical-profile";

describe("normalizeFuelKind", () => {
  test("flex/gasolina/diesel → combustao", () => {
    expect(normalizeFuelKind("flex")).toBe("combustao");
    expect(normalizeFuelKind("Gasolina")).toBe("combustao");
    expect(normalizeFuelKind("Diesel")).toBe("combustao");
    expect(normalizeFuelKind("etanol")).toBe("combustao");
    expect(normalizeFuelKind("álcool")).toBe("combustao");
    expect(normalizeFuelKind("GNV")).toBe("combustao");
  });

  test("híbridos → hibrido_combustao", () => {
    expect(normalizeFuelKind("híbrido flex")).toBe("hibrido_combustao");
    expect(normalizeFuelKind("hybrid")).toBe("hibrido_combustao");
    expect(normalizeFuelKind("HEV")).toBe("hibrido_combustao");
    expect(normalizeFuelKind("PHEV")).toBe("hibrido_combustao");
    expect(normalizeFuelKind("Plug-in Hybrid")).toBe("hibrido_combustao");
  });

  test("elétricos puros → eletrico_puro", () => {
    expect(normalizeFuelKind("elétrico")).toBe("eletrico_puro");
    expect(normalizeFuelKind("EV")).toBe("eletrico_puro");
    expect(normalizeFuelKind("BEV")).toBe("eletrico_puro");
    expect(normalizeFuelKind("Electric")).toBe("eletrico_puro");
  });

  test("vazio/lixo → null", () => {
    expect(normalizeFuelKind("")).toBeNull();
    expect(normalizeFuelKind(null)).toBeNull();
    expect(normalizeFuelKind(undefined)).toBeNull();
    expect(normalizeFuelKind("xyz zzz")).toBeNull();
  });
});

describe("normalizeTransmissionKind", () => {
  test("manual/mecânico → manual", () => {
    expect(normalizeTransmissionKind("Manual")).toBe("manual");
    expect(normalizeTransmissionKind("mecânico")).toBe("manual");
  });

  test("automático/AT/tiptronic → automatico", () => {
    expect(normalizeTransmissionKind("automático")).toBe("automatico");
    expect(normalizeTransmissionKind("AT")).toBe("automatico");
    expect(normalizeTransmissionKind("Tiptronic")).toBe("automatico");
  });

  test("CVT / e-CVT", () => {
    expect(normalizeTransmissionKind("CVT")).toBe("cvt");
    expect(normalizeTransmissionKind("e-CVT")).toBe("e_cvt");
    expect(normalizeTransmissionKind("ecvt")).toBe("e_cvt");
  });

  test("automatizado", () => {
    expect(normalizeTransmissionKind("Dualogic")).toBe("automatizado");
    expect(normalizeTransmissionKind("iMotion")).toBe("automatizado");
    expect(normalizeTransmissionKind("Easytronic")).toBe("automatizado");
  });

  test("dupla embreagem", () => {
    expect(normalizeTransmissionKind("DSG")).toBe("dupla_embreagem");
    expect(normalizeTransmissionKind("Powershift")).toBe("dupla_embreagem");
    expect(normalizeTransmissionKind("DCT")).toBe("dupla_embreagem");
  });

  test("vazio → desconhecido", () => {
    expect(normalizeTransmissionKind("")).toBe("desconhecido");
    expect(normalizeTransmissionKind(null)).toBe("desconhecido");
    expect(normalizeTransmissionKind(undefined)).toBe("desconhecido");
  });
});

describe("normalizeTimingSystem", () => {
  test("correia dentada", () => {
    expect(normalizeTimingSystem("correia dentada")).toBe("correia_dentada");
  });
  test("corrente", () => {
    expect(normalizeTimingSystem("corrente de comando")).toBe("corrente");
  });
  test("correia banhada", () => {
    expect(normalizeTimingSystem("correia banhada a óleo")).toBe(
      "correia_banhada",
    );
    expect(normalizeTimingSystem("wet belt")).toBe("correia_banhada");
  });
  test("vazio → desconhecido", () => {
    expect(normalizeTimingSystem("")).toBe("desconhecido");
    expect(normalizeTimingSystem(null)).toBe("desconhecido");
  });
});

describe("normalizeSteeringKind", () => {
  test("hidráulica", () => {
    expect(normalizeSteeringKind("hidráulica")).toBe("hidraulica");
  });
  test("elétrica / eletroassistida", () => {
    expect(normalizeSteeringKind("elétrica")).toBe("eletrica");
    expect(normalizeSteeringKind("eletroassistida")).toBe("eletrica");
  });
  test("vazio → desconhecida", () => {
    expect(normalizeSteeringKind("")).toBe("desconhecida");
    expect(normalizeSteeringKind(null)).toBe("desconhecida");
  });
});

describe("resolveVehicleTechnicalProfile", () => {
  test("HIGH — corpus curado por admin com timing + transmission", () => {
    const corpus: VehicleMaintenanceCorpusProfile = {
      combustivel: "flex",
      sistema_distribuicao: "correia dentada",
      transmissao: "manual",
      reviewed_by_admin: true,
    };
    const r = resolveVehicleTechnicalProfile({ corpusProfile: corpus });
    expect(r.confidence).toBe("high");
    expect(r.source).toBe("corpus_curado");
    expect(r.canUseFullSchedule).toBe(true);
    expect(r.shouldBlockSensitiveShoppingLinks).toBe(false);
    expect(r.profile).toEqual({
      fuelKind: "combustao",
      timingSystem: "correia_dentada",
      transmissionKind: "manual",
      steeringKind: "desconhecida",
    });
  });

  test("MEDIUM — corpus sem review, fuel + (timing OU transmission)", () => {
    const corpus: VehicleMaintenanceCorpusProfile = {
      combustivel: "flex",
      sistema_distribuicao: "corrente",
      transmissao: null,
      reviewed_by_admin: false,
    };
    const r = resolveVehicleTechnicalProfile({ corpusProfile: corpus });
    expect(r.confidence).toBe("medium");
    expect(r.source).toBe("corpus_ia");
    expect(r.canUseFullSchedule).toBe(true);
    expect(r.shouldBlockSensitiveShoppingLinks).toBe(true);
    expect(r.profile?.timingSystem).toBe("corrente");
    expect(r.profile?.transmissionKind).toBe("desconhecido");
    expect(r.missingFields).toContain("transmissionKind");
  });

  test("LOW — só combustivelFipe flex", () => {
    const r = resolveVehicleTechnicalProfile({ combustivelFipe: "flex" });
    expect(r.confidence).toBe("low");
    expect(r.source).toBe("derivado_fipe");
    expect(r.canUseFullSchedule).toBe(false);
    expect(r.shouldBlockSensitiveShoppingLinks).toBe(true);
    expect(r.profile?.fuelKind).toBe("combustao");
    expect(r.missingFields).toEqual(
      expect.arrayContaining([
        "timingSystem",
        "transmissionKind",
        "steeringKind",
      ]),
    );
  });

  test("SEM DADOS — profile null, source desconhecido", () => {
    const r = resolveVehicleTechnicalProfile({});
    expect(r.profile).toBeNull();
    expect(r.source).toBe("desconhecido");
    expect(r.confidence).toBe("low");
    expect(r.canUseFullSchedule).toBe(false);
    expect(r.shouldBlockSensitiveShoppingLinks).toBe(true);
    expect(r.missingFields).toEqual([
      "fuelKind",
      "timingSystem",
      "transmissionKind",
      "steeringKind",
    ]);
  });

  test("corpus.combustivel tem prioridade sobre combustivelFipe", () => {
    const r = resolveVehicleTechnicalProfile({
      combustivelFipe: "diesel",
      corpusProfile: {
        combustivel: "híbrido flex",
        sistema_distribuicao: "corrente",
        transmissao: "CVT",
        reviewed_by_admin: true,
      },
    });
    expect(r.profile?.fuelKind).toBe("hibrido_combustao");
    expect(r.confidence).toBe("high");
  });
});

describe("JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE", () => {
  test("é string não vazia e contém frase-chave", () => {
    expect(typeof JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE).toBe("string");
    expect(JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE.length).toBeGreaterThan(0);
    expect(
      JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE.toLowerCase(),
    ).toContain("não conseguimos confirmar");
  });
});
