import { describe, expect, test } from "bun:test";
import { normalizePlate, resolveVehicle } from "../vehicles.ts";
import type { ConversationVehicle } from "../types.ts";

function v(partial: Partial<ConversationVehicle> & { id: string }): ConversationVehicle {
  return {
    id: partial.id,
    brand: partial.brand ?? null,
    model: partial.model ?? null,
    plate: partial.plate ?? null,
    isArchived: partial.isArchived ?? false,
    isEligible: partial.isEligible ?? true,
    kmAtual: partial.kmAtual ?? null,
    whatsappAccessMode: partial.whatsappAccessMode ?? "full",
    optionalLabel: partial.optionalLabel ?? null,
  };
}

describe("normalizePlate", () => {
  test("strips separators and uppercases", () => {
    expect(normalizePlate("abc-1d23")).toBe("ABC1D23");
    expect(normalizePlate("ABC 1234")).toBe("ABC1234");
    expect(normalizePlate(null)).toBe("");
  });
});

describe("resolveVehicle", () => {
  const argo = v({ id: "1", brand: "Fiat", model: "Argo", plate: "ABC1D23" });
  const onix = v({ id: "2", brand: "Chevrolet", model: "Onix", plate: "XYZ4E56" });
  const argo2 = v({ id: "3", brand: "Fiat", model: "Argo", plate: "QWE1D23" });

  test("no eligible vehicles", () => {
    expect(resolveVehicle({ text: "argo", vehicles: [], activeVehicleId: null }).kind).toBe(
      "no_eligible_vehicle",
    );
    expect(
      resolveVehicle({
        text: "argo",
        vehicles: [v({ id: "x", isEligible: false })],
        activeVehicleId: null,
      }).kind,
    ).toBe("no_eligible_vehicle");
  });

  test("plate exact match", () => {
    const r = resolveVehicle({
      text: "abc1d23",
      vehicles: [argo, onix],
      activeVehicleId: null,
    });
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.vehicle.id).toBe("1");
  });

  test("plate suffix unique", () => {
    const r = resolveVehicle({
      text: "e56",
      vehicles: [argo, onix],
      activeVehicleId: null,
    });
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.vehicle.id).toBe("2");
  });

  test("model unique match", () => {
    const r = resolveVehicle({
      text: "onix",
      vehicles: [argo, onix],
      activeVehicleId: null,
    });
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.vehicle.id).toBe("2");
  });

  test("ambiguous by model", () => {
    const r = resolveVehicle({
      text: "argo",
      vehicles: [argo, argo2],
      activeVehicleId: null,
    });
    expect(r.kind).toBe("ambiguous");
  });

  test("brand + model exact", () => {
    const r = resolveVehicle({
      text: "chevrolet onix",
      vehicles: [argo, onix],
      activeVehicleId: null,
    });
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") expect(r.vehicle.id).toBe("2");
  });

  test("not found", () => {
    const r = resolveVehicle({
      text: "corolla",
      vehicles: [argo, onix],
      activeVehicleId: null,
    });
    expect(r.kind).toBe("not_found");
  });

  test("archived filtered out", () => {
    const r = resolveVehicle({
      text: "argo",
      vehicles: [{ ...argo, isArchived: true }],
      activeVehicleId: null,
    });
    expect(r.kind).toBe("no_eligible_vehicle");
  });

  test("single eligible falls back only when no text", () => {
    const r1 = resolveVehicle({
      text: "",
      vehicles: [argo],
      activeVehicleId: null,
    });
    expect(r1.kind).toBe("matched");
    const r2 = resolveVehicle({
      text: "corolla",
      vehicles: [argo],
      activeVehicleId: null,
    });
    expect(r2.kind).toBe("not_found");
  });
});
