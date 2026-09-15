import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  runGenerateVehicleImage,
  type VehicleImageAdminClient,
} from "@/lib/vehicle-image-cache";

/**
 * Gera a foto do veículo via Lovable AI Gateway (gpt-image-2), faz upload
 * para o bucket privado "vehicle-photos" e devolve uma URL assinada de longa
 * duração. A URL é persistida em `veiculos.foto_url`, então cada veículo só
 * é gerado UMA vez.
 *
 * Build 8.4: exige JWT Supabase e valida ownership do veículo antes de
 * qualquer chamada IA, upload ou geração de signed URL.
 *
 * Build Vehicle-Image-Cache: antes de chamar a IA, reaproveita uma foto já
 * gerada pra mesma combinação marca+modelo+ano+cor (vehicle_image_cache) —
 * ver runGenerateVehicleImage em src/lib/vehicle-image-cache.ts.
 *
 * Fix-Vehicle-Image-Input-Validation (achado A1): marca/modelo/ano/cor
 * vêm SEMPRE da própria linha de veiculos (mesma query de ownership), não
 * mais do input do client — o único call-site real (VehicleImage em
 * app.tsx) já renderiza a partir de um veículo lido do banco, então não
 * existe caso legítimo de divergência. Evita prompt injection em "cor",
 * poluição do vehicle_image_cache com combinações fabricadas e geração de
 * imagem arbitrária às custas da conta de IA associada a um vehicleId real.
 */
export const generateVehicleImageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { vehicleId: string }) => data)
  .handler(async ({ data, context }) => {
    const vehicleId = data.vehicleId;
    if (!vehicleId) {
      return { ok: false as const, url: null };
    }

    // Ownership + atributos reais: só o dono pode gerar/sobrescrever a
    // foto do veículo, e marca/modelo/ano/cor vêm sempre do banco.
    const { data: veic, error: vErr } = await context.supabase
      .from("veiculos")
      .select("id, user_id, marca, modelo, ano, cor")
      .eq("id", vehicleId)
      .maybeSingle();
    if (vErr || !veic || veic.user_id !== context.userId) {
      return { ok: false as const, url: null };
    }

    const marca = (veic.marca || "").trim();
    const modelo = (veic.modelo || "").trim();
    const ano = (veic.ano || "").trim();
    const cor = (veic.cor || "").trim();

    if (!marca && !modelo) {
      return { ok: false as const, url: null };
    }

    return runGenerateVehicleImage(
      { vehicleId, marca, modelo, ano, cor },
      { client: supabaseAdmin as unknown as VehicleImageAdminClient, fetchImpl: fetch },
    );
  });
