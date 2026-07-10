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

type LinkSource = "onboarding" | "app_settings";

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
  if (source !== "onboarding" && source !== "app_settings") return null;
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

    const { data: userActiveContacts, error: userActiveErr } = await supabaseAdmin
      .from("whatsapp_contacts")
      .select("id, phone_e164, opt_out")
      .eq("user_id", userId)
      .is("unlinked_at", null);
    if (userActiveErr) {
      logInfo({ user_id: userId, phone: phoneMasked, status: "error", error_code: "user_active_lookup" });
      return { ok: false, error: "internal_error" };
    }
    const otherActive = (userActiveContacts ?? []).find((c) => c.phone_e164 !== phoneE164);
    if (otherActive) {
      logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "user_has_other_active" });
      return { ok: false, error: "user_has_other_active" };
    }
    const sameActive = (userActiveContacts ?? []).find((c) => c.phone_e164 === phoneE164);
    let purpose: "link" | "reactivate" = "link";
    if (sameActive) {
      if (sameActive.opt_out === true && source === "app_settings") {
        purpose = "reactivate";
      } else {
        logInfo({ user_id: userId, phone: phoneMasked, source, status: "rejected", error_code: "already_linked" });
        return { ok: false, error: "already_linked" };
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

    // 4) Cancela pendings anteriores do mesmo par (par válido, mesmo user).
    await supabaseAdmin
      .from("whatsapp_link_verifications")
      .update({ status: "cancelled" })
      .eq("user_id", userId)
      .eq("phone_e164", phoneE164)
      .eq("status", "pending");

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
