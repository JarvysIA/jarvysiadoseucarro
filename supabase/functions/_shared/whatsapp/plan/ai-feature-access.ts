// Fix-Voice-Transcription-Gate — gate de plano/trial pra funcionalidades
// de IA no WhatsApp que rodam ANTES de saber a qual veículo a mensagem se
// refere (hoje: transcrição de áudio — precisa virar texto antes de
// descobrir do que trata). Por isso não dá pra usar
// canVehiclePerformFullAction direto (exige um veículo já resolvido).
//
// Reaproveita a mesma regra de negócio já usada por
// resolveConversationHandoffAuthorization
// (../conversation-handoff/dr-jarvys-authorization.ts) para o caso
// vehicleId===null: libera se QUALQUER veículo não-arquivado do usuário
// tiver access mode "full". Nunca reimplementa
// computeWhatsappVehicleAccessMode nem os guards estruturais — só importa
// e reusa. selectOne/selectMany são réplica local intencional dos mesmos
// helpers privados de dr-jarvys-authorization.ts (não são exportados de
// lá) — duplicação pequena e deliberada, pra não tocar nesse arquivo
// sensível fora do estritamente necessário.
//
// Fail-closed sempre: userId vazio, erro de leitura, dado
// estruturalmente inconsistente, ou nenhum veículo full => false.

import {
  computeWhatsappVehicleAccessMode,
  type WhatsappVehicleAccessProfileInput,
} from "./vehicle-access-mode.ts";
import {
  isValidActivationContextRow,
  isValidProfileContextRow,
} from "../orchestrator/context-validation.ts";
import type { SupabaseLike } from "../orchestrator/repository.ts";

type SelectOneOutcome =
  | Readonly<{ ok: true; data: Record<string, unknown> | null }>
  | Readonly<{ ok: false }>;

type SelectManyOutcome =
  | Readonly<{ ok: true; data: readonly Record<string, unknown>[] }>
  | Readonly<{ ok: false }>;

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

function toAccessVehicleInput(
  row: Readonly<Record<string, unknown>>,
  activationSet: ReadonlySet<string>,
): Readonly<{ id: string; userId: string; status: string | null; hasPaidActivation: boolean }> {
  const id = typeof row.id === "string" ? row.id : "";
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  const status = typeof row.status === "string" ? row.status : null;
  return { id, userId, status, hasPaidActivation: activationSet.has(id) };
}

/**
 * Verifica se o usuário tem pelo menos UM veículo (não-arquivado) com
 * access mode "full" — critério usado pra liberar funcionalidades de IA
 * no WhatsApp que rodam antes de saber a qual veículo a mensagem se
 * refere (hoje: transcrição de áudio).
 */
export async function hasFullAccessVehicle(
  client: SupabaseLike,
  userId: string,
): Promise<boolean> {
  if (!userId) return false;

  const profileFetch = await selectOne(client, "profiles", "id,status_usuario,trial_inicio", {
    id: userId,
  });
  if (!profileFetch.ok || profileFetch.data === null) return false;
  if (!isValidProfileContextRow(profileFetch.data)) return false;
  const profile: WhatsappVehicleAccessProfileInput = {
    statusUsuario: profileFetch.data.status_usuario,
    trialInicio: profileFetch.data.trial_inicio,
  };

  const activationsFetch = await selectMany(
    client,
    "pagamentos_pix",
    "veiculo_id,status,tipo_produto,user_id",
    { user_id: userId, status: "pago", tipo_produto: "ativacao" },
  );
  if (!activationsFetch.ok) return false;
  const activationSet = new Set<string>();
  for (const row of activationsFetch.data) {
    if (!isValidActivationContextRow(row)) return false;
    activationSet.add(row.veiculo_id);
  }

  const vehiclesFetch = await selectMany(client, "veiculos", "id,user_id,status", {
    user_id: userId,
  });
  if (!vehiclesFetch.ok) return false;

  const now = new Date();
  for (const row of vehiclesFetch.data) {
    const status = typeof row.status === "string" ? row.status : null;
    if (status === "archived") continue;
    const vehicleInput = toAccessVehicleInput(row, activationSet);
    const accessMode = computeWhatsappVehicleAccessMode(profile, vehicleInput, userId, now);
    if (accessMode === "full") return true;
  }
  return false;
}
