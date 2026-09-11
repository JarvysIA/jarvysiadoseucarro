// Plate-Api-Counter: registra cada chamada bem-sucedida às APIs externas de
// placa/FIPE. Fire-and-forget, nunca lança, nunca atrasa a resposta ao
// usuário — mesmo espírito de ai-usage-tracking.ts / audit-log.ts. Vive em
// _shared/ (fora de whatsapp/) seguindo o mesmo precedente de
// pagamento-pipeline.ts, já compartilhado entre edge functions não-WhatsApp.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type PlateApiCallType = "consultar_placa" | "consultar_historico_fipe";

export async function recordPlateApiCall(callType: PlateApiCallType): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      console.error("[plate-api-tracking] missing_env");
      return;
    }
    const client = createClient(url, key);
    const { error } = await client.from("plate_api_calls").insert({ call_type: callType });
    if (error) console.error("[plate-api-tracking] insert_error", error.message);
  } catch (e) {
    console.error("[plate-api-tracking] unexpected", e instanceof Error ? e.message : String(e));
  }
}
