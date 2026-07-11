// Server function: requestWhatsappLinkCodeFn (Build 5.7C1).
// Fluxo: valida input/consentimento -> conflitos -> rate limits -> gera código
// CSPRNG -> salva hash -> cria verificação e outbound purpose='link_code'.
// Nunca retorna nem loga o código puro.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeBrazilPhoneToE164, isLikelyE164 } from "@/lib/whatsapp/phone";
import {
  LINK_CODE_TTL_SECONDS,
  LINK_CODE_MAX_ATTEMPTS,
  OUTBOUND_MAX_ATTEMPTS,
  OUTBOUND_PRIORITY,
  COOLDOWN_SECONDS,
  HOURLY_PHONE_LIMIT,
  DAILY_USER_LIMIT,
  generateSixDigitCode,
  newVerificationId,
  hashLinkCode,
  maskPhone,
  buildLinkCodeMessage,
} from "@/lib/whatsapp-link.server";

type LinkSource = "onboarding" | "app_settings" | "change_number";

type RequestInput = {
  phone: string;
  consentGeneralAccepted: boolean;
  source: LinkSource;
};

type SuccessOutput = {
  ok: true;
  verificationId: string;
  phoneMasked: string;
  cooldownSeconds: number;
  expiresInSeconds: number;
};

type ErrorCode =
  | "invalid_request"
  | "cooldown"
  | "rate_limited"
  | "phone_conflict"
  | "user_has_other_active"
  | "already_linked"
  | "no_active_contact"
  | "same_phone"
  | "no_instance_available"
  | "internal_error";

type ErrorOutput = { ok: false; error: ErrorCode; cooldownSeconds?: number };

type FnOutput = SuccessOutput | ErrorOutput;

function logInfo(payload: Record<string, unknown>) {
  console.log(JSON.stringify({ tag: "whatsapp-link-request", ...payload }));
}

function validateInput(input: unknown): RequestInput | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const phone = raw.phone;
  const consent = raw.consentGeneralAccepted;
  const source = raw.source;
  if (typeof phone !== "string" || phone.length === 0 || phone.length > 40) return null;
  if (consent !== true) return null;
  if (source !== "onboarding" && source !== "app_settings" && source !== "change_number") return null;
  return {
    phone,
    consentGeneralAccepted: true,
    source: source as LinkSource,
  };
}

export const requestWhatsappLinkCodeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const ok = validateInput(input);
    if (!ok) throw new Error("invalid_request");
    return ok;
  })
  .handler(async ({ data, context }): Promise<FnOutput> => {
    const { userId } = context;
    const t0 = Date.now();

    const pepper = process.env.WHATSAPP_LINK_PEPPER;
    if (!pepper) {
      logInfo({ user_id: userId, status: "error", error_code: "missing_pepper" });
      return { ok: false, error: "internal_error" };
    }

    const phoneE164 = normalizeBrazilPhoneToE164(data.phone);
    if (!phoneE164 || !isLikelyE164(phoneE164)) {
      logInfo({ user_id: userId, status: "invalid", error_code: "invalid_phone" });
      return { ok: false, error: "invalid_request" };
    }
    const phoneMasked = maskPhone(phoneE164);
    const source = data.source;

    // supabaseAdmin: chargingas de lookup/insert precisam ver linhas cross-user
    // (conflitos) e criar verificações com policy service_role only.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Conflitos ---------------------------------------------------------
    // phone_conflict é aplicado para todos os sources: telefone ativo em OUTRA conta.
    const { data: activeSamePhoneOther, error: otherErr } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("id, user_id")
      .eq("phone_e164", phoneE164)
      .is("unlinked_at", null)
      .neq("user_id", userId)
      .maybeSingle();
    if (otherErr) {
      logInfo({ user_id: userId, phone: phoneMasked, status: "error", error_code: "conflict_lookup" });
      return { ok: false, error: "internal_error" };
    }
    if (activeSamePhoneOther) {
      logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "phone_conflict" });
      return { ok: false, error: "phone_conflict" };
    }

    // Contatos ativos do usuário — necessário para as duas ramificações.
    const { data: userActiveContacts, error: userActiveErr } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("id, phone_e164, opt_out, verified_at")
      .eq("user_id", userId)
      .is("unlinked_at", null);
    if (userActiveErr) {
      logInfo({ user_id: userId, phone: phoneMasked, status: "error", error_code: "user_active_lookup" });
      return { ok: false, error: "internal_error" };
    }

    let purpose: "link" | "reactivate" | "relink" = "link";
    let sameActive: { id: string; phone_e164: string; opt_out: boolean | null; verified_at: string | null } | undefined;

    if (source === "change_number") {
      // Ramo change_number: exatamente 1 contato ativo/verificado; novo != atual.
      const verifiedActive = (userActiveContacts ?? []).filter((c) => c.verified_at != null);
      if (verifiedActive.length !== 1) {
        logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "no_active_contact" });
        return { ok: false, error: "no_active_contact" };
      }
      const current = verifiedActive[0];
      if (current.phone_e164 === phoneE164) {
        logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "same_phone" });
        return { ok: false, error: "same_phone" };
      }
      purpose = "relink";
    } else {
      // Ramos onboarding / app_settings: comportamento original preservado.
      const otherActive = (userActiveContacts ?? []).find((c) => c.phone_e164 !== phoneE164);
      if (otherActive) {
        logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "user_has_other_active" });
        return { ok: false, error: "user_has_other_active" };
      }
      sameActive = (userActiveContacts ?? []).find((c) => c.phone_e164 === phoneE164);
      if (sameActive) {
        if (sameActive.opt_out === true && source === "app_settings") {
          purpose = "reactivate";
        } else {
          logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "already_linked" });
          return { ok: false, error: "already_linked" };
        }
      }
    }

    // 2) Rate limits -------------------------------------------------------
    const now = Date.now();
    const cooldownSince = new Date(now - COOLDOWN_SECONDS * 1000).toISOString();
    const hourSince = new Date(now - 3600 * 1000).toISOString();
    const daySince = new Date(now - 86400 * 1000).toISOString();

    const { data: lastForPair, error: lastErr } = await supabaseAdmin
      .from("whatsapp_link_verifications")
      .select("created_at")
      .eq("user_id", userId)
      .eq("phone_e164", phoneE164)
      .gte("created_at", cooldownSince)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastErr) {
      logInfo({ user_id: userId, phone: phoneMasked, status: "error", error_code: "rl_lookup" });
      return { ok: false, error: "internal_error" };
    }
    if (lastForPair) {
      const elapsed = Math.floor((now - new Date(lastForPair.created_at as string).getTime()) / 1000);
      const remaining = Math.max(1, COOLDOWN_SECONDS - elapsed);
      logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "cooldown", cooldown: remaining });
      return { ok: false, error: "cooldown", cooldownSeconds: remaining };
    }

    const { count: hourCount, error: hourErr } = await supabaseAdmin
      .from("whatsapp_link_verifications")
      .select("id", { count: "exact", head: true })
      .eq("phone_e164", phoneE164)
      .gte("created_at", hourSince);
    if (hourErr) {
      logInfo({ user_id: userId, phone: phoneMasked, status: "error", error_code: "rl_hour" });
      return { ok: false, error: "internal_error" };
    }
    if ((hourCount ?? 0) >= HOURLY_PHONE_LIMIT) {
      logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "rate_limited_phone_hour" });
      return { ok: false, error: "rate_limited" };
    }

    const { count: dayCount, error: dayErr } = await supabaseAdmin
      .from("whatsapp_link_verifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", daySince);
    if (dayErr) {
      logInfo({ user_id: userId, phone: phoneMasked, status: "error", error_code: "rl_day" });
      return { ok: false, error: "internal_error" };
    }
    if ((dayCount ?? 0) >= DAILY_USER_LIMIT) {
      logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "rate_limited_user_day" });
      return { ok: false, error: "rate_limited" };
    }

    // 3) Instância ---------------------------------------------------------
    const { data: instances, error: instErr } = await supabaseAdmin
      .from("whatsapp_provider_instances")
      .select("instance_id, is_default, current_users, status, health_status")
      .eq("provider", "zapi")
      .eq("status", "active")
      .neq("health_status", "failed")
      .order("is_default", { ascending: false })
      .order("current_users", { ascending: true })
      .limit(1);
    if (instErr) {
      logInfo({ user_id: userId, phone: phoneMasked, status: "error", error_code: "inst_lookup" });
      return { ok: false, error: "internal_error" };
    }
    const instance = (instances ?? [])[0];
    if (!instance) {
      logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "no_instance_available" });
      return { ok: false, error: "no_instance_available" };
    }

    // 4) Cancela pendings anteriores.
    if (purpose === "relink") {
      // change_number: cancela qualquer pending relink do usuário (respeita índice uq_wlv_pending_relink_per_user).
      await supabaseAdmin
        .from("whatsapp_link_verifications")
        .update({ status: "cancelled" })
        .eq("user_id", userId)
        .eq("purpose", "relink")
        .eq("status", "pending");
    } else {
      // onboarding / app_settings: cancela pendings do mesmo par (user, phone).
      await supabaseAdmin
        .from("whatsapp_link_verifications")
        .update({ status: "cancelled" })
        .eq("user_id", userId)
        .eq("phone_e164", phoneE164)
        .eq("status", "pending");
    }

    // 5) Gera código e cria verification ----------------------------------
    const verificationId = newVerificationId();
    const code = generateSixDigitCode();
    const codeHash = hashLinkCode(pepper, verificationId, code);
    const expiresAtIso = new Date(now + LINK_CODE_TTL_SECONDS * 1000).toISOString();

    const { error: insertVerErr } = await supabaseAdmin
      .from("whatsapp_link_verifications")
      .insert({
        id: verificationId,
        user_id: userId,
        phone_e164: phoneE164,
        code_hash: codeHash,
        status: "pending",
        purpose,
        source,
        attempts: 0,
        max_attempts: LINK_CODE_MAX_ATTEMPTS,
        expires_at: expiresAtIso,
        last_sent_at: new Date(now).toISOString(),
      });
    if (insertVerErr) {
      logInfo({ user_id: userId, phone: phoneMasked, source, status: "error", error_code: "insert_verification" });
      return { ok: false, error: "internal_error" };
    }

    // 6) Enfileira outbound do código -------------------------------------
    const contactIdForOutbound = purpose === "reactivate" && sameActive ? sameActive.id : null;
    const { error: outErr } = await supabaseAdmin
      .from("whatsapp_outbound_queue")
      .insert({
        user_id: userId,
        contact_id: contactIdForOutbound,
        vehicle_id: null,
        provider: "zapi",
        instance_id: instance.instance_id,
        phone_e164: phoneE164,
        message_type: "text",
        purpose: "link_code",
        text_body: buildLinkCodeMessage(code),
        status: "queued",
        priority: OUTBOUND_PRIORITY,
        attempts: 0,
        max_attempts: OUTBOUND_MAX_ATTEMPTS,
        scheduled_at: new Date(now).toISOString(),
        expires_at: expiresAtIso,
      });
    if (outErr) {
      // Rollback lógico: cancela a verification já criada.
      await supabaseAdmin
        .from("whatsapp_link_verifications")
        .update({ status: "cancelled" })
        .eq("id", verificationId);
      logInfo({ user_id: userId, phone: phoneMasked, source, verification_id: verificationId, status: "error", error_code: "insert_outbound" });
      return { ok: false, error: "internal_error" };
    }

    logInfo({
      user_id: userId,
      phone: phoneMasked,
      source,
      verification_id: verificationId,
      purpose,
      status: "ok",
      elapsed_ms: Date.now() - t0,
    });

    return {
      ok: true,
      verificationId,
      phoneMasked,
      cooldownSeconds: COOLDOWN_SECONDS,
      expiresInSeconds: LINK_CODE_TTL_SECONDS,
    };
  });

