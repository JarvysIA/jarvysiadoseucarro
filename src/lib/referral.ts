// Captura/persiste o código de indicação do padrinho (?ref=XXXXXXXX)
// para usar no cadastro e definir o preço de ativação dinâmico.
import { supabase } from "@/integrations/supabase/client";

const KEY = "jarvys_ref";

export function captureRefFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const ref = url.searchParams.get("ref");
  // Aceita códigos amigáveis (NOME-JARVYS-1234) e legados (uuid curto)
  if (ref && /^[A-Za-z0-9-]{4,}$/.test(ref)) {
    sessionStorage.setItem(KEY, ref);
  }
}

export function getStoredRef(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URL(window.location.href).searchParams.get("ref");
  if (fromUrl) return fromUrl;
  return sessionStorage.getItem(KEY);
}

export function clearStoredRef() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}

/**
 * Resolve um código amigável de indicação (ex.: JOAO-JARVYS-1234) para o id
 * do perfil padrinho. Mantém compatibilidade com o formato antigo (8 chars do uuid).
 */
export async function resolveReferrerId(refCode: string): Promise<string | null> {
  const code = refCode.trim();
  if (!code) return null;

  // 1) Valida via RPC (SECURITY DEFINER, ignora RLS e é case-insensitive via ILIKE)
  const { data, error } = await supabase.rpc("validar_cupom_indicacao", { _codigo: code });
  if (!error && data) return data as unknown as string;

  // 2) Fallback legado: prefixo do uuid (apenas se RPC não encontrou)
  const legacy = code.toLowerCase();
  if (/^[a-f0-9-]{4,}$/i.test(legacy)) {
    const byUuid = await supabase
      .from("profiles")
      .select("id")
      .ilike("id", `${legacy}%`)
      .limit(1)
      .maybeSingle();
    if (byUuid.data?.id) return byUuid.data.id;
  }
  return null;
}

