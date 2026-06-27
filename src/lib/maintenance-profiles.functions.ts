import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json, Database } from "@/integrations/supabase/types";

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
    maintenance_plan_json: jsonValueSchema.nullable().optional(),
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
    assertSerializable(parsed.maintenance_plan_json, "maintenance_plan_json");
    assertSerializable(parsed.parts_profile_json, "parts_profile_json");
    return parsed;
  })
  .handler(async ({ context, data }) => {
    await assertSuperAdmin(context.userId);

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const upsertPayload = {
      signature: data.signature,
      maintenance_family: data.maintenance_family ?? null,
      marca: data.marca ?? null,
      modelo_fipe: data.modelo_fipe ?? null,
      versao: data.versao ?? null,
      ano_modelo: data.ano_modelo ?? null,
      combustivel: data.combustivel ?? null,
      cilindradas: data.cilindradas ?? null,
      valvulas: data.valvulas ?? null,
      motor_textual: data.motor_textual ?? null,
      transmissao: data.transmissao ?? null,
      sistema_distribuicao: data.sistema_distribuicao,
      maintenance_plan_json: (data.maintenance_plan_json ?? null) as Json | null,
      parts_profile_json: (data.parts_profile_json ?? null) as Json | null,
      source: data.source,
      confidence: data.confidence,
      reviewed_by_admin: data.reviewed_by_admin,
    };

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
