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
 */
export const generateVehicleImageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      vehicleId: string;
      marca: string;
      modelo: string;
      ano: string;
      cor: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const marca = (data.marca || "").trim();
    const modelo = (data.modelo || "").trim();
    const ano = (data.ano || "").trim();
    const cor = (data.cor || "").trim();
    const vehicleId = data.vehicleId;

    if (!vehicleId || (!marca && !modelo)) {
      return { ok: false as const, url: null };
    }

    // Ownership: só o dono pode gerar/sobrescrever a foto do veículo.
    const { data: veic, error: vErr } = await context.supabase
      .from("veiculos")
      .select("id, user_id")
      .eq("id", vehicleId)
      .maybeSingle();
    if (vErr || !veic || veic.user_id !== context.userId) {
      return { ok: false as const, url: null };
    }

    return runGenerateVehicleImage(
      { vehicleId, marca, modelo, ano, cor },
      { client: supabaseAdmin as unknown as VehicleImageAdminClient, fetchImpl: fetch },
    );
  });
