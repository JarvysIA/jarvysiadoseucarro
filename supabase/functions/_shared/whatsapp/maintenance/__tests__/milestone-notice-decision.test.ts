import { describe, expect, test } from "bun:test";
import {
  decideMilestoneNotice,
  type ExistingMilestoneNotice,
} from "../milestone-notice-decision.ts";

const NOW = new Date("2026-08-07T12:00:00.000Z");

function isoOffset(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

describe("decideMilestoneNotice", () => {
  test("km fora da janela (57000, marco mais próximo 60000, distância 3000 > 2000) → shouldNotify false, reason outside_window", () => {
    const decision = decideMilestoneNotice({
      km: 57000,
      existingNotice: null,
      now: NOW,
    });
    expect(decision.shouldNotify).toBe(false);
    expect(decision.reason).toBe("outside_window");
    expect(decision.milestone).toBe(60000);
  });

  test("km dentro da janela, existingNotice null → shouldNotify true, reason first_notice", () => {
    const decision = decideMilestoneNotice({
      km: 60000,
      existingNotice: null,
      now: NOW,
    });
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe("first_notice");
    expect(decision.milestone).toBe(60000);
  });

  test("km dentro da janela, existingNotice status dismissed → shouldNotify false, reason dismissed", () => {
    const existingNotice: ExistingMilestoneNotice = {
      milestoneKm: 60000,
      status: "dismissed",
      notifiedAt: isoOffset(-ONE_HOUR_MS),
      snoozedUntil: null,
      dismissedAt: isoOffset(-ONE_HOUR_MS),
    };
    const decision = decideMilestoneNotice({
      km: 60000,
      existingNotice,
      now: NOW,
    });
    expect(decision.shouldNotify).toBe(false);
    expect(decision.reason).toBe("dismissed");
    expect(decision.milestone).toBe(60000);
  });

  test("km dentro da janela, status snoozed com snoozedUntil no FUTURO → shouldNotify false, reason still_snoozed", () => {
    const existingNotice: ExistingMilestoneNotice = {
      milestoneKm: 60000,
      status: "snoozed",
      notifiedAt: isoOffset(-ONE_HOUR_MS),
      snoozedUntil: isoOffset(FIVE_DAYS_MS),
      dismissedAt: null,
    };
    const decision = decideMilestoneNotice({
      km: 60000,
      existingNotice,
      now: NOW,
    });
    expect(decision.shouldNotify).toBe(false);
    expect(decision.reason).toBe("still_snoozed");
    expect(decision.milestone).toBe(60000);
  });

  test("km dentro da janela, status snoozed com snoozedUntil no PASSADO → shouldNotify true, reason re_notify_after_snooze", () => {
    const existingNotice: ExistingMilestoneNotice = {
      milestoneKm: 60000,
      status: "snoozed",
      notifiedAt: isoOffset(-FIVE_DAYS_MS),
      snoozedUntil: isoOffset(-ONE_HOUR_MS),
      dismissedAt: null,
    };
    const decision = decideMilestoneNotice({
      km: 60000,
      existingNotice,
      now: NOW,
    });
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe("re_notify_after_snooze");
    expect(decision.milestone).toBe(60000);
  });

  test("km dentro da janela, status notified → shouldNotify false, reason already_notified", () => {
    const existingNotice: ExistingMilestoneNotice = {
      milestoneKm: 60000,
      status: "notified",
      notifiedAt: isoOffset(-ONE_HOUR_MS),
      snoozedUntil: null,
      dismissedAt: null,
    };
    const decision = decideMilestoneNotice({
      km: 60000,
      existingNotice,
      now: NOW,
    });
    expect(decision.shouldNotify).toBe(false);
    expect(decision.reason).toBe("already_notified");
    expect(decision.milestone).toBe(60000);
  });

  test("km dentro da janela, existingNotice de OUTRO milestoneKm → tratado como inexistente, shouldNotify true, reason first_notice (não stale_notice_ignored)", () => {
    const existingNotice: ExistingMilestoneNotice = {
      milestoneKm: 60000,
      status: "notified",
      notifiedAt: isoOffset(-ONE_HOUR_MS),
      snoozedUntil: null,
      dismissedAt: null,
    };
    const decision = decideMilestoneNotice({
      km: 70000,
      existingNotice,
      now: NOW,
    });
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe("first_notice");
    expect(decision.milestone).toBe(70000);
  });

  test("km exatamente na borda da janela (distância == 2000, km=58000) → shouldNotify true", () => {
    const decision = decideMilestoneNotice({
      km: 58000,
      existingNotice: null,
      now: NOW,
    });
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe("first_notice");
    expect(decision.milestone).toBe(60000);
  });

  test("km exatamente 1 acima da borda (distância == 2001, km=57999) → shouldNotify false", () => {
    const decision = decideMilestoneNotice({
      km: 57999,
      existingNotice: null,
      now: NOW,
    });
    expect(decision.shouldNotify).toBe(false);
    expect(decision.reason).toBe("outside_window");
    expect(decision.milestone).toBe(60000);
  });
});
