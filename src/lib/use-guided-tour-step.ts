import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// As 5 telas com balão de tour guiado (Build Guided-Tour). "app" cobre os
// 2 balões da Home — compartilham a mesma chave; cada Popover ainda é
// dispensado individualmente (cada instância do hook busca seu próprio
// snapshot de tours_vistos e só marca a própria chave local ao clicar
// "Entendi"), então fechar um balão não fecha o outro.
export const GUIDED_TOUR_KEYS = ["app", "despesas", "revisoes", "carteira", "shopping"] as const;
export type GuidedTourKey = (typeof GUIDED_TOUR_KEYS)[number];

function asToursVistos(raw: unknown): Record<string, boolean> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, boolean>)
    : {};
}

/**
 * Hook leve por âncora de tour guiado — mesmo padrão de leitura client-side
 * de useCurrentPlan. shouldShow só fica true depois que tours_vistos
 * carregou E a chave ainda não está marcada como vista.
 */
export function useGuidedTourStep(tourKey: GuidedTourKey): {
  shouldShow: boolean;
  markSeen: () => Promise<void>;
} {
  const [userId, setUserId] = useState<string | null>(null);
  const [toursVistos, setToursVistos] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        if (!cancelled) {
          setUserId(null);
          setToursVistos({});
        }
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("tours_vistos")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      setUserId(uid);
      setToursVistos(asToursVistos((data as { tours_vistos?: unknown } | null)?.tours_vistos));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markSeen = useCallback(async () => {
    if (!userId) return;
    const next = { ...(toursVistos ?? {}), [tourKey]: true };
    setToursVistos(next);
    await supabase.from("profiles").update({ tours_vistos: next }).eq("id", userId);
  }, [userId, toursVistos, tourKey]);

  return {
    shouldShow: toursVistos !== null && toursVistos[tourKey] !== true,
    markSeen,
  };
}

/**
 * Reseta todos os tours guiados de uma vez — usado pelo botão "Ver tour
 * novamente" em ProfileSettingsModal. Lê+mescla+grava (mesmo padrão do
 * resto do projeto, sem jsonb_set): zera as 5 chaves conhecidas mantendo
 * qualquer outra chave que eventualmente exista no objeto.
 */
export async function resetAllGuidedTours(): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user.id;
  if (!userId) return;
  const { data } = await supabase
    .from("profiles")
    .select("tours_vistos")
    .eq("id", userId)
    .maybeSingle();
  const current = asToursVistos((data as { tours_vistos?: unknown } | null)?.tours_vistos);
  const next = { ...current };
  for (const key of GUIDED_TOUR_KEYS) next[key] = false;
  await supabase.from("profiles").update({ tours_vistos: next }).eq("id", userId);
}
