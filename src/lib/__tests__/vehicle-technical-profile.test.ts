// Build 6.50D — Testes do helper puro de perfil técnico Jarvys.
// Usa apenas matchers toBe/toContain expostos pelo shim bun-test.d.ts.

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
    expect(normalizeFuelKind("")).toBe(null);
    expect(normalizeFuelKind(null)).toBe(null);
    expect(normalizeFuelKind(undefined)).toBe(null);
    expect(normalizeFuelKind("xyz zzz")).toBe(null);
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

  test("caixa de redução → caixa_reducao", () => {
    expect(normalizeTransmissionKind("caixa de redução")).toBe("caixa_reducao");
    expect(normalizeTransmissionKind("reduction gear")).toBe("caixa_reducao");
  });

  test("vazio → null", () => {
    expect(normalizeTransmissionKind("")).toBe(null);
    expect(normalizeTransmissionKind(null)).toBe(null);
    expect(normalizeTransmissionKind(undefined)).toBe(null);
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
  test("não aplicável", () => {
    expect(normalizeTimingSystem("não aplicável")).toBe("nao_aplicavel");
    expect(normalizeTimingSystem("N/A")).toBe("nao_aplicavel");
  });
  test("vazio → null", () => {
    expect(normalizeTimingSystem("")).toBe(null);
    expect(normalizeTimingSystem(null)).toBe(null);
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
  test("vazio → null", () => {
    expect(normalizeSteeringKind("")).toBe(null);
    expect(normalizeSteeringKind(null)).toBe(null);
  });
});

describe("resolveVehicleTechnicalProfile", () => {
  test("LOW — corpus curado sem steering conhecido → profile null", () => {
    // Corpus atual não expõe steeringKind → resolver puro sempre incompleto.
    const corpus: VehicleMaintenanceCorpusProfile = {
      combustivel: "flex",
      sistema_distribuicao: "correia dentada",
      transmissao: "manual",
      reviewed_by_admin: true,
    };
    const r = resolveVehicleTechnicalProfile({ corpusProfile: corpus });
    expect(r.profile).toBe(null);
    expect(r.confidence).toBe("low");
    expect(r.canUseFullSchedule).toBe(false);
    expect(r.missingFields).toContain("steeringKind");
  });

  test("LOW — corpus sem review e sem transmissão → profile null", () => {
    const corpus: VehicleMaintenanceCorpusProfile = {
      combustivel: "flex",
      sistema_distribuicao: "corrente",
      transmissao: null,
      reviewed_by_admin: false,
    };
    const r = resolveVehicleTechnicalProfile({ corpusProfile: corpus });
    expect(r.profile).toBe(null);
    expect(r.confidence).toBe("low");
    expect(r.source).toBe("corpus_ia");
    expect(r.canUseFullSchedule).toBe(false);
    expect(r.missingFields).toContain("transmissionKind");
    expect(r.missingFields).toContain("steeringKind");
  });

  test("LOW — só combustivelFipe flex → profile null, derivado_fipe", () => {
    const r = resolveVehicleTechnicalProfile({ combustivelFipe: "flex" });
    expect(r.profile).toBe(null);
    expect(r.confidence).toBe("low");
    expect(r.source).toBe("derivado_fipe");
    expect(r.canUseFullSchedule).toBe(false);
    expect(r.shouldBlockSensitiveShoppingLinks).toBe(true);
    expect(r.missingFields).toContain("timingSystem");
    expect(r.missingFields).toContain("transmissionKind");
    expect(r.missingFields).toContain("steeringKind");
  });

  test("SEM DADOS — profile null, source desconhecido", () => {
    const r = resolveVehicleTechnicalProfile({});
    expect(r.profile).toBe(null);
    expect(r.source).toBe("desconhecido");
    expect(r.confidence).toBe("low");
    expect(r.canUseFullSchedule).toBe(false);
    expect(r.shouldBlockSensitiveShoppingLinks).toBe(true);
    expect(r.missingFields).toContain("fuelKind");
  });

  test("EV puro só FIPE — ainda cai em low (falta steering)", () => {
    const r = resolveVehicleTechnicalProfile({ combustivelFipe: "elétrico" });
    // EV injeta timing=nao_aplicavel + transmission=caixa_reducao, mas
    // steeringKind não tem fonte → perfil incompleto.
    expect(r.profile).toBe(null);
    expect(r.confidence).toBe("low");
    expect(r.missingFields).toContain("steeringKind");
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
    // fuel priorizado, mas steering desconhecido → low.
    expect(r.confidence).toBe("low");
    expect(r.profile).toBe(null);
    expect(r.missingFields).toContain("steeringKind");
  });
});

describe("JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE", () => {
  test("é string não vazia e contém frase-chave", () => {
    expect(typeof JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE).toBe("string");
    expect(JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE.length > 0).toBe(true);
    expect(
      JARVYS_TECHNICAL_PROFILE_FALLBACK_MESSAGE.toLowerCase(),
    ).toContain("não conseguimos confirmar");
  });
});
