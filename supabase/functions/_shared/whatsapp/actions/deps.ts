// Build 5.7F2E1D — Composição/fábrica de ConfirmedKmUpdateDeps ligado ao
// executor real (WhatsappKmActionRepository).
//
// Backend-only. NÃO é chamado por nenhum worker/webhook/test-service ainda —
// o objetivo é apenas deixar o caminho "executeConfirmedKmUpdate com executor
// de verdade" instanciável e testável sem tocar em runtime.
//
// Duas fábricas:
//   1. createConfirmedKmUpdateDeps(client, options?)
//      - Pura, sem dependência de ambiente. Aceita qualquer KmActionSupabaseLike
//        (cliente Supabase real ou fake com .rpc()). Usada pelos testes de
//        wiring e pelo caller que já tem um client em mãos.
//   2. createConfirmedKmUpdateDepsFromEnv(options?)
//      - Conveniência para Edge Functions: lê SUPABASE_URL /
//        SUPABASE_SERVICE_ROLE_KEY do Deno.env e monta o client via
//        @supabase/supabase-js, mesmo padrão de
//        supabase/functions/whatsapp-webhook/index.ts,
//        whatsapp-process-inbound/index.ts e whatsapp-send-outbound/index.ts.
//      - Import dinâmico do supabase-js para não quebrar o test runner (bun),
//        e leitura de Deno.env via globalThis para o módulo poder ser
//        importado fora do Deno sem explodir no top-level.

import {
  WhatsappKmActionRepository,
  type KmActionSupabaseLike,
} from "./repository.ts";
import type {
  ConfirmedKmUpdateDeps,
  ConfirmedKmUpdateLogger,
} from "./types.ts";

export type CreateConfirmedKmUpdateDepsOptions = {
  logger?: ConfirmedKmUpdateLogger;
  clock?: () => number;
};

/**
 * Fábrica pura: recebe um client estrutural com `.rpc()` e devolve
 * `ConfirmedKmUpdateDeps` com o `WhatsappKmActionRepository` de verdade como
 * executor. Não toca ambiente, não toca rede.
 */
export function createConfirmedKmUpdateDeps(
  client: KmActionSupabaseLike,
  options: CreateConfirmedKmUpdateDepsOptions = {},
): ConfirmedKmUpdateDeps {
  const executor = new WhatsappKmActionRepository(client);
  const deps: ConfirmedKmUpdateDeps = { executor };
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
export async function createConfirmedKmUpdateDepsFromEnv(
  options: CreateConfirmedKmUpdateDepsOptions = {},
): Promise<ConfirmedKmUpdateDeps> {
  const supabaseUrl = readDenoEnv("SUPABASE_URL");
  const serviceRoleKey = readDenoEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "createConfirmedKmUpdateDepsFromEnv: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios",
    );
  }
  const mod = await import(
    "https://esm.sh/@supabase/supabase-js@2.45.4"
  );
  const client = mod.createClient(supabaseUrl, serviceRoleKey);
  return createConfirmedKmUpdateDeps(client as KmActionSupabaseLike, options);
}
