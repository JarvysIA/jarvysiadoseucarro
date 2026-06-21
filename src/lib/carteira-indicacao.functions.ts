import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CarteiraResumo = {
  saldo_disponivel: number;
  saldo_pendente: number;
  saldo_reservado: number;
  total_indicacoes: number;
};

export type MovimentacaoIndicacaoDTO = {
  id: string;
  tipo: string;
  status: string;
  valor: number;
  descricao: string | null;
  referencia: string | null;
  created_at: string;
  liberado_em: string | null;
  afilhado_nome_mascarado: string | null;
};

export type CarteiraIndicacaoDTO = {
  carteira: CarteiraResumo;
  codigo_indicacao: string | null;
  movimentacoes: MovimentacaoIndicacaoDTO[];
};

const ZERO_CARTEIRA: CarteiraResumo = {
  saldo_disponivel: 0,
  saldo_pendente: 0,
  saldo_reservado: 0,
  total_indicacoes: 0,
};

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const getCarteiraIndicacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CarteiraIndicacaoDTO> => {
    const { supabase, userId } = context;

    const [carteiraRes, profileRes, movsRes] = await Promise.all([
      supabase
        .from("carteiras_indicacao")
        .select("saldo_disponivel, saldo_pendente, saldo_reservado, total_indicacoes")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("codigo_indicacao")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("movimentacoes_indicacao")
        .select("id, tipo, status, valor, descricao, referencia, created_at, liberado_em")
        .eq("padrinho_id", userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const carteira: CarteiraResumo = carteiraRes.data
      ? {
          saldo_disponivel: toNumber(carteiraRes.data.saldo_disponivel),
          saldo_pendente: toNumber(carteiraRes.data.saldo_pendente),
          saldo_reservado: toNumber(carteiraRes.data.saldo_reservado),
          total_indicacoes: Number(carteiraRes.data.total_indicacoes ?? 0) || 0,
        }
      : ZERO_CARTEIRA;

    const movimentacoes: MovimentacaoIndicacaoDTO[] = (movsRes.data ?? []).map((m) => ({
      id: String(m.id),
      tipo: String(m.tipo),
      status: String(m.status),
      valor: toNumber(m.valor),
      descricao: (m.descricao as string | null) ?? null,
      referencia: (m.referencia as string | null) ?? null,
      created_at: String(m.created_at),
      liberado_em: (m.liberado_em as string | null) ?? null,
      // RLS impede o padrinho de ler o profile do afilhado neste Build.
      // Mantemos null e o frontend faz fallback para descricao/referencia.
      afilhado_nome_mascarado: null,
    }));

    return {
      carteira,
      codigo_indicacao: (profileRes.data?.codigo_indicacao as string | null) ?? null,
      movimentacoes,
    };
  });
