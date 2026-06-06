import { createServerFn } from "@tanstack/react-start";

/**
 * Gera (ou recicla via Global Image Cache) a foto do veículo.
 *
 * Fluxo blindado:
 * 1. Cache lookup no banco (marca/modelo/ano/cor, case-insensitive).
 * 2. Cache miss -> chama a IA pedindo URL (response_format: "url").
 * 3. Faz fetch da URL temporária da OpenAI -> converte para bytea.
 * 4. Salva o binário em `vehicle_images_blob`, sem usar Storage API.
 * 5. Persiste `/api/vehicle-image/{vehicleId}` em image_url/foto_url.
 */
export const generateVehicleImageFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      vehicleId: string;
      marca: string;
      modelo: string;
      ano: string;
      cor: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const marca = (data.marca || "").trim();
    const modelo = (data.modelo || "").trim();
    const ano = (data.ano || "").trim();
    const cor = (data.cor || "").trim();
    const vehicleId = data.vehicleId;

    if (!vehicleId || (!marca && !modelo)) {
      return { ok: false as const, url: null, cached: false as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const internalImageUrl = `/api/vehicle-image/${vehicleId}`;

    const persist = async (url: string) => {
      try {
        await supabaseAdmin
          .from("veiculos")
          .update({ image_url: url, foto_url: url })
          .eq("id", vehicleId);
      } catch (e) {
        console.error("[vehicle-image] persist failed:", e);
      }
    };

    const bytesToByteaHex = (bytes: Uint8Array) =>
      `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

    const saveBlob = async (bytes: Uint8Array) => {
      const db = supabaseAdmin as any;
      const { error } = await db.from("vehicle_images_blob").upsert(
        {
          vehicle_id: vehicleId,
          image_data: bytesToByteaHex(bytes),
        },
        { onConflict: "vehicle_id" },
      );
      if (error) throw error;
    };

    // --- 1) GLOBAL CACHE LOOKUP --------------------------------------------
    try {
      const { data: hit } = await supabaseAdmin
        .from("veiculos")
        .select("id,image_url")
        .ilike("marca", marca)
        .ilike("modelo", modelo)
        .ilike("ano", ano)
        .ilike("cor", cor)
        .like("image_url", "/api/vehicle-image/%")
        .neq("id", vehicleId)
        .limit(1)
        .maybeSingle();
      if (hit?.id && hit.image_url) {
        const db = supabaseAdmin as any;
        const { data: blobHit, error: blobError } = await db
          .from("vehicle_images_blob")
          .select("image_data")
          .eq("vehicle_id", hit.id)
          .maybeSingle();
        if (blobError) throw blobError;
        if (blobHit?.image_data) {
          const { error: copyError } = await db.from("vehicle_images_blob").upsert(
            { vehicle_id: vehicleId, image_data: blobHit.image_data },
            { onConflict: "vehicle_id" },
          );
          if (copyError) throw copyError;
          await persist(internalImageUrl);
          return { ok: true as const, url: internalImageUrl, cached: true as const };
        }
      }
    } catch (e) {
      console.warn("[vehicle-image] cache lookup failed:", e);
    }

    // --- 2) GERA VIA IA (pedindo URL) --------------------------------------
    const openaiKey = process.env.OPENAI_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;
    const useOpenAI = Boolean(openaiKey);
    const endpoint = useOpenAI
      ? "https://api.openai.com/v1/images/generations"
      : "https://ai.gateway.lovable.dev/v1/images/generations";
    const authKey = useOpenAI ? openaiKey : lovableKey;
    if (!authKey) return { ok: false as const, url: null, cached: false as const };
    const model = useOpenAI ? "gpt-image-2" : "openai/gpt-image-2";

    const prompt = `A highly detailed, realistic automotive studio photography of a ${cor} ${ano} ${marca} ${modelo}. 45-degree front-three-quarter angle. Isolated on a PURE PITCH BLACK background (#000000). No floor, no shadows, no white lights on the background, strictly pure black background. Photorealistic, 8k.`;

    let aiImageUrl: string | null = null;
    let aiImageB64: string | null = null;

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 60_000);
      const res = await fetch(endpoint, {
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

      if (!res.ok) {
        console.error("[vehicle-image] AI gen failed:", res.status, await res.text().catch(() => ""));
        return { ok: false as const, url: null, cached: false as const };
      }
      const json: any = await res.json().catch(() => null);
      aiImageUrl = json?.data?.[0]?.url ?? null;
      aiImageB64 = json?.data?.[0]?.b64_json ?? null;
      console.log("[vehicle-image] AI response:", {
        status: res.status,
        hasUrl: Boolean(aiImageUrl),
        url: aiImageUrl,
        hasB64: Boolean(aiImageB64),
        firstItemKeys: json?.data?.[0] ? Object.keys(json.data[0]) : [],
      });
      if (!aiImageUrl && !aiImageB64) {
        console.error("[vehicle-image] AI response missing url and b64_json", json);
        return { ok: false as const, url: null, cached: false as const };
      }
    } catch (e) {
      console.error("[vehicle-image] AI gen exception:", e);
      return { ok: false as const, url: null, cached: false as const };
    }

    // --- 3+4) DOWNLOAD DA IA -> BYTEA NO BANCO ---------------------------
    try {
      let bytes: Uint8Array;

      if (aiImageUrl) {
        console.log("[vehicle-image] fetching AI image URL:", aiImageUrl);
        const imgRes = await fetch(aiImageUrl);
        console.log("[vehicle-image] AI image fetch result:", {
          url: aiImageUrl,
          status: imgRes.status,
          ok: imgRes.ok,
          contentType: imgRes.headers.get("content-type"),
          contentLength: imgRes.headers.get("content-length"),
        });
        if (!imgRes.ok) {
          const body = await imgRes.text().catch(() => "");
          throw new Error(`Failed to fetch AI image: ${imgRes.status} ${body.slice(0, 500)}`);
        }
        bytes = new Uint8Array(await imgRes.arrayBuffer());
      } else {
        bytes = Uint8Array.from(atob(aiImageB64!), (c) => c.charCodeAt(0));
      }

      if (!bytes.byteLength) throw new Error("AI image payload is empty");
      await saveBlob(bytes);
      await persist(internalImageUrl);
      return { ok: true as const, url: internalImageUrl, cached: false as const };
    } catch (e) {
      console.error("[vehicle-image] DB blob save failed:", { error: e, aiImageUrl });
      return { ok: false as const, url: null, cached: false as const };
    }
  });
