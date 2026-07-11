// Build 5.7D-EXEC — Componente reutilizável de vínculo WhatsApp.
// Encapsula todo o fluxo: solicitar código, aguardar, confirmar, sucesso.
// Sem side effects além de requestWhatsappLinkCodeFn / confirmWhatsappLinkCodeFn.
// Nunca loga code/telefone completo. Consentimento obrigatório.
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle, Check, ArrowLeft, RotateCcw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  requestWhatsappLinkCodeFn,
  confirmWhatsappLinkCodeFn,
  confirmWhatsappPhoneChangeFn,
} from "@/lib/whatsapp-link.functions";
import { normalizeBrazilPhoneToE164, isLikelyE164 } from "@/lib/whatsapp/phone";

export type WhatsappLinkSource = "onboarding" | "app_settings" | "change_number";

type Props = {
  source: WhatsappLinkSource;
  initialPhone?: string;
  allowSkip?: boolean;
  onLinked?: (result: { contactId?: string }) => void;
  onPhoneChanged?: (result: {
    newContactId: string;
    oldContactId: string;
    phoneMasked: string;
  }) => void;
  onSkip?: () => void;
  onCancel?: () => void;
};

type Phase =
  | "idle"
  | "requesting"
  | "awaiting_code"
  | "confirming"
  | "success"
  | "error";

const CONSENT_TEXT =
  "Aceito receber mensagens do Jarvys pelo WhatsApp sobre manutenção, revisão, despesas do meu veículo e recursos inteligentes do app.";

const COOLDOWN_SECONDS = 60;

const REQUEST_ERROR_COPY: Record<string, string> = {
  invalid_request: "Confira o número informado.",
  cooldown: "Aguarde antes de solicitar outro código.",
  rate_limited: "Muitas tentativas. Aguarde um pouco e tente novamente.",
  phone_conflict: "Este número já está vinculado a outra conta Jarvys.",
  user_has_other_active: "Você já tem outro número vinculado.",
  already_linked: "Este número já está vinculado à sua conta.",
  no_instance_available:
    "O WhatsApp Jarvys está temporariamente indisponível. Tente novamente em alguns minutos.",
  internal_error: "Não foi possível concluir agora. Tente novamente.",
};

const CONFIRM_ERROR_COPY: Record<string, string> = {
  invalid_or_expired: "Código inválido ou expirado. Solicite um novo código.",
  blocked: "Limite de tentativas atingido. Solicite um novo código.",
  phone_conflict: "Este número já está vinculado a outra conta Jarvys.",
  user_has_other_active: "Você já tem outro número vinculado.",
  no_instance_available:
    "O WhatsApp Jarvys está temporariamente indisponível. Tente novamente em alguns minutos.",
  internal_error: "Não foi possível concluir agora. Tente novamente.",
};

