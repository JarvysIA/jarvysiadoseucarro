// Build Vehicle-Image-Cache: nenhuma utilidade de normalização de texto
// compartilhada foi encontrada em src/lib (busca feita antes de escrever
// esta função) — escrita local e simples, não exportada.
type NormalizedVehicleImageKey = {
  marca_norm: string;
  modelo_norm: string;
  ano_norm: string;
  cor_norm: string;
};

function normalizeVehicleImageKey(input: {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
}): NormalizedVehicleImageKey {
  return {
    marca_norm: input.marca.trim().toUpperCase(),
    modelo_norm: input.modelo.trim().toUpperCase(),
    ano_norm: input.ano.trim().toUpperCase(),
    cor_norm: input.cor.trim().toUpperCase(),
  };
}

// lowercase; espaços internos de cada campo viram "-"; qualquer caractere
// fora de [a-z0-9_-] vira "_" (conservador — nunca deixa passar caractere
// que possa confundir o Storage). Campos são unidos com "_".
// Ex.: marca "TOYOTA", modelo "CCROSS XRE 20", ano "2022", cor "PRETA"
//   -> "cache/toyota_ccross-xre-20_2022_preta.png"
function sanitizeFieldForPath(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "_");
}

function buildVehicleImageCachePath(key: NormalizedVehicleImageKey): string {
  const parts = [key.marca_norm, key.modelo_norm, key.ano_norm, key.cor_norm].map(
    sanitizeFieldForPath,
  );
  return `cache/${parts.join("_")}.png`;
}

// ------------------------------------------------------------------
// Client estrutural mínimo — só o subconjunto de supabaseAdmin que esta
// função usa (select/eq/maybeSingle + upsert em vehicle_image_cache,
// update em veiculos, storage.upload/createSignedUrl). Mesmo espírito de
// SupabaseLike em supabase/functions/_shared/whatsapp/orchestrator/
// repository.ts — permite mockar num teste sem tocar no client real nem
// em mock.module().
// ------------------------------------------------------------------

type CacheSelectBuilder = {
  eq(column: string, value: unknown): CacheSelectBuilder;
  maybeSingle(): Promise<{
    data: { storage_path: string } | null;
    error: { message: string } | null;
  }>;
};

export type VehicleImageAdminClient = {
  from(table: "vehicle_image_cache"): {
    select(columns: string): CacheSelectBuilder;
    upsert(
      row: NormalizedVehicleImageKey & { storage_path: string },
      opts: { onConflict: string; ignoreDuplicates: boolean },
    ): Promise<{ error: { message: string } | null }>;
  };
  from(table: "veiculos"): {
    update(row: { foto_url: string }): {
      eq(column: string, value: unknown): Promise<{ error: { message: string } | null }>;
    };
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        bytes: Uint8Array,
        opts: { contentType: string; upsert: boolean },
      ): Promise<{ error: { message: string } | null }>;
      createSignedUrl(
        path: string,
        expiresInSeconds: number,
      ): Promise<{ data: { signedUrl: string } | null }>;
    };
  };
};

const VEHICLE_PHOTOS_BUCKET = "vehicle-photos";
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 anos, inalterado.
const CACHE_CONFLICT_TARGET = "marca_norm,modelo_norm,ano_norm,cor_norm";

// Fail-safe: qualquer erro na consulta ao cache (rede, tabela indisponível,
// etc.) devolve null — o caller trata null exatamente como "cache miss" e
// segue o fluxo antigo (gera via IA). Uma falha nesta otimização NUNCA
// trava o cadastro do veículo.
async function lookupVehicleImageCache(
  client: VehicleImageAdminClient,
  key: NormalizedVehicleImageKey,
): Promise<{ storage_path: string } | null> {
  try {
    const res = await client
      .from("vehicle_image_cache")
      .select("storage_path")
      .eq("marca_norm", key.marca_norm)
      .eq("modelo_norm", key.modelo_norm)
      .eq("ano_norm", key.ano_norm)
      .eq("cor_norm", key.cor_norm)
      .maybeSingle();
    if (res.error) return null;
    return res.data;
  } catch {
    return null;
  }
}

