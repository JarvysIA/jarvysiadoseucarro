import { describe, expect, test } from "bun:test";
import {
  getMilestoneWindowStatus,
  kmUntilMilestone,
  nearestMilestone,
  nextMilestone,
} from "./predictive-maintenance";

describe("nearestMilestone", () => {
  test("km abaixo do primeiro marco (500) → retorna 10000, nunca 0", () => {
    expect(nearestMilestone(500)).toBe(10000);
  });

  test("km exatamente em um marco (60000) → retorna o próprio 60000", () => {
    expect(nearestMilestone(60000)).toBe(60000);
  });

  test("km mais perto do marco anterior (61000) → retorna 60000", () => {
    expect(nearestMilestone(61000)).toBe(60000);
  });

  test("km mais perto do próximo marco (69000) → retorna 70000", () => {
    expect(nearestMilestone(69000)).toBe(70000);
  });
});

describe("getMilestoneWindowStatus", () => {
  test("1.500km ANTES de um marco (58500) → withinWindow true, isPast false, distanceKm 1500", () => {
    const status = getMilestoneWindowStatus(58500);
    expect(status.milestone).toBe(60000);
    expect(status.distanceKm).toBe(1500);
    expect(status.isPast).toBe(false);
    expect(status.withinWindow).toBe(true);
  });

  test("1.500km DEPOIS de um marco (61500) → withinWindow true, isPast true, distanceKm 1500", () => {
    const status = getMilestoneWindowStatus(61500);
    expect(status.milestone).toBe(60000);
    expect(status.distanceKm).toBe(1500);
    expect(status.isPast).toBe(true);
    expect(status.withinWindow).toBe(true);
  });

  test("3.000km ANTES (57000, fora da nova janela de 2.000) → withinWindow false", () => {
    const status = getMilestoneWindowStatus(57000);
    expect(status.withinWindow).toBe(false);
  });

  test("3.000km DEPOIS (63000) → withinWindow false", () => {
    const status = getMilestoneWindowStatus(63000);
    expect(status.withinWindow).toBe(false);
  });

  test("exatamente em cima do marco (60000) → isPast true, distanceKm 0, withinWindow true", () => {
    const status = getMilestoneWindowStatus(60000);
    expect(status.milestone).toBe(60000);
    expect(status.isPast).toBe(true);
    expect(status.distanceKm).toBe(0);
    expect(status.withinWindow).toBe(true);
  });
});

describe("regressão: nextMilestone e kmUntilMilestone continuam com o mesmo comportamento", () => {
  test("nextMilestone(500) → 10000", () => {
    expect(nextMilestone(500)).toBe(10000);
  });

  test("nextMilestone(60000) → 70000 (em cima do marco mira o seguinte)", () => {
    expect(nextMilestone(60000)).toBe(70000);
  });

  test("kmUntilMilestone(58500) → 1500", () => {
    expect(kmUntilMilestone(58500)).toBe(1500);
  });

  test("kmUntilMilestone(61500) → 8500 (mira o marco de 70000, não 60000)", () => {
    expect(kmUntilMilestone(61500)).toBe(8500);
  });
});
