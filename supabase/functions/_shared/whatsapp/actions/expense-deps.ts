// Build 5.7F2E1A.5-CLEANUP — Composição/fábrica de
// ConfirmedExpenseCreateDeps ligado ao executor real
// (WhatsappExpenseActionRepository). Mirror estrutural de actions/deps.ts.
//
// Backend-only. NÃO é chamado por nenhum worker/webhook/test-service ainda —
// o objetivo é apenas deixar o caminho "executeConfirmedExpenseCreate com
// executor de verdade" instanciável e testável sem tocar em runtime.

import {
  WhatsappExpenseActionRepository,
  type ExpenseActionSupabaseLike,
} from "./expense-repository.ts";
import type {
  ConfirmedExpenseCreateDeps,
  ConfirmedExpenseCreateLogger,
} from "./expense-types.ts";

export type CreateConfirmedExpenseCreateDepsOptions = {
  logger?: ConfirmedExpenseCreateLogger;
  clock?: () => number;
};

/**
 * Fábrica pura: recebe um client estrutural com `.rpc()` e devolve
 * `ConfirmedExpenseCreateDeps` com o `WhatsappExpenseActionRepository` de
 * verdade como executor. Não toca ambiente, não toca rede.
 */
export function createConfirmedExpenseCreateDeps(
  client: ExpenseActionSupabaseLike,
  options: CreateConfirmedExpenseCreateDepsOptions = {},
): ConfirmedExpenseCreateDeps {
  const executor = new WhatsappExpenseActionRepository(client);
  const deps: ConfirmedExpenseCreateDeps = { executor };
  if (options.logger !== undefined) deps.logger = options.logger;
  if (options.clock !== undefined) deps.clock = options.clock;
  return deps;
}

// ---------------------------------------------------------------------------
// Conveniência para Edge Functions (Deno). Não usada por nenhum runtime ainda.
// ---------------------------------------------------------------------------

type DenoEnvLike = { get(name: string): string | undefined };
type DenoGlobalLike = { env?: DenoEnvLike };

function readDenoEnv(name: string): string | undefined {
  const denoGlobal = (globalThis as unknown as { Deno?: DenoGlobalLike }).Deno;
  return denoGlobal?.env?.get(name);
}

/**
 * Monta o deps a partir de SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY do
 * Deno.env. Só deve ser chamada dentro de uma Edge Function. Lança se as
 * envs não estiverem presentes.
 */
export async function createConfirmedExpenseCreateDepsFromEnv(
  options: CreateConfirmedExpenseCreateDepsOptions = {},
): Promise<ConfirmedExpenseCreateDeps> {
  const supabaseUrl = readDenoEnv("SUPABASE_URL");
  const serviceRoleKey = readDenoEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "createConfirmedExpenseCreateDepsFromEnv: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios",
    );
  }
  const mod = await import(
    "https://esm.sh/@supabase/supabase-js@2.45.4"
  );
  const client = mod.createClient(supabaseUrl, serviceRoleKey);
  return createConfirmedExpenseCreateDeps(
    client as unknown as ExpenseActionSupabaseLike,
    options,
  );
}
