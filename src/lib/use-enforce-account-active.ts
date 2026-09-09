import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Verifica se a conta do usuário autenticado foi desativada e, se sim,
 * encerra a sessão local e redireciona para /login. Não há como invalidar
 * remotamente sessões já ativas em outros dispositivos/abas (ver
 * src/lib/profile-status.functions.ts) — este hook é o que efetivamente
 * aplica o bloqueio, ao rodar em cada carregamento de página autenticada.
 */
export function useEnforceAccountActive(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) return;

      const { data } = await supabase
        .from("profiles")
        .select("status_usuario")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;

      if ((data as { status_usuario?: string } | null)?.status_usuario === "desativado") {
        await supabase.auth.signOut();
        if (cancelled) return;
        navigate({ to: "/login", search: { motivo: "conta_desativada" } });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);
}
