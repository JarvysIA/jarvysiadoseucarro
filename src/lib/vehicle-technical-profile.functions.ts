import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  resolveVehicleTechnicalProfile,
  type JarvysTechnicalProfileConfidence,
  type JarvysTechnicalProfileSource,
  type VehicleMaintenanceCorpusProfile,
} from "@/lib/vehicle-technical-profile";
import type { JarvysVehicleProfile } from "@/lib/maintenance-jarvys-schedule-rules";

export type ResolveAndSaveResultOk = {
  ok: true;
  vehicleId: string;
  profile: JarvysVehicleProfile | null;
  confidence: JarvysTechnicalProfileConfidence;
  source: JarvysTechnicalProfileSource;
  reasons: string[];
  missingFields: Array<
    "fuelKind" | "timingSystem" | "transmissionKind" | "steeringKind"
  >;
  canUseFullSchedule: boolean;
  shouldBlockSensitiveShoppingLinks: boolean;
};

export type ResolveAndSaveResultErr = {
  ok: false;
  error:
    | "unauthorized"
    | "vehicle_not_found"
    | "invalid_vehicle_id"
    | "update_failed"
    | "unexpected_error";
  message: string;
};

export type ResolveAndSaveVehicleTechnicalProfileResult =
  | ResolveAndSaveResultOk
  | ResolveAndSaveResultErr;

/**
 * Resolve e persiste o perfil técnico Jarvys de um veículo do usuário
 * autenticado. Orquestra apenas: auth → leitura → helper puro → update.
 * Regras de confidence/source vivem em `resolveVehicleTechnicalProfile`.
 *
 * Segurança:
 * - Exige usuário autenticado via `requireSupabaseAuth`.
 * - Leitura via `context.supabase` (RLS aplicado).
 * - Update via `supabaseAdmin` sempre filtrando por `id + user_id`.
 */
export const resolveAndSaveVehicleTechnicalProfileFn = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { vehicleId: string }) => {
    const vehicleId = z.string().uuid().parse(data?.vehicleId);
    return { vehicleId };
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<ResolveAndSaveVehicleTechnicalProfileResult> => {
      const { vehicleId } = data;
      const { supabase, userId } = context;

      try {
        // 1) Ownership check + leitura do DNA FIPE do veículo.
        const { data: vehicle, error: vehicleErr } = await supabase
          .from("veiculos")
          .select(
            "id,user_id,combustivel_fipe,vehicle_signature,modelo_fipe,ano_modelo,codigo_marca,codigo_modelo,cilindradas,marca,modelo,ano,motorizacao",
          )
          .eq("id", vehicleId)
          .eq("user_id", userId)
          .maybeSingle();

        if (vehicleErr) {
          console.error(
            "[resolveAndSaveVehicleTechnicalProfileFn] vehicle read error",
            vehicleErr,
          );
          return {
            ok: false,
            error: "vehicle_not_found",
            message: "Veículo não encontrado para o usuário autenticado.",
          };
        }
        if (!vehicle) {
          return {
            ok: false,
            error: "vehicle_not_found",
            message: "Veículo não encontrado para o usuário autenticado.",
          };
        }

        // 2) Busca do corpus técnico por signature (constraint única).
        let corpusProfile: VehicleMaintenanceCorpusProfile | null = null;
        const extraReasons: string[] = [];

        if (vehicle.vehicle_signature) {
          const { data: corpusRow, error: corpusErr } = await supabase
            .from("vehicle_maintenance_profiles")
            .select(
              "signature,combustivel,transmissao,sistema_distribuicao,confidence,reviewed_by_admin",
            )
            .eq("signature", vehicle.vehicle_signature)
            .maybeSingle();

          if (corpusErr) {
            console.error(
              "[resolveAndSaveVehicleTechnicalProfileFn] corpus read error",
              corpusErr,
            );
            extraReasons.push(
              "Falha na leitura do corpus técnico — usando fallback FIPE.",
            );
          } else if (corpusRow) {
            corpusProfile = {
              signature: corpusRow.signature,
              combustivel: corpusRow.combustivel,
              transmissao: corpusRow.transmissao,
              sistema_distribuicao: corpusRow.sistema_distribuicao,
              confidence: corpusRow.confidence as
                | string
                | number
                | null
                | undefined,
              reviewed_by_admin: corpusRow.reviewed_by_admin,
            };
          }
        }

        // 3) Resolução pura (helper 6.50A).
        const resolved = resolveVehicleTechnicalProfile({
          combustivelFipe: vehicle.combustivel_fipe,
          vehicleSignature: vehicle.vehicle_signature,
          corpusProfile,
        });

        // 4) Persistência: sempre grava confidence/source/updated_at, mesmo
        // com profile null (marca que o veículo já foi analisado).
        const updatePayload = {
          jarvys_technical_profile: resolved.profile as unknown as null,
          jarvys_technical_profile_confidence: resolved.confidence,
          jarvys_technical_profile_source: resolved.source,
          jarvys_technical_profile_updated_at: new Date().toISOString(),
        };

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { error: updateErr } = await supabaseAdmin
          .from("veiculos")
          .update(updatePayload)
          .eq("id", vehicleId)
          .eq("user_id", userId);

        if (updateErr) {
          console.error(
            "[resolveAndSaveVehicleTechnicalProfileFn] update error",
            updateErr,
          );
          return {
            ok: false,
            error: "update_failed",
            message:
              "Não foi possível salvar o perfil técnico Jarvys do veículo.",
          };
        }

        return {
          ok: true,
          vehicleId,
          profile: resolved.profile,
          confidence: resolved.confidence,
          source: resolved.source,
          reasons: [...resolved.reasons, ...extraReasons],
          missingFields: resolved.missingFields,
          canUseFullSchedule: resolved.canUseFullSchedule,
          shouldBlockSensitiveShoppingLinks:
            resolved.shouldBlockSensitiveShoppingLinks,
        };
      } catch (err) {
        console.error(
          "[resolveAndSaveVehicleTechnicalProfileFn] unexpected error",
          err,
        );
        return {
          ok: false,
          error: "unexpected_error",
          message:
            "Erro inesperado ao resolver o perfil técnico Jarvys do veículo.",
        };
      }
    },
  );
