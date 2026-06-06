import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Gera (ou recicla via Global Image Cache) a foto do veículo.
 *
 * Fluxo:
 * 1. Lookup no banco: existe algum veículo com a MESMA marca/modelo/ano/cor
 *    (case-insensitive) já com `image_url` salva? -> cache hit, reutiliza.
 * 2. Cache miss: chama OpenAI (ou Lovable AI Gateway) -> baixa o buffer ->
 *    sobe para o bucket `vehicle-images` -> usa a URL pública permanente.
 * 3. Persiste a URL final em `veiculos.image_url` (e em `foto_url` para
 *    compatibilidade com leituras antigas).
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
      } catch {
        /* não bloqueia a UI */
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
    } catch {
      /* segue para gerar */
    }

    // --- 2) GERA VIA IA ----------------------------------------------------
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

      if (!res.ok) return { ok: false as const, url: null, cached: false as const };
      const json: any = await res.json().catch(() => null);
      const b64: string | undefined = json?.data?.[0]?.b64_json;
      if (!b64) return { ok: false as const, url: null, cached: false as const };

      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

      // --- 3) UPLOAD PARA O COFRE -----------------------------------------
      const slug = (s: string) =>
        s
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "x";
      const fileName = `${slug(marca)}_${slug(modelo)}_${slug(ano)}_${slug(cor)}_${Date.now()}.png`;

      const up = await supabaseAdmin.storage
        .from("vehicle-images")
        .upload(fileName, bytes, {
          contentType: "image/png",
          upsert: false,
          cacheControl: "31536000",
        });
      if (up.error) return { ok: false as const, url: null, cached: false as const };

      const { data: pub } = supabaseAdmin.storage
        .from("vehicle-images")
        .getPublicUrl(fileName);
      const url = pub?.publicUrl;
      if (!url) return { ok: false as const, url: null, cached: false as const };

      await persist(url);
      return { ok: true as const, url, cached: false as const };
    } catch {
      return { ok: false as const, url: null, cached: false as const };
    }
  });
