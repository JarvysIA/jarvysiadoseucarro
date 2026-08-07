import { describe, expect, spyOn, test } from "bun:test";
import { renderRevisionMilestoneMessage } from "../milestone-render.ts";
import type { MilestoneRenderVehicleProfile } from "../milestone-render.ts";
import * as scheduleRules from "../schedule-rules.ts";

const COMBUSTION_MANUAL_PROFILE: MilestoneRenderVehicleProfile = {
  fuelKind: "combustao",
  timingSystem: "correia_dentada",
  transmissionKind: "manual",
  steeringKind: "hidraulica",
};

const ELECTRIC_PROFILE: MilestoneRenderVehicleProfile = {
  fuelKind: "eletrico_puro",
  timingSystem: "nao_aplicavel",
  transmissionKind: "caixa_reducao",
  steeringKind: "eletrica",
};

describe("renderRevisionMilestoneMessage — marco normal (60.000 km)", () => {
  const message = renderRevisionMilestoneMessage({
    vehicleLabel: "Fiat Argo 2022",
    milestoneKm: 60000,
    jarvysProfile: COMBUSTION_MANUAL_PROFILE,
    shoppingVehicle: { brand: "Fiat", model: "Argo", year: 2022 },
  });

  test("contém o km formatado com separador de milhar pt-BR", () => {
    expect(message).toContain("60.000 km");
  });

  test("contém o nome do veículo", () => {
    expect(message).toContain("Fiat Argo 2022");
  });

  test("contém ao menos um link do Mercado Livre com parâmetros de afiliado", () => {
    expect(message).toContain("mercadolivre.com.br");
    expect(message).toContain("matt_word=jarvys_ia");
  });
});

describe("renderRevisionMilestoneMessage — alta quilometragem (220.000 km)", () => {
  test("inclui a nota de alta quilometragem", () => {
    const message = renderRevisionMilestoneMessage({
      vehicleLabel: "Fiat Argo 2022",
      milestoneKm: 220000,
      jarvysProfile: COMBUSTION_MANUAL_PROFILE,
      shoppingVehicle: { brand: "Fiat", model: "Argo", year: 2022 },
    });
    expect(message).toContain(scheduleRules.HIGH_MILEAGE_NOTE);
  });

  test("não isHighMileage para km dentro do ciclo-base (60.000 km)", () => {
    const message = renderRevisionMilestoneMessage({
      vehicleLabel: "Fiat Argo 2022",
      milestoneKm: 60000,
      jarvysProfile: COMBUSTION_MANUAL_PROFILE,
      shoppingVehicle: {},
    });
    expect(message).not.toContain(scheduleRules.HIGH_MILEAGE_NOTE);
  });
});

describe("renderRevisionMilestoneMessage — perfil elétrico puro (20.000 km)", () => {
  const message = renderRevisionMilestoneMessage({
    vehicleLabel: "BYD Dolphin",
    milestoneKm: 20000,
    jarvysProfile: ELECTRIC_PROFILE,
    shoppingVehicle: { brand: "BYD", model: "Dolphin", year: 2024 },
  });

  test("usa a matriz EV (itens exclusivos de veículo elétrico)", () => {
    expect(message).toContain("veículo elétrico");
  });

  test("não usa itens exclusivos da matriz de combustão (ex.: óleo do motor)", () => {
    expect(message).not.toContain("Óleo do motor");
  });
});

describe("renderRevisionMilestoneMessage — item service_only sem link de compra", () => {
  test("'Sangria do sistema de freio (serviço)' aparece na lista, mas sem link ao lado", () => {
    const message = renderRevisionMilestoneMessage({
      vehicleLabel: "Fiat Argo 2022",
      milestoneKm: 60000,
      jarvysProfile: COMBUSTION_MANUAL_PROFILE,
      shoppingVehicle: {},
    });
    const lines = message.split("\n");
    expect(lines).toContain("Sangria do sistema de freio (serviço)");
    const sangriaLineWithLink = lines.find(
      (line) => line.startsWith("Sangria do sistema de freio") && line.includes("http"),
    );
    expect(sangriaLineWithLink).toBeUndefined();
  });
});

describe("renderRevisionMilestoneMessage — caso defensivo: milestone.items vazio", () => {
  // Nenhum par (km, perfil) real produz milestone.items vazio hoje — o
  // switch de baseFactoriesForKm sempre inclui ao menos óleo+filtro (mesmo
  // no branch default), e a matriz EV sempre inclui ao menos
  // alinhamento_balanceamento. O fallback ainda assim precisa existir
  // (defensivo, contra mudança futura em schedule-rules.ts), então este
  // teste mocka buildJarvysMilestone para simular esse caso isoladamente.
  test("retorna mensagem de fallback, não lança exceção", () => {
    const spy = spyOn(scheduleRules, "buildJarvysMilestone").mockReturnValue({
      revisionKmReal: 15000,
      revisionKmBase: 15000,
      revisionNumber: 1.5,
      cycleIndex: 0,
      isHighMileage: false,
      label: "Revisão de 15.000 km",
      items: [],
      notes: [],
    });
    try {
      expect(() =>
        renderRevisionMilestoneMessage({
          vehicleLabel: "Fiat Argo 2022",
          milestoneKm: 15000,
          jarvysProfile: COMBUSTION_MANUAL_PROFILE,
          shoppingVehicle: {},
        }),
      ).not.toThrow();

      const message = renderRevisionMilestoneMessage({
        vehicleLabel: "Fiat Argo 2022",
        milestoneKm: 15000,
        jarvysProfile: COMBUSTION_MANUAL_PROFILE,
        shoppingVehicle: {},
      });
      expect(message.length).toBeGreaterThan(0);
      expect(message).toContain("15.000 km");
      expect(message).toContain("Confira com seu mecânico de confiança");
    } finally {
      spy.mockRestore();
    }
  });
});