function formatBrPhoneInput(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function toDisplayFromStored(stored: string | undefined | null): string {
  if (!stored) return "";
  // aceita "+55DDNNNNNNNNN" ou string livre; extrai dígitos BR
  const digits = stored.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  return formatBrPhoneInput(local);
}

export function WhatsappLinkCard({
  source,
  initialPhone,
  allowSkip = false,
  onLinked,
  onSkip,
  onCancel,
}: Props) {
  const requestFn = useServerFn(requestWhatsappLinkCodeFn);
  const confirmFn = useServerFn(confirmWhatsappLinkCodeFn);

  const [phase, setPhase] = useState<Phase>("idle");
  const [phone, setPhone] = useState<string>(() => toDisplayFromStored(initialPhone));
  const [consent, setConsent] = useState<boolean>(false);
  const [code, setCode] = useState<string>("");
  const [verificationId, setVerificationId] = useState<string>("");
  const [phoneMasked, setPhoneMasked] = useState<string>("");
  const [cooldown, setCooldown] = useState<number>(0);
  const [expiresIn, setExpiresIn] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [contactId, setContactId] = useState<string>("");
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const phoneE164 = useMemo(() => normalizeBrazilPhoneToE164(phone), [phone]);
  const phoneValid = !!phoneE164 && isLikelyE164(phoneE164);

  // countdowns
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);
  useEffect(() => {
    if (expiresIn <= 0) return;
    const t = setInterval(() => setExpiresIn((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [expiresIn]);

  useEffect(() => {
    if (phase === "awaiting_code") codeInputRef.current?.focus();
  }, [phase]);

  const busy = phase === "requesting" || phase === "confirming";

  async function doRequest() {
    if (!phoneValid || !consent || busy) return;
    setErrorMsg("");
    setPhase("requesting");
    try {
      const r = await requestFn({
        data: {
          phone: phone.trim(),
          consentGeneralAccepted: true,
          source,
        },
      });
      if ((r as { ok?: boolean }).ok) {
        const ok = r as {
          ok: true;
          verificationId: string;
          phoneMasked: string;
          cooldownSeconds: number;
          expiresInSeconds: number;
        };
        setVerificationId(ok.verificationId);
        setPhoneMasked(ok.phoneMasked);
        setCooldown(ok.cooldownSeconds ?? COOLDOWN_SECONDS);
        setExpiresIn(ok.expiresInSeconds ?? 600);
        setCode("");
        setPhase("awaiting_code");
      } else {
        const err = r as { ok: false; error: string; cooldownSeconds?: number };
        setErrorMsg(REQUEST_ERROR_COPY[err.error] ?? REQUEST_ERROR_COPY.internal_error);
        if (err.error === "cooldown" && typeof err.cooldownSeconds === "number") {
          setCooldown(err.cooldownSeconds);
        }
        setPhase("idle");
      }
    } catch {
      setErrorMsg(REQUEST_ERROR_COPY.internal_error);
      setPhase("idle");
    }
  }

  async function doConfirm() {
    if (code.length !== 6 || !verificationId || busy) return;
    setErrorMsg("");
    setPhase("confirming");
    try {
      const r = await confirmFn({ data: { verificationId, code } });
      if ((r as { ok?: boolean }).ok) {
        const ok = r as { ok: true; contactId: string };
        setContactId(ok.contactId);
        // limpar dados sensíveis da memória
        setCode("");
        setVerificationId("");
        setPhase("success");
        onLinked?.({ contactId: ok.contactId });
      } else {
        const err = r as { ok: false; reason: string };
        setErrorMsg(CONFIRM_ERROR_COPY[err.reason] ?? CONFIRM_ERROR_COPY.internal_error);
        if (err.reason === "invalid_or_expired" || err.reason === "blocked") {
          setCode("");
        }
        setPhase("awaiting_code");
      }
    } catch {
      setErrorMsg(CONFIRM_ERROR_COPY.internal_error);
      setPhase("awaiting_code");
    }
  }

  function doCorrectNumber() {
    setVerificationId("");
    setCode("");
    setPhoneMasked("");
    setExpiresIn(0);
    setErrorMsg("");
    setPhase("idle");
  }

  const expiresMin = Math.ceil(expiresIn / 60);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-sm shadow-lg">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Ative o Jarvys no WhatsApp</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Receba lembretes, envie informações do seu veículo e use os recursos do
        Jarvys pelo WhatsApp.
      </p>

      {phase === "success" ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="rounded-full bg-primary/10 p-3">
            <Check className="h-6 w-6 text-primary" />
          </div>
          <p className="text-center text-sm font-medium">
            Seu WhatsApp foi vinculado ao Jarvys com sucesso.
          </p>
          {contactId ? null : null}
          <button
            type="button"
            onClick={() => onLinked?.({ contactId })}
            className="glow-neon mt-2 w-full rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-3 text-sm font-semibold text-primary-foreground"
          >
            Continuar
          </button>
        </div>
      ) : phase === "awaiting_code" || phase === "confirming" ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs">
            <span className="text-muted-foreground">Código enviado para </span>
            <span className="font-mono">{phoneMasked}</span>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Código de 6 dígitos
            </span>
            <input
              ref={codeInputRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              disabled={busy}
              placeholder="000000"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.4em] outline-none focus:border-primary"
            />
          </label>
          {expiresIn > 0 && (
            <p className="text-[11px] text-muted-foreground">
              O código expira em {expiresMin} {expiresMin === 1 ? "minuto" : "minutos"}.
            </p>
          )}
          {errorMsg && (
            <p role="alert" className="text-xs text-destructive">
              {errorMsg}
            </p>
          )}
          <button
            type="button"
            onClick={doConfirm}
            disabled={busy || code.length !== 6}
            className="glow-neon flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {phase === "confirming" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {phase === "confirming" ? "Confirmando..." : "Confirmar código"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={doRequest}
              disabled={busy || cooldown > 0 || !phoneValid || !consent}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {cooldown > 0 ? `Reenviar (${cooldown}s)` : "Reenviar código"}
            </button>
            <button
              type="button"
              onClick={doCorrectNumber}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Corrigir número
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Celular/WhatsApp
            </span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(formatBrPhoneInput(e.target.value))}
              placeholder="(11) 90000-0000"
              disabled={busy}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span className="text-muted-foreground">{CONSENT_TEXT}</span>
          </label>
          {errorMsg && (
            <p role="alert" className="text-xs text-destructive">
              {errorMsg}
            </p>
          )}
          <button
            type="button"
            onClick={doRequest}
            disabled={busy || !phoneValid || !consent || cooldown > 0}
            className="glow-neon flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {phase === "requesting" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4" />
            )}
            {phase === "requesting"
              ? "Enviando..."
              : cooldown > 0
                ? `Aguarde ${cooldown}s`
                : "Enviar código"}
          </button>
          <div className="flex gap-2">
            {allowSkip && onSkip && (
              <button
                type="button"
                onClick={onSkip}
                disabled={busy}
                className="flex-1 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground disabled:opacity-50"
              >
                Agora não
              </button>
            )}
            {onCancel && !allowSkip && (
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="flex-1 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground disabled:opacity-50"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
