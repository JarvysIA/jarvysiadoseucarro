// C4 — Resolve autorização e contexto técnico do handoff `conversation` a
// partir do banco real, via client estrutural injetado (nunca hardcoded,
// nunca service_role, nunca Deno.env). Primeiro módulo do C-track a fazer
// I/O de banco — todos os anteriores (C1/C2A/C2B/C3) eram puros. Só
// leitura: zero escrita em qualquer tabela.
//
// Reaproveita o classificador puro computeWhatsappVehicleAccessMode
// (../plan/vehicle-access-mode.ts) e os guards estruturais
// isValidProfileContextRow/isValidActivationContextRow
// (../orchestrator/context-validation.ts) — nunca reimplementa essas
// regras. Reaproveita só o tipo estrutural SupabaseLike do repository do
// orquestrador (nunca a classe inteira, que é específica de fila/lease).
//
// Fail-closed sempre: qualquer erro de leitura ou dado estruturalmente
// inconsistente vira authorization_required (ou vehicle_required quando a
// busca era por um veículo específico), nunca vaza mensagem ou código SQL
// no resultado retornado.

import {
  computeWhatsappVehicleAccessMode,
  type WhatsappVehicleAccessProfileInput,
} from "../plan/vehicle-access-mode.ts";
import {
  isValidActivationContextRow,
  isValidProfileContextRow,
} from "../orchestrator/context-validation.ts";
import type { SupabaseLike } from "../orchestrator/repository.ts";
import type { DrJarvysVehicleContext } from "../dr-jarvys/ask-dr-jarvys.ts";

export type ConversationHandoffAuthorizationResultV1 =
  | Readonly<{ authorized: true; vehicleContext?: DrJarvysVehicleContext }>
  | Readonly<{ authorized: false; reason: "authorization_required" | "vehicle_required" }>;

const DENIED: ConversationHandoffAuthorizationResultV1 = {
  authorized: false,
  reason: "authorization_required",
};

const VEHICLE_REQUIRED: ConversationHandoffAuthorizationResultV1 = {
  authorized: false,
  reason: "vehicle_required",
};

type SelectOneOutcome =
  | Readonly<{ ok: true; data: Record<string, unknown> | null }>
  | Readonly<{ ok: false }>;

type SelectManyOutcome =
  | Readonly<{ ok: true; data: readonly Record<string, unknown>[] }>
  | Readonly<{ ok: false }>;

// Mesmo padrão estrutural de leitura usado pelo repository do orquestrador
// (.from(table).select(cols).eq(...) encadeado) — redeclarado localmente
// porque esses métodos lá são privados da classe de fila/lease. Nunca
// lança: um erro de leitura vira { ok: false }, sem preservar mensagem ou
// código SQL em lugar nenhum.
async function selectOne(
  client: SupabaseLike,
  table: string,
  columns: string,
  filters: Readonly<Record<string, unknown>>,
): Promise<SelectOneOutcome> {
  if (!client.from) return { ok: false };
  let builder = client.from(table).select(columns);
  for (const [column, value] of Object.entries(filters)) {
    builder = builder.eq(column, value);
  }
  const result = await builder.maybeSingle();
  if (result.error) return { ok: false };
  return { ok: true, data: result.data };
}

async function selectMany(
  client: SupabaseLike,
  table: string,
  columns: string,
  filters: Readonly<Record<string, unknown>>,
): Promise<SelectManyOutcome> {
  if (!client.from) return { ok: false };
  let builder = client.from(table).select(columns);
  for (const [column, value] of Object.entries(filters)) {
    builder = builder.eq(column, value);
  }
  const result = await builder;
  if (result.error) return { ok: false };
  return { ok: true, data: result.data ?? [] };
}

// veiculos.ano é `text` no banco (nunca integer) — bate diretamente com
// DrJarvysVehicleContext.year: string | number sem conversão.
function buildVehicleContext(row: Readonly<Record<string, unknown>>): DrJarvysVehicleContext {
  const brand = typeof row.marca === "string" ? row.marca : undefined;
  const model = typeof row.modelo === "string" ? row.modelo : undefined;
  const year = typeof row.ano === "string" ? row.ano : undefined;
  const context: { brand?: string; model?: string; year?: string | number } = {};
  if (brand !== undefined) context.brand = brand;
  if (model !== undefined) context.model = model;
  if (year !== undefined) context.year = year;
  return context;
}

function toAccessVehicleInput(
  row: Readonly<Record<string, unknown>>,
  activationSet: ReadonlySet<string>,
): Readonly<{ id: string; userId: string; status: string | null; hasPaidActivation: boolean }> {
  const id = typeof row.id === "string" ? row.id : "";
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  const status = typeof row.status === "string" ? row.status : null;
  return { id, userId, status, hasPaidActivation: activationSet.has(id) };
}

export async function resolveConversationHandoffAuthorization(
  client: SupabaseLike,
  userId: string,
  vehicleId: string | null,
): Promise<ConversationHandoffAuthorizationResultV1> {
  const profileFetch = await selectOne(client, "profiles", "id,status_usuario,trial_inicio", {
    id: userId,
  });
  if (!profileFetch.ok) return DENIED;
  const profileRow = profileFetch.data;
  if (profileRow === null) return DENIED;
  if (!isValidProfileContextRow(profileRow)) return DENIED;
  const profile: WhatsappVehicleAccessProfileInput = {
    statusUsuario: profileRow.status_usuario,
    trialInicio: profileRow.trial_inicio,
  };

  const activationsFetch = await selectMany(
    client,
    "pagamentos_pix",
    "veiculo_id,status,tipo_produto,user_id",
    { user_id: userId, status: "pago", tipo_produto: "ativacao" },
  );
  if (!activationsFetch.ok) return DENIED;
  const activationSet = new Set<string>();
  for (const row of activationsFetch.data) {
    if (!isValidActivationContextRow(row)) return DENIED;
    activationSet.add(row.veiculo_id);
  }

  const now = new Date();

  if (vehicleId !== null) {
    const vehicleFetch = await selectOne(client, "veiculos", "id,user_id,marca,modelo,ano,status", {
      id: vehicleId,
      user_id: userId,
    });
    // Erro de leitura tratado como "não encontrado": não dá pra confirmar
    // posse do veículo, e vehicle_required não vaza detalhe nenhum.
    if (!vehicleFetch.ok) return VEHICLE_REQUIRED;
    const vehicleRow = vehicleFetch.data;
    if (vehicleRow === null) return VEHICLE_REQUIRED;

    const accessMode = computeWhatsappVehicleAccessMode(
      profile,
      toAccessVehicleInput(vehicleRow, activationSet),
      userId,
      now,
    );
    if (accessMode !== "full") return DENIED;
    return { authorized: true, vehicleContext: buildVehicleContext(vehicleRow) };
  }

  const vehiclesFetch = await selectMany(client, "veiculos", "id,user_id,status", {
    user_id: userId,
  });
  if (!vehiclesFetch.ok) return DENIED;
  for (const row of vehiclesFetch.data) {
    const status = typeof row.status === "string" ? row.status : null;
    if (status === "archived") continue; // fora da busca, nunca considerado
    const accessMode = computeWhatsappVehicleAccessMode(
      profile,
      toAccessVehicleInput(row, activationSet),
      userId,
      now,
    );
    if (accessMode === "full") return { authorized: true };
  }
  return DENIED;
}
