import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  resolveVehicleTechnicalProfile,
  type JarvysTechnicalProfileConfidence,
  type JarvysTechnicalProfileSource,
  type ResolvedVehicleTechnicalProfile,
  type VehicleMaintenanceCorpusProfile,
} from "@/lib/vehicle-technical-profile";
import {
  buildAiPrompt,
  validateAiResolvedTechnicalProfile,
  type AiTechnicalProfileInput,
} from "@/lib/vehicle-technical-profile-ai";
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

// ─────────────────────────────────────────────────────────────
// IA fallback (server-side) — chama Lovable AI Gateway.
// Retorna ResolvedVehicleTechnicalProfile pronto se IA validar,
// ou null para o chamador manter o resultado local (low).
// ─────────────────────────────────────────────────────────────

async function tryResolveWithAi(
  aiInput: AiTechnicalProfileInput,
): Promise<ResolvedVehicleTechnicalProfile | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.warn(
      "[JarvysTechnicalProfile:ai] LOVABLE_API_KEY ausente — pulando IA.",
    );
    return null;
  }

  const { system, user } = buildAiPrompt(aiInput);

  try {
    const resp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.warn(
        "[JarvysTechnicalProfile:ai] gateway error",
        resp.status,
        t,
      );
      return null;
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.warn("[JarvysTechnicalProfile:ai] resposta vazia");
      return null;
    }

    const validated = validateAiResolvedTechnicalProfile(content);
    if (!validated.ok) {
      console.warn(
        "[JarvysTechnicalProfile:ai] resposta inválida:",
        validated.reason,
      );
      return null;
    }

    if (validated.confidence !== "medium") {
      // IA declarou low — não persistimos como ia_resolvida.
      console.warn(
        "[JarvysTechnicalProfile:ai] IA retornou confidence=low; mantendo fallback local.",
        validated.warnings,
      );
      return null;
    }

    return {
      profile: validated.profile,
      confidence: "medium",
      source: "ia_resolvida",
      reasons: [
        "Perfil técnico resolvido por IA a partir dos dados FIPE/modelo.",
        ...validated.evidence,
        ...validated.warnings.map((w) => `Aviso IA: ${w}`),
      ],
      missingFields: [],
      canUseFullSchedule: true,
      shouldBlockSensitiveShoppingLinks: true,
    };
  } catch (err) {
    console.warn("[JarvysTechnicalProfile:ai] exceção na chamada IA", err);
    return null;
  }
}

function hasMinimumDataForAi(v: {
  marca?: string | null;
  modelo?: string | null;
  modelo_fipe?: string | null;
  ano?: number | null;
  ano_modelo?: number | null;
  combustivel_fipe?: string | null;
}): boolean {
  const brandOrModel = Boolean(
    (v.marca && v.marca.trim()) || (v.modelo && v.modelo.trim()),
  );
  const modelIdentity = Boolean(
    (v.modelo_fipe && v.modelo_fipe.trim()) ||
      (v.modelo && v.modelo.trim()),
  );
  const year = Boolean(
    (typeof v.ano === "number" && v.ano > 0) ||
      (typeof v.ano_modelo === "number" && v.ano_modelo > 0),
  );
  const fuelHint = Boolean(
    (v.combustivel_fipe && v.combustivel_fipe.trim()) ||
      (v.modelo_fipe && v.modelo_fipe.trim()),
  );
  return brandOrModel && modelIdentity && year && fuelHint;
}

/**
 * Resolve e persiste o perfil técnico Jarvys de um veículo do usuário
 * autenticado. Orquestra: auth → leitura → helper puro → IA fallback → update.
 *
 * A IA classifica APENAS o perfil técnico (fuelKind, timingSystem,
 * transmissionKind, steeringKind). NUNCA gera cronograma, peças, intervalos
 * ou links. O cronograma continua 100% determinístico pelo motor Jarvys.
 *
 * Segurança:
 * - Exige usuário autenticado via `requireSupabaseAuth`.
 * - Leitura via `context.supabase` (RLS aplicado).
 * - Update via `supabaseAdmin` sempre filtrando por `id + user_id`.
 * - Falha da IA nunca bloqueia o cadastro.
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

        // 3) Resolução pura (helper 6.50A/6.50D).
        let resolved: ResolvedVehicleTechnicalProfile =
          resolveVehicleTechnicalProfile({
            combustivelFipe: vehicle.combustivel_fipe,
            vehicleSignature: vehicle.vehicle_signature,
            corpusProfile,
          });

        // 4) IA fallback quando resolução local não é suficiente.
        if (!resolved.canUseFullSchedule) {
          const aiInput: AiTechnicalProfileInput = {
            marca: vehicle.marca,
            modelo: vehicle.modelo,
            modelo_fipe: vehicle.modelo_fipe,
            ano: vehicle.ano,
            ano_modelo: vehicle.ano_modelo,
            combustivel_fipe: vehicle.combustivel_fipe,
            motorizacao: vehicle.motorizacao,
            cilindradas: vehicle.cilindradas,
            codigo_fipe: null,
            codigo_marca: vehicle.codigo_marca,
            codigo_modelo: vehicle.codigo_modelo,
            vehicle_signature: vehicle.vehicle_signature,
          };

          if (hasMinimumDataForAi(aiInput)) {
            const aiResolved = await tryResolveWithAi(aiInput);
            if (aiResolved) {
              resolved = aiResolved;
            }
          } else {
            extraReasons.push(
              "Dados FIPE/modelo insuficientes para IA classificar.",
            );
          }
        }

        // 5) Persistência: sempre grava confidence/source/updated_at, mesmo
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
