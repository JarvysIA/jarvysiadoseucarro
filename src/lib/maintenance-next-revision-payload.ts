// Build 6.41 — Payload limpo da próxima revisão.
//
// Helper puro que transforma o resultado de getNextMilestone em um payload
// orientado a produto, separando dados de UX final do bloco de debug/admin.
//
// Zero I/O. Zero IA. Zero persistência. Não muta plan nem result.
// Termos como "recurring", "baseReferenceKm", "10k–200k", "plano base",
// "km_acima_do_plano_base", "itens_baseados_em_ciclo_10k_200k",
// "proxima_revisao_recorrente" NUNCA aparecem em userMessages.

import {
  getNextMilestone,
  type NextMilestoneResult,
} from "./maintenance-next-milestone";

// ─── Tipos públicos ───────────────────────────────────────────────────────

export type NextRevisionUserSeverity =
  | "neutral"
  | "attention"
  | "due"
  | "high_mileage";

export type NextRevisionItemKind =
  | "shopping_candidate"
  | "service_only"
  | "inspect_before_buy"
  | "info_only";

export type NextRevisionPayloadItem = {
  itemKey: string;
  label: string;
  category: string | null;
  action: string | null;
  recommendationType: string | null;
  shoppingClassification: string | null;
  applies: boolean | null;
  kind: NextRevisionItemKind;
  userNote: string | null;
};

export type NextRevisionPayload = {
  ok: boolean;
  status: "ok" | "invalid_plan" | "invalid_km";
  vehicleSummary: {
    displayName: string | null;
    marca: string | null;
    modeloFipe: string | null;
    anoModelo: number | null;
    combustivel: string | null;
    motorTextual: string | null;
    transmissao: string | null;
  };
  revision: {
    targetKm: number | null;
    currentKm: number | null;
    distanceKm: number | null;
    alertStatus: "none" | "upcoming" | "due" | "due_grace";
    severity: NextRevisionUserSeverity;
    isInAlertWindow: boolean;
    isHighMileage: boolean;
    isRecurring: boolean;
    isDismissed: boolean;
  };
  userMessages: {
    title: string;
    subtitle: string | null;
    highMileageTitle: string | null;
    highMileageMessage: string | null;
    safetyMessage: string | null;
  };
  itemsToShow: NextRevisionPayloadItem[];
  itemsShoppingCandidates: NextRevisionPayloadItem[];
  itemsServiceOnly: NextRevisionPayloadItem[];
  itemsInspectBeforeBuy: NextRevisionPayloadItem[];
  debug: {
    sourceStatus: string;
    sourceMode: string | null;
    baseReferenceKm: number | null;
    warnings: string[];
  };
};

// ─── Constantes fixas (copy oficial) ──────────────────────────────────────

const HIGH_MILEAGE_THRESHOLD_KM = 200000;

const HIGH_MILEAGE_TITLE = "Alta quilometragem";
const HIGH_MILEAGE_MESSAGE =
  "Esta revisão foi calculada pelo ciclo preventivo Jarvys, pois o veículo está acima do plano fornecido pela montadora. Confira os itens e confirme a aplicação antes da compra ou serviço.";
const SAFETY_MESSAGE =
  "Confira a aplicação das peças antes da compra ou serviço.";

const SERVICE_ONLY_KEYWORDS = [
  "diagnostico",
  "diagnóstico",
  "scanner",
  "checklist",
  "mao_de_obra",
  "mão_de_obra",
  "mao-de-obra",
  "mão-de-obra",
  "servico",
  "serviço",
  "inspecao",
  "inspeção",
];

const SERVICE_ONLY_NOTE = "Serviço recomendado em oficina especializada.";

// ─── Helpers defensivos ───────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asBoolean(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function formatKm(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("pt-BR")} km`;
}

function formatKmShort(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR");
}

function emptyVehicleSummary(): NextRevisionPayload["vehicleSummary"] {
  return {
    displayName: null,
    marca: null,
    modeloFipe: null,
    anoModelo: null,
    combustivel: null,
    motorTextual: null,
    transmissao: null,
  };
}

