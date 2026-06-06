import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Gera (ou recicla via Global Image Cache) a foto do veículo.
 *
 * Fluxo blindado:
 * 1. Cache lookup no banco (marca/modelo/ano/cor, case-insensitive).
 * 2. Cache miss -> chama a IA pedindo URL (response_format: "url").
 * 3. Faz fetch da URL temporária da OpenAI -> converte para Blob.
 * 4. Upload via `supabaseAdmin` (Service Role, ignora RLS) para o bucket
 *    `vehicle-images` com { upsert: true, contentType: "image/png" }.
 * 5. Se QUALQUER passo de download/upload falhar, salva a URL temporária
 *    da OpenAI direto no banco como fallback de emergência.
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

    // --- 1) GLOBAL CACHE LOOKUP --------------------------------------------
    try {
      const { data: hit } = await supabaseAdmin
        .from("veiculos")
        .select("image_url")
        .ilike("marca", marca)
        .ilike("modelo", modelo)
        .ilike("ano", ano)
        .ilike("cor", cor)
        .not("image_url", "is", null)
        .limit(1)
        .maybeSingle();
      if (hit?.image_url) {
        await persist(hit.image_url);
        return { ok: true as const, url: hit.image_url, cached: true as const };
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
      if (!aiImageUrl && !aiImageB64) {
        console.error("[vehicle-image] AI response missing url and b64_json");
        return { ok: false as const, url: null, cached: false as const };
      }
    } catch (e) {
      console.error("[vehicle-image] AI gen exception:", e);
      return { ok: false as const, url: null, cached: false as const };
    }

    // --- 3+4) DOWNLOAD DA IA -> UPLOAD PRO COFRE (com fallback) -----------
    const slug = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "x";

    try {
      let blob: Blob;
      let contentType = "image/png";

      if (aiImageUrl) {
        // Fetch da URL temporária da OpenAI -> Blob
        const imgRes = await fetch(aiImageUrl);
        if (!imgRes.ok) {
          throw new Error(`Failed to fetch AI image: ${imgRes.status}`);
        }
        blob = await imgRes.blob();
        contentType = blob.type || "image/png";
      } else {
        // Fallback: API retornou só b64_json
        const bytes = Uint8Array.from(atob(aiImageB64!), (c) => c.charCodeAt(0));
        blob = new Blob([bytes], { type: "image/png" });
      }

      const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
      const fileName = `${slug(marca)}_${slug(modelo)}_${slug(ano)}_${slug(cor)}_${Date.now()}.${ext}`;

      // Upload via SERVICE ROLE (ignora RLS)
      const { error: upErr } = await supabaseAdmin.storage
        .from("vehicle-images")
        .upload(fileName, blob, {
          upsert: true,
          contentType,
          cacheControl: "31536000",
        });
      if (upErr) throw upErr;

      const { data: pub } = supabaseAdmin.storage
        .from("vehicle-images")
        .getPublicUrl(fileName);
      const url = pub?.publicUrl;
      if (!url) throw new Error("Failed to get public URL after upload");

      await persist(url);
      return { ok: true as const, url, cached: false as const };
    } catch (e) {
      // --- FALLBACK DE EMERGÊNCIA -----------------------------------------
      console.error("[vehicle-image] Storage upload failed, falling back to AI URL:", e);
      if (aiImageUrl) {
        await persist(aiImageUrl);
        return { ok: true as const, url: aiImageUrl, cached: false as const };
      }
      return { ok: false as const, url: null, cached: false as const };
    }
  });
