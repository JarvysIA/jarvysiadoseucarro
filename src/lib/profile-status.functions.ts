import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAuditEvent } from "@/lib/audit-log";

// Desativa a própria conta do usuário autenticado (context.userId vem do
// token verificado pelo middleware — nunca de um id enviado pelo client).
// Usa supabaseAdmin porque a RLS de "profiles" hoje permite ao próprio
// usuário atualizar qualquer coluna da própria linha, sem distinção — um
// update client-side comum funcionaria, mas passar por supabaseAdmin é a
// escolha correta aqui de qualquer forma: é uma mudança de acesso à conta,
// não uma edição de perfil comum.
//
// Limitação conhecida: a Admin API do supabase-js (auth-js 2.106.2) só expõe
// auth.admin.signOut(jwt, scope), que exige o JWT de UMA sessão específica —
// não existe nesta versão um método para invalidar todas as sessões de um
// usuário a partir só do user id. Sessões já ativas em outros
// dispositivos/abas continuam válidas até a próxima navegação autenticada
// checar status_usuario.
export const deactivateAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ status_usuario: "desativado" })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    void recordAuditEvent(supabaseAdmin, {
      actorId: context.userId,
      action: "account_deactivated",
      targetId: context.userId,
      details: {},
    });

    return { ok: true };
  });
