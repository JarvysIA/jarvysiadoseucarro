import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";
import { safeParseMaintenancePlanJson } from "@/lib/maintenance-plan-validation";

const FORBIDDEN_KEYS = [
  "placa",
  "user_id",
  "vehicle_id",
  "chassi",
  "numero_motor",
  "cpf",
  "documento",
  "email",
  "whatsapp",
  "telefone",
  "nome",
];

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const optionalNullableString = z.preprocess(
  emptyToNull,
  z.string().trim().nullable().optional(),
);

const optionalNullableInt = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.number().int().nullable().optional(),
);

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const maintenancePlanJsonField = z
  .unknown()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null) return null;

    if (typeof value !== "object" || Array.isArray(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maintenance_plan_json inválido.",
      });
      return z.NEVER;
    }

    const result = safeParseMaintenancePlanJson(value);

    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maintenance_plan_json inválido.",
        params: { issues: result.error.issues.slice(0, 5) },
      });
      return z.NEVER;
    }

    return result.data;
  });

const payloadSchema = z
  .object({
    signature: z.string().trim().min(1, "signature obrigatória"),
    maintenance_family: optionalNullableString,
    marca: optionalNullableString,
    modelo_fipe: optionalNullableString,
    versao: optionalNullableString,
    ano_modelo: optionalNullableInt,
    combustivel: optionalNullableString,
    cilindradas: optionalNullableInt,
    valvulas: optionalNullableInt,
    motor_textual: optionalNullableString,
    transmissao: optionalNullableString,
    sistema_distribuicao: z
      .enum(["correia_dentada", "corrente", "correia_banhada", "desconhecido"])
      .default("desconhecido"),
    maintenance_plan_json: maintenancePlanJsonField,
    parts_profile_json: jsonValueSchema.nullable().optional(),
    source: z
      .enum(["manual", "ia", "fornecedor", "catalogo", "curadoria"])
      .default("manual"),
    confidence: z.number().int().min(0).max(100).default(0),
    reviewed_by_admin: z.boolean().default(false),
  })
  .strict();

export type UpsertMaintenanceProfileInput = z.input<typeof payloadSchema>;

async function assertSuperAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error("Falha ao verificar permissões.");
  if (!data?.is_super_admin) throw new Error("Acesso negado.");
}

function assertSerializable(value: unknown, field: string) {
  if (value === null || value === undefined) return;
  try {
    JSON.stringify(value);
  } catch {
    throw new Error(`Campo ${field} não é serializável como JSON.`);
  }
}

function assertNoForbiddenKeys(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const keys = Object.keys(raw as Record<string, unknown>).map((k) =>
    k.toLowerCase(),
  );
  const bad = keys.filter((k) => FORBIDDEN_KEYS.includes(k));
  if (bad.length > 0) {
    throw new Error(
      `Campos não permitidos no payload: ${bad.join(", ")}.`,
    );
  }
}

export const upsertMaintenanceProfileFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    assertNoForbiddenKeys(input);
    const parsed = payloadSchema.parse(input);
    assertSerializable(parsed.parts_profile_json, "parts_profile_json");
    const hasMaintenancePlanKey =
      !!input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      "maintenance_plan_json" in (input as Record<string, unknown>);
    return { parsed, hasMaintenancePlanKey };
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const { parsed, hasMaintenancePlanKey } = data;

    type ProfileInsert =
      Database["public"]["Tables"]["vehicle_maintenance_profiles"]["Insert"];

    const upsertPayload: ProfileInsert = {
      signature: parsed.signature,
      maintenance_family: parsed.maintenance_family ?? null,
      marca: parsed.marca ?? null,
      modelo_fipe: parsed.modelo_fipe ?? null,
      versao: parsed.versao ?? null,
      ano_modelo: parsed.ano_modelo ?? null,
      combustivel: parsed.combustivel ?? null,
      cilindradas: parsed.cilindradas ?? null,
      valvulas: parsed.valvulas ?? null,
      motor_textual: parsed.motor_textual ?? null,
      transmissao: parsed.transmissao ?? null,
      sistema_distribuicao: parsed.sistema_distribuicao,
      parts_profile_json: (parsed.parts_profile_json ?? null) as Json | null,
      source: parsed.source,
      confidence: parsed.confidence,
      reviewed_by_admin: parsed.reviewed_by_admin,
    };

    // Apenas inclui maintenance_plan_json no upsert se a chave estiver presente
    // no input. Omitir a chave preserva o plano existente em upserts parciais.
    if (hasMaintenancePlanKey) {
      upsertPayload.maintenance_plan_json =
        (parsed.maintenance_plan_json ?? null) as Json | null;
    }

    const { data: profile, error } = await supabaseAdmin
      .from("vehicle_maintenance_profiles")
      .upsert(upsertPayload, { onConflict: "signature" })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return { profile };
  });

const getBySignatureSchema = z
  .object({
    signature: z.string().trim().min(1, "signature obrigatória"),
  })
  .strict();

type MaintenanceProfileRow = Database["public"]["Tables"]["vehicle_maintenance_profiles"]["Row"];

export const getMaintenanceProfileBySignatureFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => getBySignatureSchema.parse(input))
  .handler(async ({ context, data }): Promise<{ profile: MaintenanceProfileRow | null }> => {
    const { data: profile, error } = await context.supabase
      .from("vehicle_maintenance_profiles")
      .select("*")
      .eq("signature", data.signature)
      .maybeSingle();

    if (error) throw new Error(error.message);

    return { profile: (profile as MaintenanceProfileRow | null) ?? null };
  });
