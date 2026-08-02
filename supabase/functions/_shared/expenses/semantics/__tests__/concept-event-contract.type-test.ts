import type {
  CompletedInspectionEvent,
  ConceptEvent,
  ConceptEventOccurrence,
  ConfirmedCompletedServiceEvent,
  FutureIntentEvent,
  FutureScheduleEffectCandidate,
  InstallationEvent,
  NoTechnicalEffect,
  PurchaseEvent,
  QuoteEvent,
  RecognizedAutomotiveConcept,
} from "../concept-event-contract.ts";

const none = { status: "none", executedItemKeys: [] } as const satisfies NoTechnicalEffect;
const effect = {
  status: "eligible_for_future_schedule_effect",
  executedItemKeys: ["oleo_motor"],
  authorization: "requires_deterministic_engine_validation",
  activation: "not_applied",
} as const satisfies FutureScheduleEffectCandidate;
const validPurchase = {
  kind: "purchase",
  completion: "completed",
  technicalEffect: none,
} as const satisfies PurchaseEvent;
const validService = {
  kind: "completed_service",
  serviceKind: "replacement",
  completion: "explicitly_confirmed",
  technicalEffect: effect,
} as const satisfies ConfirmedCompletedServiceEvent;
const validMixedContract = {
  contractVersion: "p0_3b_s3_1",
  concepts: [
    {
      concept: {
        conceptKey: "engine_oil",
        recognitionSource: "deterministic_core",
        relatedItemKeys: ["oleo_motor"],
      },
      events: [validPurchase, validService],
    },
    {
      concept: {
        conceptKey: "multimedia_system",
        recognitionSource: "explicit_user_statement",
        relatedItemKeys: [],
      },
      events: [
        validPurchase,
        { kind: "installation", completion: "confirmed_completed", technicalEffect: none },
      ],
    },
  ],
  financialOccurrence: {
    status: "present",
    occurrenceCount: 1,
    amount: {
      kind: "single_user_declared_total",
      declaredAmount: 2200,
      allocation: "undivided",
    },
  },
  aiAuthority: "none",
  runtimeIntegration: "disconnected",
} as const satisfies ConceptEventOccurrence;

const purchaseWithEffectSource = { ...validPurchase, technicalEffect: effect } as const;
// @ts-expect-error compra aceita somente NoTechnicalEffect.
const purchaseWithEffect: PurchaseEvent = purchaseWithEffectSource;

const purchaseWithExecutedItemSource = {
  ...validPurchase,
  executedItemKeys: ["oleo_motor"],
} as const;
// @ts-expect-error executedItemKeys não pode existir fora de technicalEffect.
const purchaseWithExecutedItem: PurchaseEvent = purchaseWithExecutedItemSource;

const contextualPurchaseWithLegacyField = {
  kind: "purchase",
  completion: "completed",
  technicalEffect: none,
  // @ts-expect-error serviceCompleted legado é proibido no acontecimento.
  serviceCompleted: true,
} satisfies PurchaseEvent;

const indirectPurchaseWithLegacyFieldSource = {
  ...validPurchase,
  serviceCompleted: true,
} as const;
// @ts-expect-error serviceCompleted também é bloqueado por atribuição indireta.
const indirectPurchaseWithLegacyField: PurchaseEvent = indirectPurchaseWithLegacyFieldSource;

const indirectPurchaseOperationalField = { ...validPurchase, vehicleId: "vehicle-1" } as const;
// @ts-expect-error campos operacionais são bloqueados também por atribuição indireta.
const purchaseWithIndirectOperationalField: PurchaseEvent = indirectPurchaseOperationalField;

const contextualPurchaseOperationalField = {
  kind: "purchase",
  completion: "completed",
  technicalEffect: none,
  // @ts-expect-error campo operacional é bloqueado em literal contextualizado.
  vehicleId: "vehicle-1",
} satisfies PurchaseEvent;

const purchaseWithUndefinedVehicleSource = { ...validPurchase, vehicleId: undefined } as const;
// @ts-expect-error vehicleId is forbidden even when explicitly undefined.
const purchaseWithUndefinedVehicle: PurchaseEvent = purchaseWithUndefinedVehicleSource;

const purchaseWithUndefinedServiceCompletedSource = {
  ...validPurchase,
  serviceCompleted: undefined,
} as const;
// @ts-expect-error serviceCompleted is forbidden even when explicitly undefined.
const purchaseWithUndefinedServiceCompleted: PurchaseEvent =
  purchaseWithUndefinedServiceCompletedSource;

const purchaseWithUndefinedAmountSource = { ...validPurchase, amount: undefined } as const;
// @ts-expect-error amount cannot exist on an event, including as undefined.
const purchaseWithUndefinedAmount: PurchaseEvent = purchaseWithUndefinedAmountSource;

const purchaseWithUndefinedItemsSource = {
  ...validPurchase,
  executedItemKeys: undefined,
} as const;
// @ts-expect-error executedItemKeys outside technicalEffect is forbidden as undefined.
const purchaseWithUndefinedItems: PurchaseEvent = purchaseWithUndefinedItemsSource;

const purchaseWithUndefinedSchedule = {
  kind: "purchase",
  completion: "completed",
  technicalEffect: none,
  scheduleUpdated: undefined,
  // @ts-expect-error scheduleUpdated is forbidden in a contextual literal as undefined.
} satisfies PurchaseEvent;

const quoteWithEffectSource = {
  kind: "quote",
  completion: "proposal_only",
  technicalEffect: effect,
} as const;
// @ts-expect-error orçamento não produz efeito técnico.
const quoteWithEffect: QuoteEvent = quoteWithEffectSource;

