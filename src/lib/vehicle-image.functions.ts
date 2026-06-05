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

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { ok: false as const, url: null };

    const carro = [marca, modelo, ano, cor].filter(Boolean).join(" ");
    const prompt = `Studio product render of a ${carro}, perfect 3/4 front-three-quarter angle (45°), clean white seamless background, soft floor reflection, dramatic neon blue rim light, ultra-detailed automotive catalog photography, sharp focus, no text, no logos, no people, no plates, isolated subject, photoreal.`;

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 60_000);
      const res = await fetch(
        "https://ai.gateway.lovable.dev/v1/images/generations",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-image-2",
            prompt,
            size: "1024x1024",
            quality: "low",
            n: 1,
          }),
          signal: ctrl.signal,
        },
      );
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
