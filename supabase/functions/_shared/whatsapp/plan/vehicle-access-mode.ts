// Build 5.7F2E1A.5-MJ0 — Classificador puro de acesso ao WhatsApp por veículo.
//
// Este módulo é ESTRITAMENTE puro:
//   - sem Supabase, sem Deno, sem fetch, sem I/O;
//   - sem imports do frontend (`src/*`);
//   - sem persistência, sem logging, sem env;
//   - sem regras T1/T2, sem prompt context.
//
// Executável em Bun e Deno. Aceita inputs BRUTOS (string|null) vindos do
// banco e valida em runtime. Nunca normaliza strings. Fail-closed em
// qualquer contexto inconsistente.

// ============================================================
// Contrato público
// ============================================================

export const WHATSAPP_VEHICLE_ACCESS_MODES = [
  "full",
  "passive_with_km",
  "denied",
] as const;

export type WhatsappVehicleAccessMode =
  (typeof WHATSAPP_VEHICLE_ACCESS_MODES)[number];

export type WhatsappVehicleAccessProfileInput = {
  readonly statusUsuario: string | null;
  readonly trialInicio: string | null;
};

export type WhatsappVehicleAccessVehicleInput = {
  readonly id: string;
  readonly userId: string;
  readonly status: string | null;
  readonly hasPaidActivation: boolean;
};

// ============================================================
// Constantes runtime PRIVADAS. NÃO exportar; NÃO substituir os tipos
// canônicos do produto em src/lib/profile-status.ts e src/lib/vehicle-status.ts.
// Réplica local intencional para independência do módulo Deno.
// ============================================================

const RECOGNIZED_PROFILE_STATUSES = [
  "trial",
  "ativo",
  "vip",
  "enterprise",
] as const;

const RECOGNIZED_VEHICLE_STATUSES = [
  "free",
  "trial",
  "ativo",
  "vip",
  "enterprise",
  "archived",
] as const;

// Regra canônica de produto (ver src/lib/plan-capabilities.ts). Réplica
// intencional; qualquer alteração exige atualização coordenada.
const TRIAL_DURATION_DAYS = 30;
const DAY_MS = 86_400_000;

type RecognizedProfileStatus = (typeof RECOGNIZED_PROFILE_STATUSES)[number];
type RecognizedVehicleStatus = (typeof RECOGNIZED_VEHICLE_STATUSES)[number];

function isRecognizedProfileStatus(v: string): v is RecognizedProfileStatus {
  return (RECOGNIZED_PROFILE_STATUSES as readonly string[]).includes(v);
}

function isRecognizedVehicleStatus(v: string): v is RecognizedVehicleStatus {
  return (RECOGNIZED_VEHICLE_STATUSES as readonly string[]).includes(v);
}

// ============================================================
// Função pura
// ============================================================

export function computeWhatsappVehicleAccessMode(
  profile: WhatsappVehicleAccessProfileInput | null,
  vehicle: WhatsappVehicleAccessVehicleInput | null,
  expectedUserId: string,
  now: Date,
): WhatsappVehicleAccessMode {
  // 1..2 — presença
  if (profile === null) return "denied";
  if (vehicle === null) return "denied";

  // 3..5 — IDs não vazios
  if (expectedUserId === "") return "denied";
  if (vehicle.id === "") return "denied";
  if (vehicle.userId === "") return "denied";

  // 6 — ownership real (defense-in-depth; a query já filtra por user_id)
  if (vehicle.userId !== expectedUserId) return "denied";

  // 7..8 — status do veículo reconhecido e não archived
  const vehicleStatus = vehicle.status;
  if (vehicleStatus === null) return "denied";
  if (!isRecognizedVehicleStatus(vehicleStatus)) return "denied";
  if (vehicleStatus === "archived") return "denied";

  // 9 — status do perfil reconhecido
  const profileStatus = profile.statusUsuario;
  if (profileStatus === null) return "denied";
  if (!isRecognizedProfileStatus(profileStatus)) return "denied";

  // 10..11 — VIP e Enterprise
  if (profileStatus === "vip") return "full";
  if (profileStatus === "enterprise") return "full";

  // 12 — trial (com regra fail-closed para datas inconsistentes)
  if (profileStatus === "trial") {
    const trialInicio = profile.trialInicio;
    if (trialInicio === null) return "full"; // trial sob demanda ainda não iniciado
    if (trialInicio === "") return "denied";
    const trialStartMs = Date.parse(trialInicio);
    if (Number.isNaN(trialStartMs)) return "denied";
    const elapsedMs = now.getTime() - trialStartMs;
    if (elapsedMs < 0) return "denied"; // data futura
    const elapsedDays = Math.floor(elapsedMs / DAY_MS);
    return elapsedDays < TRIAL_DURATION_DAYS ? "full" : "passive_with_km";
  }

  // 13 — ativo depende de ativação específica daquele veículo
  if (profileStatus === "ativo") {
    return vehicle.hasPaidActivation ? "full" : "passive_with_km";
  }

  // 14 — caminho inesperado (defensive: TS já cobre, runtime fecha)
  return "denied";
}
