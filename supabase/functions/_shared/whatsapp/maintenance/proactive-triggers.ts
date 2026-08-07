import {
  decideMilestoneNotice,
  type ExistingMilestoneNotice,
  type MilestoneNoticeReason,
} from "./milestone-notice-decision.ts";

export type ProactiveTriggerKind = "milestone_notice";
// NOTA: union terá mais membros ("km_prompt", "inactivity_reengagement")
// quando esses gatilhos forem definidos e adicionados em builds futuros.
// Não adicione esses membros agora — não existe regra de negócio definida
// para eles ainda.

export type MilestoneNoticeTriggerDecision = {
  kind: "milestone_notice";
  shouldTrigger: boolean;
  milestone: number;
  reason: MilestoneNoticeReason;
};

export type ProactiveTriggerDecision = MilestoneNoticeTriggerDecision;
// União cresce conforme novos gatilhos entram no registro.

export type ProactiveTriggerContext = {
  vehicleId: string;
  km: number;
  now: Date;
  existingMilestoneNotice: ExistingMilestoneNotice | null;
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

  const decisions: ProactiveTriggerDecision[] = [
    {
      kind: "milestone_notice",
      shouldTrigger: milestoneDecision.shouldNotify,
      milestone: milestoneDecision.milestone,
      reason: milestoneDecision.reason,
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
): ProactiveTriggerDecision[] {
  return decisions.filter((d) => d.shouldTrigger);
}