// ============================================================================
// Build 5.7C2 — confirmWhatsappLinkCodeFn
// ----------------------------------------------------------------------------
// Valida input, calcula hash com o mesmo helper de request, chama a RPC
// transacional public.confirm_whatsapp_link_code (única responsável por lock,
// tentativas, expiração, conflitos, contato, consentimento, instância,
// current_users e enfileiramento do link_confirm) e retorna resposta segura.
// Nunca retorna nem loga: código, hash, pepper, telefone completo, erro SQL.
// Não inicia trial. Não altera capabilities. Não chama IA/OCR.
// ============================================================================

type ConfirmInput = { verificationId: string; code: string };

type ConfirmSuccess = { ok: true; contactId: string; phoneMasked: string };
type ConfirmReason =
  | "invalid_or_expired"
  | "blocked"
  | "phone_conflict"
  | "user_has_other_active"
  | "no_instance_available"
  | "internal_error";
type ConfirmFailure = { ok: false; reason: ConfirmReason };
type ConfirmOutput = ConfirmSuccess | ConfirmFailure;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^\d{6}$/;

function logConfirm(payload: Record<string, unknown>) {
  console.log(
    JSON.stringify({ tag: "whatsapp-link-confirm", ...payload }),
  );
}

function validateConfirmInput(input: unknown): ConfirmInput | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const verificationId = raw.verificationId;
  const code = raw.code;
  if (typeof verificationId !== "string" || !UUID_RE.test(verificationId)) return null;
  if (typeof code !== "string" || !CODE_RE.test(code)) return null;
  return { verificationId, code };
}

export const confirmWhatsappLinkCodeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown): ConfirmInput | { __invalid: true } => {
    const ok = validateConfirmInput(input);
    if (!ok) return { __invalid: true };
    return ok;
  })
  .handler(async ({ data, context }): Promise<ConfirmOutput> => {
    const { userId } = context;
    const t0 = Date.now();

    if ((data as { __invalid?: boolean }).__invalid) {
      logConfirm({ user_id: userId, result: "invalid_or_expired", error_code: "invalid_input", elapsed_ms: Date.now() - t0 });
      return { ok: false, reason: "invalid_or_expired" };
    }
    const { verificationId, code } = data as ConfirmInput;

    const pepper = process.env.WHATSAPP_LINK_PEPPER;
    if (!pepper) {
      logConfirm({ user_id: userId, verification_id: verificationId, result: "internal_error", error_code: "pepper_missing", elapsed_ms: Date.now() - t0 });
      return { ok: false, reason: "internal_error" };
    }

    const codeHashCandidate = hashLinkCode(pepper, verificationId, code);

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows, error } = await supabaseAdmin.rpc(
        "confirm_whatsapp_link_code",
        {
          p_user_id: userId,
          p_verification_id: verificationId,
          p_code_hash_candidate: codeHashCandidate,
        },
      );

      if (error) {
        console.error("[whatsapp-link-confirm] rpc_error detail", { message: error.message, code: (error as { code?: string }).code, details: (error as { details?: string }).details, hint: (error as { hint?: string }).hint });
        logConfirm({ user_id: userId, verification_id: verificationId, result: "internal_error", error_code: "rpc_error", elapsed_ms: Date.now() - t0 });
        return { ok: false, reason: "internal_error" };
      }

      const row = Array.isArray(rows) ? rows[0] : (rows as unknown as { result?: string; contact_id?: string | null; phone_e164?: string | null } | null);
      if (!row || typeof row.result !== "string") {
        logConfirm({ user_id: userId, verification_id: verificationId, result: "internal_error", error_code: "empty_result", elapsed_ms: Date.now() - t0 });
        return { ok: false, reason: "internal_error" };
      }

      const result = row.result;
      const knownReasons: ConfirmReason[] = [
        "invalid_or_expired",
        "blocked",
        "phone_conflict",
        "user_has_other_active",
        "no_instance_available",
      ];

      if (result === "ok") {
        const contactId = row.contact_id ?? "";
        const phoneE164 = row.phone_e164 ?? "";
        const phoneMasked = maskPhone(phoneE164);
        if (!contactId || !phoneE164) {
          logConfirm({ user_id: userId, verification_id: verificationId, result: "internal_error", error_code: "missing_ok_fields", elapsed_ms: Date.now() - t0 });
          return { ok: false, reason: "internal_error" };
        }
        logConfirm({
          user_id: userId,
          verification_id: verificationId,
          result: "ok",
          contact_id: contactId,
          phone: phoneMasked,
          elapsed_ms: Date.now() - t0,
        });
        return { ok: true, contactId, phoneMasked };
      }

      if ((knownReasons as string[]).includes(result)) {
        logConfirm({ user_id: userId, verification_id: verificationId, result, elapsed_ms: Date.now() - t0 });
        return { ok: false, reason: result as ConfirmReason };
      }

      logConfirm({ user_id: userId, verification_id: verificationId, result: "internal_error", error_code: "unknown_rpc_result", elapsed_ms: Date.now() - t0 });
      return { ok: false, reason: "internal_error" };
    } catch (_e) {
      logConfirm({ user_id: userId, verification_id: verificationId, result: "internal_error", error_code: "exception", elapsed_ms: Date.now() - t0 });
      return { ok: false, reason: "internal_error" };
    }
  });

