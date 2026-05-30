// Captura/persiste o código de indicação do padrinho (?ref=XXXXXXXX)
// para usar no cadastro e definir o preço de ativação dinâmico.
import { supabase } from "@/integrations/supabase/client";

const KEY = "jarvys_ref";

export function captureRefFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const ref = url.searchParams.get("ref");
  if (ref && /^[a-z0-9-]{4,}$/i.test(ref)) {
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
 * Resolve um código curto (8 chars do uuid) para o id completo do perfil padrinho.
 * Retorna null quando ninguém é encontrado.
 */
export async function resolveReferrerId(refCode: string): Promise<string | null> {
  const code = refCode.trim().toLowerCase();
  if (!code) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .ilike("id", `${code}%`)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.id;
}