function buildVehicleSummary(
  plan: unknown,
): NextRevisionPayload["vehicleSummary"] {
  if (!isRecord(plan)) return emptyVehicleSummary();
  const vs = plan["vehicle_summary"];
  if (!isRecord(vs)) return emptyVehicleSummary();
  return {
    displayName: asString(vs["display_name"]),
    marca: asString(vs["marca"]),
    modeloFipe: asString(vs["modelo_fipe"]),
    anoModelo: asNumber(vs["ano_modelo"]),
    combustivel: asString(vs["combustivel"]),
    motorTextual: asString(vs["motor_textual"]),
    transmissao: asString(vs["transmissao"]),
  };
}

function isServiceOnlyByKeywords(
  itemKey: string,
  category: string | null,
  label: string,
): boolean {
  const haystack = `${itemKey} ${category ?? ""} ${label}`.toLowerCase();
  return SERVICE_ONLY_KEYWORDS.some((kw) => haystack.includes(kw));
}

function classifyKind(
  itemKey: string,
  label: string,
  category: string | null,
  recommendationType: string | null,
  shoppingClassification: string | null,
): { kind: NextRevisionItemKind; userNote: string | null } {
  // Override: itens claramente de serviço viram service_only mesmo se a IA
  // tiver marcado safe_to_buy.
  if (isServiceOnlyByKeywords(itemKey, category, label)) {
    return { kind: "service_only", userNote: SERVICE_ONLY_NOTE };
  }

  if (shoppingClassification === "service_only") {
    return { kind: "service_only", userNote: SERVICE_ONLY_NOTE };
  }

  if (shoppingClassification === "inspect_before_buy") {
    return {
      kind: "inspect_before_buy",
      userNote: "Confirme a compatibilidade antes da compra.",
    };
  }

  if (
    shoppingClassification === "safe_to_buy" ||
    shoppingClassification === "bundle_preferred"
  ) {
    return { kind: "shopping_candidate", userNote: null };
  }

  if (recommendationType === "inspect_only") {
    return { kind: "service_only", userNote: SERVICE_ONLY_NOTE };
  }

  return { kind: "info_only", userNote: null };
}

function buildItem(raw: unknown): NextRevisionPayloadItem | null {
  if (!isRecord(raw)) return null;

  const applies = asBoolean(raw["applies"]);
  const recommendationType = asString(raw["recommendation_type"]);

  // Regra 4: itens não aplicáveis NÃO entram no payload de usuário.
  if (applies === false) return null;
  if (recommendationType === "not_applicable") return null;

  const itemKey = asString(raw["item_key"]);
  if (itemKey === null) return null;

  const label = asString(raw["label"]) ?? itemKey;
  const category = asString(raw["category"]);
  const shoppingClassification = asString(raw["shopping_classification"]);

  const { kind, userNote } = classifyKind(
    itemKey,
    label,
    category,
    recommendationType,
    shoppingClassification,
  );

  return {
    itemKey,
    label,
    category,
    action: asString(raw["action"]),
    recommendationType,
    shoppingClassification,
    applies,
    kind,
    userNote,
  };
}

function buildUserMessages(
  result: NextMilestoneResult,
  isHighMileage: boolean,
): {
  messages: NextRevisionPayload["userMessages"];
  severity: NextRevisionUserSeverity;
} {
  const targetTxt = formatKmShort(result.targetKm);
  const distanceTxt = formatKmShort(result.distanceKm);

  let title = "Próxima revisão";
  let subtitle: string | null = null;
  let severity: NextRevisionUserSeverity = "neutral";

  switch (result.alertStatus) {
    case "upcoming":
      title = "Próxima revisão chegando";
      subtitle = `Faltam ${distanceTxt} km para a revisão de ${targetTxt} km.`;
      severity = "attention";
      break;
    case "due":
      title = "Chegou a revisão";
      subtitle = `Chegou a revisão de ${targetTxt} km.`;
      severity = "due";
      break;
    case "due_grace":
      title = "Revisão pendente";
      subtitle = `A revisão de ${targetTxt} km ainda está pendente.`;
      severity = "due";
      break;
    case "none":
    default:
      title = "Próxima revisão";
      subtitle = `Próxima revisão prevista para ${targetTxt} km.`;
      severity = isHighMileage ? "high_mileage" : "neutral";
      break;
  }

  const highMileageTitle = isHighMileage ? HIGH_MILEAGE_TITLE : null;
  const highMileageMessage = isHighMileage ? HIGH_MILEAGE_MESSAGE : null;

  return {
    messages: {
      title,
      subtitle,
      highMileageTitle,
      highMileageMessage,
      safetyMessage: SAFETY_MESSAGE,
    },
    severity,
  };
}

