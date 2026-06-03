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

// Dispara o webhook de boas-vindas. Falhas não devem bloquear o fluxo do usuário.
export async function fireWelcomeWebhook(payload: WelcomePayload): Promise<void> {
  try {
    await fetch(WELCOME_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "user.welcome", ...payload }),
      keepalive: true,
    });
  } catch (err) {
    console.warn("[welcome-webhook] falhou (não-bloqueante):", err);
  }
}
