import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Gera a foto do veículo via Lovable AI Gateway (gpt-image-2), faz upload
 * para o bucket privado "vehicle-photos" e devolve uma URL assinada de longa
 * duração. A URL é persistida em `veiculos.foto_url`, então cada veículo só
 * é gerado UMA vez.
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
      return { ok: false as const, url: null };
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
    if (!authKey) return { ok: false as const, url: null };

    // Mesmo modelo (gpt-image-2) e parâmetros idênticos nos dois caminhos
    // para garantir o "Padrão Ouro" visual.
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

      if (!res.ok) return { ok: false as const, url: null };
      const json: any = await res.json().catch(() => null);
      const b64: string | undefined = json?.data?.[0]?.b64_json;
      if (!b64) return { ok: false as const, url: null };

      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const path = `${vehicleId}.png`;

      const up = await supabaseAdmin.storage
        .from("vehicle-photos")
        .upload(path, bytes, {
          contentType: "image/png",
          upsert: true,
        });
      if (up.error) return { ok: false as const, url: null };

      // 10 anos — URL praticamente perene; é cacheada em veiculos.foto_url.
      const signed = await supabaseAdmin.storage
        .from("vehicle-photos")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      const url = signed.data?.signedUrl;
      if (!url) return { ok: false as const, url: null };

      return { ok: true as const, url };
    } catch {
      return { ok: false as const, url: null };
    }
  });
