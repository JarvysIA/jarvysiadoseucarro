import { describe, expect, test } from "bun:test";
import { decideInactivityReengagement } from "../inactivity-reengagement-decision.ts";

const NOW = new Date("2026-08-07T12:00:00.000Z");

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("decideInactivityReengagement", () => {
  test("lastInboundAt e lastOutboundAt ambos null → shouldTrigger false, daysSinceLastContact null, reason no_prior_contact", () => {
    const decision = decideInactivityReengagement({
      lastInboundAt: null,
      lastOutboundAt: null,
      now: NOW,
    });
    expect(decision.shouldTrigger).toBe(false);
    expect(decision.daysSinceLastContact).toBeNull();
    expect(decision.reason).toBe("no_prior_contact");
  });

  test("último contato há 5 dias → shouldTrigger false, reason still_within_threshold, daysSinceLastContact 5", () => {
    const decision = decideInactivityReengagement({
      lastInboundAt: isoDaysAgo(5),
      lastOutboundAt: null,
      now: NOW,
    });
    expect(decision.shouldTrigger).toBe(false);
    expect(decision.reason).toBe("still_within_threshold");
    expect(decision.daysSinceLastContact).toBe(5);
  });

  test("último contato há exatamente 8 dias → shouldTrigger true, reason inactive_threshold_reached, daysSinceLastContact 8", () => {
    const decision = decideInactivityReengagement({
      lastInboundAt: isoDaysAgo(8),
      lastOutboundAt: null,
      now: NOW,
    });
    expect(decision.shouldTrigger).toBe(true);
    expect(decision.reason).toBe("inactive_threshold_reached");
    expect(decision.daysSinceLastContact).toBe(8);
  });

  test("último contato há 10 dias → shouldTrigger true", () => {
    const decision = decideInactivityReengagement({
      lastInboundAt: null,
      lastOutboundAt: isoDaysAgo(10),
      now: NOW,
    });
    expect(decision.shouldTrigger).toBe(true);
    expect(decision.reason).toBe("inactive_threshold_reached");
    expect(decision.daysSinceLastContact).toBe(10);
  });

  test("lastInboundAt há 10 dias mas lastOutboundAt há 2 dias → usa o mais recente (outbound), shouldTrigger false", () => {
    const decision = decideInactivityReengagement({
      lastInboundAt: isoDaysAgo(10),
      lastOutboundAt: isoDaysAgo(2),
      now: NOW,
    });
    expect(decision.shouldTrigger).toBe(false);
    expect(decision.reason).toBe("still_within_threshold");
    expect(decision.daysSinceLastContact).toBe(2);
  });

  test("threshold customizado (inactivityThresholdDays: 15) → respeita o valor passado em vez do default de 8", () => {
    const decision = decideInactivityReengagement({
      lastInboundAt: isoDaysAgo(10),
      lastOutboundAt: null,
      now: NOW,
      inactivityThresholdDays: 15,
    });
    expect(decision.shouldTrigger).toBe(false);
    expect(decision.reason).toBe("still_within_threshold");
    expect(decision.daysSinceLastContact).toBe(10);
  });
});
