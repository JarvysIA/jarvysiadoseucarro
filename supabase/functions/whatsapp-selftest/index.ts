// Função temporária de limpeza: remove o bucket órfão vehicle-images.
// Será revertida para neutralizada imediatamente após execução.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cleanup-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

type DenoEnvLike = { get(name: string): string | undefined };
type DenoGlobalLike = {
  env?: DenoEnvLike;
  serve?: (handler: (req: Request) => Promise<Response>) => unknown;
};

function readDenoGlobal(): DenoGlobalLike | undefined {
  return (globalThis as unknown as { Deno?: DenoGlobalLike }).Deno;
}

function readDenoEnv(name: string): string | undefined {
  return readDenoGlobal()?.env?.get(name);
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = readDenoEnv("SUPABASE_URL");
  const serviceRoleKey = readDenoEnv("SUPABASE_SERVICE_ROLE_KEY");
  const cleanupSecret = readDenoEnv("CLEANUP_VEHICLE_IMAGES_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server_not_configured" }, 500);
  }
  if (!cleanupSecret) {
    return json({ error: "worker_not_configured" }, 500);
  }

  const receivedSecret = req.headers.get("x-cleanup-secret") ?? "";
  if (!receivedSecret || !safeEqual(receivedSecret, cleanupSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: objects, error: listError } = await client.storage
      .from("vehicle-images")
      .list();
    if (listError) {
      return json({ error: listError.message }, 500);
    }

    const removed: string[] = [];
    for (const obj of objects || []) {
      const { error: removeError } = await client.storage
        .from("vehicle-images")
        .remove([obj.name]);
      if (removeError) {
        return json({ error: removeError.message, removed }, 500);
      }
      removed.push(obj.name);
    }

    const { error: deleteBucketError } = await client.storage.deleteBucket(
      "vehicle-images",
    );
    if (deleteBucketError) {
      return json({ error: deleteBucketError.message, removed }, 500);
    }

    return json({ ok: true, removed }, 200);
  } catch (err) {
    return json({ error: "internal_error", detail: String(err) }, 500);
  }
}

const denoGlobal = readDenoGlobal();
if (typeof denoGlobal?.serve === "function") {
  denoGlobal.serve(handleRequest);
}
