import {
  decideMilestoneNotice,
  type ExistingMilestoneNotice,
  type MilestoneNoticeReason,
} from "./milestone-notice-decision.ts";
import {
  decideInactivityReengagement,
  type InactivityReengagementReason,
} from "./inactivity-reengagement-decision.ts";

export type ProactiveTriggerKind = "milestone_notice" | "inactivity_reengagement";
// NOTA: union terá mais membros ("km_prompt") quando esse gatilho for
// definido e adicionado em builds futuros. Não adicione esse membro agora
// — não existe regra de negócio definida para ele ainda.

export type MilestoneNoticeTriggerDecision = {
  kind: "milestone_notice";
  shouldTrigger: boolean;
  milestone: number;
  reason: MilestoneNoticeReason;
};

export type InactivityReengagementTriggerDecision = {
  kind: "inactivity_reengagement";
  shouldTrigger: boolean;
  daysSinceLastContact: number | null;
  reason: InactivityReengagementReason;
};

export type ProactiveTriggerDecision =
  | MilestoneNoticeTriggerDecision
  | InactivityReengagementTriggerDecision;
// União cresce conforme novos gatilhos entram no registro.

export type ProactiveTriggerContext = {
  vehicleId: string;
  km: number;
  now: Date;
  existingMilestoneNotice: ExistingMilestoneNotice | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
};

/**
 * Avalia todos os gatilhos proativos registrados para um veículo, dado o
 * contexto atual. Retorna a decisão de CADA gatilho (inclusive os que não
 * devem disparar) — quem decide o que fazer com isso é o chamador (fora
 * de escopo aqui: isso é wiring, ainda travado no item 10).
 */
export function evaluateProactiveTriggers(
  context: ProactiveTriggerContext,
): ProactiveTriggerDecision[] {
  const milestoneDecision = decideMilestoneNotice({
    km: context.km,
    existingNotice: context.existingMilestoneNotice,
    now: context.now,
  });

  const inactivityDecision = decideInactivityReengagement({
    lastInboundAt: context.lastInboundAt,
    lastOutboundAt: context.lastOutboundAt,
    now: context.now,
  });

  const decisions: ProactiveTriggerDecision[] = [
    {
      kind: "milestone_notice",
      shouldTrigger: milestoneDecision.shouldNotify,
      milestone: milestoneDecision.milestone,
      reason: milestoneDecision.reason,
    },
    {
      kind: "inactivity_reengagement",
      shouldTrigger: inactivityDecision.shouldTrigger,
      daysSinceLastContact: inactivityDecision.daysSinceLastContact,
      reason: inactivityDecision.reason,
    },
  ];

  return decisions;
}

/**
 * Helper de conveniência: filtra só os gatilhos que devem disparar agora,
 * de um array já avaliado por evaluateProactiveTriggers.
 */
export function triggersDueNow(
  decisions: ReadonlyArray<ProactiveTriggerDecision>,
): MilestoneNoticeTriggerDecision[] | InactivityReengagementTriggerDecision[] {
  return decisions.filter((d) => d.shouldTrigger) as
    | MilestoneNoticeTriggerDecision[]
    | InactivityReengagementTriggerDecision[];
}
