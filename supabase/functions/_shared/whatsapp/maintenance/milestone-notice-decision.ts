import { getMilestoneWindowStatus } from "./milestone-window.ts";

export type MilestoneNoticeStatus = "pending" | "notified" | "snoozed" | "dismissed";

export type ExistingMilestoneNotice = {
  milestoneKm: number;
  status: MilestoneNoticeStatus;
  notifiedAt: string | null;
  snoozedUntil: string | null;
  dismissedAt: string | null;
};

export type DecideMilestoneNoticeInput = {
  km: number;
  existingNotice: ExistingMilestoneNotice | null;
  now: Date;
};

export type MilestoneNoticeReason =
  | "outside_window"
  | "first_notice"
  | "dismissed"
  | "still_snoozed"
  | "re_notify_after_snooze"
  | "already_notified"
  | "stale_notice_ignored";

export type MilestoneNoticeDecision = {
  shouldNotify: boolean;
  milestone: number;
  reason: MilestoneNoticeReason;
};

export function decideMilestoneNotice(input: DecideMilestoneNoticeInput): MilestoneNoticeDecision {
  const windowStatus = getMilestoneWindowStatus(input.km);

  if (!windowStatus.withinWindow) {
    return { shouldNotify: false, milestone: windowStatus.milestone, reason: "outside_window" };
  }

  let notice = input.existingNotice;

  // Guarda defensiva: se a linha trazida pertence a outro marco (bug de
  // integração do chamador), trata como se não existisse.
  if (notice && notice.milestoneKm !== windowStatus.milestone) {
    notice = null;
  }

  if (!notice || notice.status === "pending") {
    return { shouldNotify: true, milestone: windowStatus.milestone, reason: "first_notice" };
  }

  if (notice.status === "dismissed") {
    return { shouldNotify: false, milestone: windowStatus.milestone, reason: "dismissed" };
  }

  if (notice.status === "snoozed") {
    const snoozedUntil = notice.snoozedUntil ? new Date(notice.snoozedUntil) : null;
    if (snoozedUntil && input.now.getTime() >= snoozedUntil.getTime()) {
      return {
        shouldNotify: true,
        milestone: windowStatus.milestone,
        reason: "re_notify_after_snooze",
      };
    }
    return { shouldNotify: false, milestone: windowStatus.milestone, reason: "still_snoozed" };
  }

  // status === "notified"
  return { shouldNotify: false, milestone: windowStatus.milestone, reason: "already_notified" };
}
