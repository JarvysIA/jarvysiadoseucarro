// Normaliza um telefone brasileiro para o formato E.164 (+55DDDNNNNNNNNN)
export function normalizePhoneBR(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  return `+55${digits}`;
}

// URL fictícia da automação de boas-vindas (e-mail + WhatsApp).
// Substitua pela URL real quando a automação estiver pronta.
const WELCOME_WEBHOOK_URL = "https://jarvys.com.br/api/welcome-webhook";

export type WelcomePayload = {
  user_id: string;
  nome: string;
  email: string;
  whatsapp: string; // E.164
  placa: string;
  marca?: string;
  modelo?: string;
  ano?: string;
  cor?: string;
};

// Welcome webhook desativado temporariamente até o domínio ser publicado.
// Futura implementação deve ser server-side com requireSupabaseAuth + HMAC WELCOME_WEBHOOK_SECRET.
export async function fireWelcomeWebhook(payload: WelcomePayload): Promise<{ ok: false; skipped: true; reason: string }> {
  // Evita chamada client-side insegura para domínio ainda não publicado.
  return { ok: false, skipped: true, reason: "welcome_webhook_disabled_until_publish" };
}
