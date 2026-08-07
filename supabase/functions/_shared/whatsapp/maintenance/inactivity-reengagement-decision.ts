export type InactivityReengagementInput = {
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  now: Date;
  inactivityThresholdDays?: number;
};

export type InactivityReengagementReason =
  | "no_prior_contact"
  | "still_within_threshold"
  | "inactive_threshold_reached";

export type InactivityReengagementDecision = {
  shouldTrigger: boolean;
  daysSinceLastContact: number | null;
  reason: InactivityReengagementReason;
};

const DEFAULT_INACTIVITY_THRESHOLD_DAYS = 8;

function parseMs(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function decideInactivityReengagement(
  input: InactivityReengagementInput,
): InactivityReengagementDecision {
  const threshold = input.inactivityThresholdDays ?? DEFAULT_INACTIVITY_THRESHOLD_DAYS;
  const inboundMs = parseMs(input.lastInboundAt);
  const outboundMs = parseMs(input.lastOutboundAt);

  const candidates = [inboundMs, outboundMs].filter((v): v is number => v !== null);

  if (candidates.length === 0) {
    return { shouldTrigger: false, daysSinceLastContact: null, reason: "no_prior_contact" };
  }

  const lastContactMs = Math.max(...candidates);
  const daysSinceLastContact = Math.floor(
    (input.now.getTime() - lastContactMs) / (24 * 60 * 60 * 1000),
  );

  if (daysSinceLastContact >= threshold) {
    return { shouldTrigger: true, daysSinceLastContact, reason: "inactive_threshold_reached" };
  }
  return { shouldTrigger: false, daysSinceLastContact, reason: "still_within_threshold" };
}