const futureIntentWithEffectSource = {
  kind: "future_intent",
  completion: "not_started",
  technicalEffect: effect,
} as const;
// @ts-expect-error intenção futura não produz efeito técnico.
const futureIntentWithEffect: FutureIntentEvent = futureIntentWithEffectSource;

const installationWithEffectSource = {
  kind: "installation",
  completion: "confirmed_completed",
  technicalEffect: effect,
} as const;
// @ts-expect-error instalação permanece sem efeito técnico.
const installationWithEffect: InstallationEvent = installationWithEffectSource;

const inspectionAsReplacementSource = {
  kind: "completed_inspection",
  completion: "confirmed_completed",
  technicalEffect: none,
  serviceKind: "replacement",
} as const;
// @ts-expect-error inspeção não pode declarar substituição.
const inspectionAsReplacement: CompletedInspectionEvent = inspectionAsReplacementSource;

const serviceWithNoEffectSource = { ...validService, technicalEffect: none } as const;
// @ts-expect-error completed_service exige FutureScheduleEffectCandidate.
const serviceWithNoEffect: ConfirmedCompletedServiceEvent = serviceWithNoEffectSource;

const serviceWithEmptyItemsSource = {
  ...validService,
  technicalEffect: { ...effect, executedItemKeys: [] },
} as const;
// @ts-expect-error completed_service exige executedItemKeys não vazio.
const serviceWithEmptyItems: ConfirmedCompletedServiceEvent = serviceWithEmptyItemsSource;

const serviceWithoutAuthorizationSource = {
  kind: "completed_service",
  serviceKind: "replacement",
  completion: "explicitly_confirmed",
  technicalEffect: {
    status: "eligible_for_future_schedule_effect",
    executedItemKeys: ["oleo_motor"],
    activation: "not_applied",
  },
} as const;
// @ts-expect-error autorização determinística é obrigatória.
const serviceWithoutAuthorization: ConfirmedCompletedServiceEvent =
  serviceWithoutAuthorizationSource;

const appliedServiceSource = {
  ...validService,
  technicalEffect: { ...effect, activation: "applied" },
} as const;
// @ts-expect-error o contrato nunca representa efeito já aplicado.
const appliedService: ConfirmedCompletedServiceEvent = appliedServiceSource;

const aiAuthorizedEffectSource = { ...effect, authorization: "ai_suggestion" } as const;
// @ts-expect-error a IA não possui autoridade para autorizar efeito técnico.
const aiAuthorizedEffect: FutureScheduleEffectCandidate = aiAuthorizedEffectSource;

const eventWithTopLevelItemsSource = { ...validService, executedItemKeys: ["oleo_motor"] } as const;
// @ts-expect-error executedItemKeys de serviço também existe somente em technicalEffect.
const eventWithTopLevelItems: ConceptEvent = eventWithTopLevelItemsSource;

const eventWithAmountSource = { ...validPurchase, amount: 100 } as const;
// @ts-expect-error valor pertence exclusivamente à ocorrência financeira.
const eventWithAmount: PurchaseEvent = eventWithAmountSource;

const eventWithAllocationSource = { ...validPurchase, allocation: "undivided" } as const;
// @ts-expect-error alocação financeira não pertence ao acontecimento.
const eventWithAllocation: PurchaseEvent = eventWithAllocationSource;

type EventKind = ConceptEvent["kind"];
type RecognitionSource = RecognizedAutomotiveConcept["recognitionSource"];
type AcceptEventKind<T extends EventKind> = T;
type AcceptRecognitionSource<T extends RecognitionSource> = T;
// @ts-expect-error discriminante de acontecimento é fechado.
type UnknownEventKind = AcceptEventKind<"payment">;
// @ts-expect-error fonte de reconhecimento não concede autoridade à IA.
type UnknownRecognitionSource = AcceptRecognitionSource<"ai_suggestion">;

const invalidConceptKeySource = {
  conceptKey: "tires",
  recognitionSource: "deterministic_core",
  relatedItemKeys: [],
} as const;
// @ts-expect-error conceito desconhecido não entra na união fechada.
const invalidConceptKey: RecognizedAutomotiveConcept = invalidConceptKeySource;

const dividedAmountSource = {
  status: "present",
  occurrenceCount: 1,
  amount: {
    kind: "single_user_declared_total",
    declaredAmount: 100,
    allocation: "split_by_concept",
  },
} as const;
// @ts-expect-error rateio por conceito é proibido.
const dividedAmount: ConceptEventOccurrence["financialOccurrence"] = dividedAmountSource;

declare const readonlyContract: ConceptEventOccurrence;
function assertReadonly(): void {
  // @ts-expect-error contrato é readonly.
  readonlyContract.aiAuthority = "none";
  // @ts-expect-error conceitos são readonly.
  readonlyContract.concepts.push(readonlyContract.concepts[0]);
}

void validMixedContract;
void purchaseWithEffect;
void purchaseWithExecutedItem;
void contextualPurchaseWithLegacyField;
void indirectPurchaseWithLegacyField;
void purchaseWithIndirectOperationalField;
void contextualPurchaseOperationalField;
void purchaseWithUndefinedVehicle;
void purchaseWithUndefinedServiceCompleted;
void purchaseWithUndefinedAmount;
void purchaseWithUndefinedItems;
void purchaseWithUndefinedSchedule;
void quoteWithEffect;
void futureIntentWithEffect;
void installationWithEffect;
void inspectionAsReplacement;
void serviceWithNoEffect;
void serviceWithEmptyItems;
void serviceWithoutAuthorization;
void appliedService;
void aiAuthorizedEffect;
void eventWithTopLevelItems;
void eventWithAmount;
void eventWithAllocation;
void invalidConceptKey;
void dividedAmount;
void assertReadonly;

export {};
