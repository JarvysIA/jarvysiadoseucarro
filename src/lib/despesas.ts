import { supabase } from "@/integrations/supabase/client";
import type { DespesaCategoria } from "@/lib/parse-receipt.functions";

export type { DespesaCategoria };

export const CATEGORIAS: DespesaCategoria[] = [
  "Revisão",
  "Manutenção",
  "Lavagem",
  "Combustível",
];

// Cores neon distintas por categoria (usadas no gráfico e badges)
export const CATEGORIA_COLOR: Record<DespesaCategoria, string> = {
  "Revisão": "#22ff88",        // Verde neon
  "Manutenção": "#ff3366",     // Vermelho neon
  "Lavagem": "#38bdf8",        // Azul neon
  "Combustível": "#facc15",    // Amarelo neon
};

export type Despesa = {
  id: string;
  user_id: string;
  vehicle_id: string;
  data: string;
  valor: number;
  categoria: DespesaCategoria;
  descricao: string;
  km_registro: number | null;
  receipt_image_url: string | null;
  created_at: string;
};

const RECEIPTS_BUCKET = "receipts";

/** Faz upload da imagem da nota e retorna o path no bucket (privado). */
export async function uploadReceiptImage(
  userId: string,
  vehicleId: string,
  file: File,
): Promise<string | null> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/${vehicleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (error) {
    console.error("[uploadReceiptImage]", error);
    return null;
  }
  return path;
}

/** Cria um URL temporário (signed) para exibir uma nota privada. */
export async function getReceiptSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .createSignedUrl(path, 60 * 60); // 1h
  if (error) {
    console.error("[getReceiptSignedUrl]", error);
    return null;
  }
  return data.signedUrl;
}

export function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}
