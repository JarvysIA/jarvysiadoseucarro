import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook que devolve o conjunto de veiculo_id ATIVADOS COMERCIALMENTE
 * (R$29,90 pago) do usuário autenticado.
 *
 * Fonte (mesma regra do useCurrentPlan):
 * - pagamentos_pix.status = 'pago'
 * - pagamentos_pix.tipo_produto = 'ativacao'
 * - pagamentos_pix.veiculo_id IS NOT NULL
 * - cruzado com veiculos do usuário onde status = 'ativo'
 *
 * NÃO usa a tabela `assinaturas`.
 * Histórico premium (tipo_produto='historico', R$49,90) NÃO conta.
 *
 * Retorno:
 * - null enquanto carrega (consumidores devem manter botão em loading/disabled)
 * - Set<string> com os ids ativados quando pronto
 *
 * Reage a refreshKey para invalidação após ativação/exclusão.
 */
export function useActivatedVehicleIds(
  refreshKey: number = 0,
): Set<string> | null {
  const [ids, setIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) {
        if (!cancelled) setIds(new Set());
        return;
      }

      const [vehiclesRes, activationsRes] = await Promise.all([
        supabase
          .from("veiculos")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "ativo"),
        supabase
          .from("pagamentos_pix")
          .select("veiculo_id")
          .eq("user_id", userId)
          .eq("status", "pago")
          .eq("tipo_produto", "ativacao")
          .not("veiculo_id", "is", null),
      ]);

      if (cancelled) return;

      const activeVehicleIds = new Set<string>(
        ((vehiclesRes.data ?? []) as { id: string }[]).map((v) => v.id),
      );
      const activated = new Set<string>();
      for (const row of (activationsRes.data ?? []) as {
        veiculo_id: string | null;
      }[]) {
        if (row.veiculo_id && activeVehicleIds.has(row.veiculo_id)) {
          activated.add(row.veiculo_id);
        }
      }

      setIds(activated);
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return ids;
}