async function createVehicleImageSignedUrl(
  client: VehicleImageAdminClient,
  storagePath: string,
): Promise<string | null> {
  const signed = await client.storage
    .from(VEHICLE_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  return signed.data?.signedUrl ?? null;
}

// Best-effort: se salvar foto_url falhar, não bloqueia a resposta — o
// caller (src/routes/app.tsx) já faz o mesmo update do lado cliente logo
// após receber { ok: true, url }, então essa escrita aqui é uma
// conveniência (deixa o veículo já com a foto certa mesmo se o cliente
// não completar o update por algum motivo), não uma dependência crítica.
async function saveVehicleFotoUrl(
  client: VehicleImageAdminClient,
  vehicleId: string,
  url: string,
): Promise<void> {
  try {
    await client.from("veiculos").update({ foto_url: url }).eq("id", vehicleId);
  } catch {
    // Intencionalmente ignorado — ver comentário acima.
  }
}

export type GenerateVehicleImageInput = {
  vehicleId: string;
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
};

export type GenerateVehicleImageDeps = {
  client: VehicleImageAdminClient;
  fetchImpl: typeof fetch;
};

export type GenerateVehicleImageResult =
  | { ok: true; url: string }
  | { ok: false; url: null };

// Lógica completa (cache + geração via IA), extraída do .handler() do
// createServerFn em vehicle-image.functions.ts pra ficar testável sem
// precisar subir o runtime do TanStack Start e sem depender de
// supabaseAdmin (que só existe em client.server.ts) — nenhum precedente
// de teste foi encontrado pra nenhum *.functions.ts em src/lib
// (confirmado por busca exaustiva antes de escrever isto), então esta é
// a abordagem mais simples e consistente com o padrão já comprovado em
// supabase/functions/_shared/whatsapp/orchestrator/ (client estrutural
// injetado, sem mock.module). Este arquivo não importa
// "@tanstack/react-start" nem "@/integrations/supabase/client.server" de
// propósito — mantém a lógica pura testável isolada do resto do módulo.
export async function runGenerateVehicleImage(
  input: GenerateVehicleImageInput,
  deps: GenerateVehicleImageDeps,
): Promise<GenerateVehicleImageResult> {
  const { client, fetchImpl } = deps;
  const key = normalizeVehicleImageKey(input);

  const cached = await lookupVehicleImageCache(client, key);
  if (cached) {
    const url = await createVehicleImageSignedUrl(client, cached.storage_path);
    if (!url) return { ok: false, url: null };
    await saveVehicleFotoUrl(client, input.vehicleId, url);
    return { ok: true, url };
  }

  // Fallback inteligente:
  // 1) Se OPENAI_API_KEY existir -> chama diretamente a OpenAI (independência total).
  // 2) Caso contrário -> usa o Lovable AI Gateway com a LOVABLE_API_KEY.
  const openaiKey = process.env.OPENAI_API_KEY;
  const lovableKey = process.env.LOVABLE_API_KEY;

  const useOpenAI = Boolean(openaiKey);
  const endpoint = useOpenAI
    ? "https://api.openai.com/v1/images/generations"
    : "https://ai.gateway.lovable.dev/v1/images/generations";
  const authKey = useOpenAI ? openaiKey : lovableKey;
  if (!authKey) return { ok: false, url: null };

  // Mesmo modelo (gpt-image-2) e parâmetros idênticos nos dois caminhos
  // para garantir o "Padrão Ouro" visual.
  const model = useOpenAI ? "gpt-image-2" : "openai/gpt-image-2";

  const prompt = `A highly detailed, realistic automotive studio photography of a ${input.cor} ${input.ano} ${input.marca} ${input.modelo}. 45-degree front-three-quarter angle. Isolated on a PURE PITCH BLACK background (#000000). No floor, no shadows, no white lights on the background, strictly pure black background. Photorealistic, 8k.`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 60_000);
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        size: "1024x1024",
        quality: "low",
        n: 1,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return { ok: false, url: null };
    const json: any = await res.json().catch(() => null);
    const b64: string | undefined = json?.data?.[0]?.b64_json;
    if (!b64) return { ok: false, url: null };

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = buildVehicleImageCachePath(key);

    const up = await client.storage.from(VEHICLE_PHOTOS_BUCKET).upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (up.error) return { ok: false, url: null };

    // INSERT ... ON CONFLICT DO NOTHING (via upsert + ignoreDuplicates):
    // fail-safe — se isto falhar, seguimos com o nosso próprio path (pior
    // caso: outro cadastro concorrente da MESMA combinação não vai achar
    // esta linha no cache e vai gerar a dele próprio; não trava nada).
    try {
      await client
        .from("vehicle_image_cache")
        .upsert(
          { ...key, storage_path: path },
          { onConflict: CACHE_CONFLICT_TARGET, ignoreDuplicates: true },
        );
    } catch {
      // Intencionalmente ignorado — ver comentário acima.
    }

    // Corrida: entre a nossa consulta inicial (cache miss) e este insert,
    // outro cadastro da MESMA combinação pode ter vencido. Reconsulta o
    // cache pela chave — se o storage_path registrado for diferente do
    // nosso (path), o vencedor da corrida é quem vale: usamos o path dele
    // pra gerar a signed URL final. O nosso upload recém-feito fica órfão
    // (aceitável — não construímos lock distribuído pra isso). Se essa
    // reconsulta falhar, degradamos pro nosso próprio path (fail-safe,
    // nunca trava o cadastro).
    const winner = await lookupVehicleImageCache(client, key);
    const finalPath = winner?.storage_path ?? path;

    const url = await createVehicleImageSignedUrl(client, finalPath);
    if (!url) return { ok: false, url: null };

    await saveVehicleFotoUrl(client, input.vehicleId, url);
    return { ok: true, url };
  } catch {
    return { ok: false, url: null };
  }
}