// ============================================================================
// Build 5.7E1 — Opt-out (disable) e reativação do WhatsApp pelo app.
// ----------------------------------------------------------------------------
// Duas server functions autenticadas que apenas encaminham o context.userId
// para as RPCs SECURITY DEFINER `public.disable_whatsapp_messages` e
// `public.reactivate_whatsapp_contact`. Sem input do client (evita spoof de
// user_id). Toda a lógica transacional (UPDATE + INSERT em consents) mora no
// banco. Sender continua bloqueando opt_out=true para tudo, exceto link_code.
// ============================================================================

type OptOutSuccess = { ok: true; contactId: string; phoneMasked: string };
type OptOutReason = "no_active_contact" | "invalid_request" | "internal_error";
type OptOutFailure = { ok: false; reason: OptOutReason };
type OptOutOutput = OptOutSuccess | OptOutFailure;

function logOptToggle(tag: string, payload: Record<string, unknown>) {
  console.log(JSON.stringify({ tag, ...payload }));
}

async function runOptRpc(
  rpcName: "disable_whatsapp_messages" | "reactivate_whatsapp_contact",
  userId: string,
): Promise<OptOutOutput> {
  const t0 = Date.now();
  const tag = `whatsapp-${rpcName.replace(/_/g, "-")}`;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc(rpcName, {
      p_user_id: userId,
    });
    if (error) {
      console.error(`[${tag}] rpc_error`, {
        message: error.message,
        code: (error as { code?: string }).code,
      });
      logOptToggle(tag, { user_id: userId, result: "internal_error", error_code: "rpc_error", elapsed_ms: Date.now() - t0 });
      return { ok: false, reason: "internal_error" };
    }
    const row = Array.isArray(rows)
      ? rows[0]
      : (rows as unknown as { result?: string; contact_id?: string | null; phone_e164?: string | null } | null);
    if (!row || typeof row.result !== "string") {
      logOptToggle(tag, { user_id: userId, result: "internal_error", error_code: "empty_result", elapsed_ms: Date.now() - t0 });
      return { ok: false, reason: "internal_error" };
    }
    if (row.result === "ok") {
      const contactId = row.contact_id ?? "";
      const phoneE164 = row.phone_e164 ?? "";
      if (!contactId || !phoneE164) {
        logOptToggle(tag, { user_id: userId, result: "internal_error", error_code: "missing_ok_fields", elapsed_ms: Date.now() - t0 });
        return { ok: false, reason: "internal_error" };
      }
      const phoneMasked = maskPhone(phoneE164);
      logOptToggle(tag, { user_id: userId, result: "ok", contact_id: contactId, phone: phoneMasked, elapsed_ms: Date.now() - t0 });
      return { ok: true, contactId, phoneMasked };
    }
    if (row.result === "no_active_contact" || row.result === "invalid_request") {
      logOptToggle(tag, { user_id: userId, result: row.result, elapsed_ms: Date.now() - t0 });
      return { ok: false, reason: row.result };
    }
    logOptToggle(tag, { user_id: userId, result: "internal_error", error_code: "unknown_rpc_result", elapsed_ms: Date.now() - t0 });
    return { ok: false, reason: "internal_error" };
  } catch {
    logOptToggle(tag, { user_id: userId, result: "internal_error", error_code: "exception", elapsed_ms: Date.now() - t0 });
    return { ok: false, reason: "internal_error" };
  }
}

export const disableWhatsappMessagesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OptOutOutput> => {
    return runOptRpc("disable_whatsapp_messages", context.userId);
  });

export const reactivateWhatsappContactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OptOutOutput> => {
    return runOptRpc("reactivate_whatsapp_contact", context.userId);
  });
