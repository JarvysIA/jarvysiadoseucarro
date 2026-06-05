import { createServerFn } from "@tanstack/react-start";

const AUTODEV_KEY = "sk_ad_joRQQzZF8LLZuS5GMgTkgFAh";

/**
 * Busca a foto principal (retail[0]) do veículo na API auto.dev usando o VIN.
 * Retorna { ok:true, url } ou { ok:false } para o front cair no fallback.
 */
export const fetchAutoDevImageFn = createServerFn({ method: "POST" })
  .inputValidator((data: { vin: string }) => data)
  .handler(async ({ data }) => {
    const vin = (data.vin || "").trim().toUpperCase();
    if (!vin || vin.length < 11) {
      return { ok: false as const, url: null };
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`https://api.auto.dev/photos/${encodeURIComponent(vin)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${AUTODEV_KEY}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return { ok: false as const, url: null };

      const json: any = await res.json().catch(() => null);
      const retail = json?.data?.retail;
      if (!Array.isArray(retail) || retail.length === 0) {
        return { ok: false as const, url: null };
      }
      const first = retail[0];
      const url: string | null =
        typeof first === "string"
          ? first
          : first?.url || first?.src || first?.image || first?.href || null;
      if (!url) return { ok: false as const, url: null };
      return { ok: true as const, url };
    } catch {
      return { ok: false as const, url: null };
    }
  });
