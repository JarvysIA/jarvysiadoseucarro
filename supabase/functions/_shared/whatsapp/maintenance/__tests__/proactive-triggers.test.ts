import { describe, expect, test } from "bun:test";
import {
  evaluateProactiveTriggers,
  triggersDueNow,
  type ProactiveTriggerDecision,
} from "../proactive-triggers.ts";
import type { ExistingMilestoneNotice } from "../milestone-notice-decision.ts";

const NOW = new Date("2026-08-07T12:00:00.000Z");
const VEHICLE_ID = "veh-1";

describe("evaluateProactiveTriggers", () => {
  test("km dentro da janela, existingMilestoneNotice null → 1 decisão, milestone_notice, shouldTrigger true, reason first_notice", () => {
    const decisions = evaluateProactiveTriggers({
      vehicleId: VEHICLE_ID,
      km: 60000,
      now: NOW,
      existingMilestoneNotice: null,
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.kind).toBe("milestone_notice");
    expect(decisions[0]?.shouldTrigger).toBe(true);
    expect(decisions[0]?.milestone).toBe(60000);
    expect(decisions[0]?.reason).toBe("first_notice");
  });

  test("km fora da janela → shouldTrigger false, reason outside_window", () => {
    const decisions = evaluateProactiveTriggers({
      vehicleId: VEHICLE_ID,
      km: 57000,
      now: NOW,
      existingMilestoneNotice: null,
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.shouldTrigger).toBe(false);
    expect(decisions[0]?.reason).toBe("outside_window");
  });

  test("existingMilestoneNotice status dismissed → shouldTrigger false, reason dismissed", () => {
    const existingMilestoneNotice: ExistingMilestoneNotice = {
      milestoneKm: 60000,
      status: "dismissed",
      notifiedAt: null,
      snoozedUntil: null,
      dismissedAt: NOW.toISOString(),
    };
    const decisions = evaluateProactiveTriggers({
      vehicleId: VEHICLE_ID,
      km: 60000,
      now: NOW,
      existingMilestoneNotice,
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.shouldTrigger).toBe(false);
    expect(decisions[0]?.reason).toBe("dismissed");
  });
});

describe("triggersDueNow", () => {
  test("array com 2 decisões (uma true, outra false) → retorna só a que é true", () => {
    const decisions: ProactiveTriggerDecision[] = [
      { kind: "milestone_notice", shouldTrigger: true, milestone: 60000, reason: "first_notice" },
      {
        kind: "milestone_notice",
        shouldTrigger: false,
        milestone: 70000,
        reason: "outside_window",
      },
    ];
    const due = triggersDueNow(decisions);
    expect(due).toHaveLength(1);
    expect(due[0]?.milestone).toBe(60000);
  });

  test("array vazio → retorna array vazio", () => {
    const due = triggersDueNow([]);
    expect(due).toHaveLength(0);
  });

  test("nenhuma decisão shouldTrigger true → retorna array vazio", () => {
    const decisions: ProactiveTriggerDecision[] = [
      {
        kind: "milestone_notice",
        shouldTrigger: false,
        milestone: 60000,
        reason: "dismissed",
      },
      {
        kind: "milestone_notice",
        shouldTrigger: false,
        milestone: 70000,
        reason: "still_snoozed",
      },
    ];
    const due = triggersDueNow(decisions);
    expect(due).toHaveLength(0);
  });
});
