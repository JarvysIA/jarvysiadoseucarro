import { createServerFn } from "@tanstack/react-start";

const SERPER_API_KEY = "9bd3293a2fd97fac3aa62b1ed4a6b819f5894c14";

/**
 * Busca a foto do veículo via Serper.dev (Google Images).
 * Retorna { ok:true, url } ou { ok:false } para o front cair no fallback.
 */
export const fetchVehicleImageFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { marca: string; modelo: string; ano: string; cor: string }) => data,
  )
  .handler(async ({ data }) => {
    const marca = (data.marca || "").trim();
    const modelo = (data.modelo || "").trim();
    const ano = (data.ano || "").trim();
    const cor = (data.cor || "").trim();

    if (!marca && !modelo) {
      return { ok: false as const, url: null };
    }

    const q = `${marca} ${modelo} ${ano} ${cor} carro png fundo transparente ou branco -loja -mercado -olx -anuncio`
      .replace(/\s+/g, " ")
      .trim();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q, gl: "br", hl: "pt" }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return { ok: false as const, url: null };

      const json: any = await res.json().catch(() => null);
      const images = json?.images;
      if (!Array.isArray(images) || images.length === 0) {
        return { ok: false as const, url: null };
      }
      const first = images.find((i: any) => i?.imageUrl) ?? images[0];
      const url: string | null = first?.imageUrl || null;
      if (!url) return { ok: false as const, url: null };
      return { ok: true as const, url };
    } catch {
      return { ok: false as const, url: null };
    }
  });
