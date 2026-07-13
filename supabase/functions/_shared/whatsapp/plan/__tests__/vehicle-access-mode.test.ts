// Testes puros do classificador WhatsappVehicleAccessMode.
// Runner: bun test. Sem Supabase, sem Deno, sem fetch.

import { describe, expect, test } from "bun:test";
import {
  computeWhatsappVehicleAccessMode,
  WHATSAPP_VEHICLE_ACCESS_MODES,
  type WhatsappVehicleAccessMode,
  type WhatsappVehicleAccessProfileInput,
  type WhatsappVehicleAccessVehicleInput,
} from "../vehicle-access-mode.ts";

const NOW = new Date("2026-07-13T12:00:00Z");

function p(
  overrides: Partial<WhatsappVehicleAccessProfileInput> = {},
): WhatsappVehicleAccessProfileInput {
  return { statusUsuario: "vip", trialInicio: null, ...overrides };
}

function v(
  overrides: Partial<WhatsappVehicleAccessVehicleInput> = {},
): WhatsappVehicleAccessVehicleInput {
  return {
    id: "veh-1",
    userId: "user-1",
    status: "vip",
    hasPaidActivation: false,
    ...overrides,
  };
}

describe("computeWhatsappVehicleAccessMode — contrato", () => {
  test("modos permitidos são fixos", () => {
    expect(WHATSAPP_VEHICLE_ACCESS_MODES).toEqual([
      "full",
      "passive_with_km",
      "denied",
    ]);
  });

  test("profile null → denied", () => {
    expect(computeWhatsappVehicleAccessMode(null, v(), "user-1", NOW)).toBe(
      "denied",
    );
  });

  test("vehicle null → denied", () => {
    expect(computeWhatsappVehicleAccessMode(p(), null, "user-1", NOW)).toBe(
      "denied",
    );
  });
});

describe("computeWhatsappVehicleAccessMode — IDs e ownership", () => {
  test("expectedUserId vazio → denied", () => {
    expect(computeWhatsappVehicleAccessMode(p(), v(), "", NOW)).toBe("denied");
  });

  test("vehicle.id vazio → denied", () => {
    expect(
      computeWhatsappVehicleAccessMode(p(), v({ id: "" }), "user-1", NOW),
    ).toBe("denied");
  });

  test("vehicle.userId vazio → denied", () => {
    expect(
      computeWhatsappVehicleAccessMode(p(), v({ userId: "" }), "user-1", NOW),
    ).toBe("denied");
  });

  test("ownership divergente → denied", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p(),
        v({ userId: "outro" }),
        "user-1",
        NOW,
      ),
    ).toBe("denied");
  });
});

describe("computeWhatsappVehicleAccessMode — status do veículo", () => {
  test("status null → denied", () => {
    expect(
      computeWhatsappVehicleAccessMode(p(), v({ status: null }), "user-1", NOW),
    ).toBe("denied");
  });

  test("status desconhecido → denied", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p(),
        v({ status: "active" }),
        "user-1",
        NOW,
      ),
    ).toBe("denied");
  });

  test("archived → denied mesmo com plano VIP", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p({ statusUsuario: "vip" }),
        v({ status: "archived" }),
        "user-1",
        NOW,
      ),
    ).toBe("denied");
  });

  test.each(["free", "trial", "ativo", "vip", "enterprise"] as const)(
    "status reconhecido '%s' é aceito (não vira denied por status)",
    (status) => {
      const r = computeWhatsappVehicleAccessMode(
        p({ statusUsuario: "vip" }),
        v({ status }),
        "user-1",
        NOW,
      );
      expect(r === "full" || r === "passive_with_km").toBe(true);
    },
  );
});

describe("computeWhatsappVehicleAccessMode — status do perfil", () => {
  test("statusUsuario null → denied", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p({ statusUsuario: null }),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("denied");
  });

  test("statusUsuario desconhecido → denied", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p({ statusUsuario: "free" }),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("denied");
  });

  test("vip → full", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p({ statusUsuario: "vip" }),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("full");
  });

  test("enterprise → full", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p({ statusUsuario: "enterprise" }),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("full");
  });
});

describe("computeWhatsappVehicleAccessMode — trial", () => {
  const trialProfile = (trialInicio: string | null) =>
    p({ statusUsuario: "trial", trialInicio });

  test("trial sem data (null) → full", () => {
    expect(
      computeWhatsappVehicleAccessMode(trialProfile(null), v(), "user-1", NOW),
    ).toBe("full");
  });

  test("trial com string vazia → denied", () => {
    expect(
      computeWhatsappVehicleAccessMode(trialProfile(""), v(), "user-1", NOW),
    ).toBe("denied");
  });

  test("trial com data inválida → denied", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        trialProfile("not-a-date"),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("denied");
  });

  test("trial no primeiro dia (elapsed 0) → full", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        trialProfile("2026-07-13T00:00:00Z"),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("full");
  });

  test("trial no dia 29 → full", () => {
    const start = new Date(NOW.getTime() - 29 * 86_400_000).toISOString();
    expect(
      computeWhatsappVehicleAccessMode(
        trialProfile(start),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("full");
  });

  test("trial no dia 30 exato → passive_with_km", () => {
    const start = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
    expect(
      computeWhatsappVehicleAccessMode(
        trialProfile(start),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("passive_with_km");
  });

  test("trial no dia 45 → passive_with_km", () => {
    const start = new Date(NOW.getTime() - 45 * 86_400_000).toISOString();
    expect(
      computeWhatsappVehicleAccessMode(
        trialProfile(start),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("passive_with_km");
  });

  test("trial com data futura → denied", () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    expect(
      computeWhatsappVehicleAccessMode(
        trialProfile(future),
        v(),
        "user-1",
        NOW,
      ),
    ).toBe("denied");
  });
});

describe("computeWhatsappVehicleAccessMode — ativo por veículo", () => {
  test("ativo + hasPaidActivation=true → full", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p({ statusUsuario: "ativo" }),
        v({ hasPaidActivation: true }),
        "user-1",
        NOW,
      ),
    ).toBe("full");
  });

  test("ativo + hasPaidActivation=false → passive_with_km", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p({ statusUsuario: "ativo" }),
        v({ hasPaidActivation: false }),
        "user-1",
        NOW,
      ),
    ).toBe("passive_with_km");
  });

  test("ativo + archived → denied (archived precede plano)", () => {
    expect(
      computeWhatsappVehicleAccessMode(
        p({ statusUsuario: "ativo" }),
        v({ status: "archived", hasPaidActivation: true }),
        "user-1",
        NOW,
      ),
    ).toBe("denied");
  });
});

describe("computeWhatsappVehicleAccessMode — retorno é sempre WhatsappVehicleAccessMode", () => {
  test("todo retorno pertence à união fechada", () => {
    const inputs: Array<
      [WhatsappVehicleAccessProfileInput | null, WhatsappVehicleAccessVehicleInput | null]
    > = [
      [null, v()],
      [p(), null],
      [p({ statusUsuario: "vip" }), v({ status: "vip" })],
      [p({ statusUsuario: "ativo" }), v({ hasPaidActivation: true })],
      [p({ statusUsuario: "trial", trialInicio: null }), v()],
    ];
    for (const [prof, veh] of inputs) {
      const r = computeWhatsappVehicleAccessMode(prof, veh, "user-1", NOW);
      const allowed: WhatsappVehicleAccessMode[] = [
        "full",
        "passive_with_km",
        "denied",
      ];
      expect(allowed).toContain(r);
    }
  });
});