function buildInvalidPayload(
  result: NextMilestoneResult,
  plan: unknown,
  status: "invalid_plan" | "invalid_km",
): NextRevisionPayload {
  const title =
    status === "invalid_km"
      ? "Informe a quilometragem atual"
      : "Plano de manutenção indisponível";
  const subtitle =
    status === "invalid_km"
      ? "Não foi possível calcular a próxima revisão sem a quilometragem atual."
      : "Não foi possível calcular a próxima revisão a partir do plano disponível.";

  return {
    ok: false,
    status,
    vehicleSummary: buildVehicleSummary(plan),
    revision: {
      targetKm: result.targetKm,
      currentKm: result.kmAtual,
      distanceKm: result.distanceKm,
      alertStatus: result.alertStatus,
      severity: "neutral",
      isInAlertWindow: result.isInAlertWindow,
      isHighMileage: result.kmAtual >= HIGH_MILEAGE_THRESHOLD_KM,
      isRecurring: result.mode === "recurring",
      isDismissed: result.isDismissed,
    },
    userMessages: {
      title,
      subtitle,
      highMileageTitle: null,
      highMileageMessage: null,
      safetyMessage: SAFETY_MESSAGE,
    },
    itemsToShow: [],
    itemsShoppingCandidates: [],
    itemsServiceOnly: [],
    itemsInspectBeforeBuy: [],
    debug: {
      sourceStatus: result.status,
      sourceMode: result.mode,
      baseReferenceKm: result.baseReferenceKm,
      warnings: [...result.warnings],
    },
  };
}

// ─── API pública ──────────────────────────────────────────────────────────

export function buildNextRevisionPayload(
  plan: unknown,
  kmAtualInput: unknown,
  options?: {
    alertThresholdKm?: number;
    postDueReminderKm?: number;
    intervalKm?: number;
    dismissedRevisionKms?: number[];
  },
): NextRevisionPayload {
  const result = getNextMilestone(plan, kmAtualInput, options);

  if (result.status === "invalid_km") {
    return buildInvalidPayload(result, plan, "invalid_km");
  }
  if (result.status === "invalid_plan") {
    return buildInvalidPayload(result, plan, "invalid_plan");
  }

  // status === "ok" | "recurring"  → ambos viram "ok" no payload.
  const isHighMileage = result.kmAtual >= HIGH_MILEAGE_THRESHOLD_KM;

  // Itens.
  const rawItems = Array.isArray(result.items) ? result.items : [];
  const debugWarnings: string[] = [...result.warnings];

  const itemsToShow: NextRevisionPayloadItem[] = [];
  for (const raw of rawItems) {
    // Detectar não aplicável ANTES de buildItem para emitir warning debug.
    if (isRecord(raw)) {
      const applies = asBoolean(raw["applies"]);
      const recType = asString(raw["recommendation_type"]);
      if (applies === false || recType === "not_applicable") {
        debugWarnings.push("item_nao_aplicavel_ignorado");
        continue;
      }
    }
    const it = buildItem(raw);
    if (it !== null) itemsToShow.push(it);
  }

  const itemsShoppingCandidates = itemsToShow.filter(
    (it) => it.kind === "shopping_candidate" || it.kind === "inspect_before_buy",
  );
  const itemsServiceOnly = itemsToShow.filter(
    (it) => it.kind === "service_only",
  );
  const itemsInspectBeforeBuy = itemsToShow.filter(
    (it) => it.kind === "inspect_before_buy",
  );

  const { messages, severity } = buildUserMessages(result, isHighMileage);

  return {
    ok: true,
    status: "ok",
    vehicleSummary: buildVehicleSummary(plan),
    revision: {
      targetKm: result.targetKm,
      currentKm: result.kmAtual,
      distanceKm: result.distanceKm,
      alertStatus: result.alertStatus,
      severity,
      isInAlertWindow: result.isInAlertWindow,
      isHighMileage,
      isRecurring: result.mode === "recurring",
      isDismissed: result.isDismissed,
    },
    userMessages: messages,
    itemsToShow,
    itemsShoppingCandidates,
    itemsServiceOnly,
    itemsInspectBeforeBuy,
    debug: {
      sourceStatus: result.status,
      sourceMode: result.mode,
      baseReferenceKm: result.baseReferenceKm,
      warnings: debugWarnings,
    },
  };
}

// Silenciador para evitar warning de helper utilitário não usado externamente.
void formatKm;
