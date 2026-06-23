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
  indicacao_liberada: boolean;
  status_usuario: string | null;
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
        .select("codigo_indicacao, status_usuario, permite_indicacao")
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

    const indicacaoLiberada = !!(profileRes.data?.permite_indicacao as boolean | undefined);

    return {
      carteira,
      codigo_indicacao: indicacaoLiberada
        ? ((profileRes.data?.codigo_indicacao as string | null) ?? null)
        : null,
      indicacao_liberada: indicacaoLiberada,
      status_usuario: (profileRes.data?.status_usuario as string | null) ?? null,
      movimentacoes,
    };
  });

export type SolicitarSaqueResultado = {
  ok: true;
  movimentacao_id: string;
  valor: number;
};

const SAQUE_ERROR_MESSAGES: Record<string, string> = {
  NAO_AUTORIZADO: "Sessão expirada. Faça login novamente.",
  CHAVE_PIX_INVALIDA: "Informe uma chave PIX válida.",
  SALDO_INSUFICIENTE: "Saldo disponível abaixo do mínimo para saque.",
  CARTEIRA_NAO_ENCONTRADA: "Carteira não encontrada.",
};

export const solicitarSaqueIndicacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chave_pix: string }) => {
    const chave = typeof input?.chave_pix === "string" ? input.chave_pix.trim() : "";
    if (!chave) throw new Error("CHAVE_PIX_INVALIDA");
    return { chave_pix: chave };
  })
  .handler(async ({ data, context }): Promise<SolicitarSaqueResultado> => {
    const { supabase } = context;
    const { data: rpcData, error } = await supabase.rpc("solicitar_saque_indicacao", {
      _chave_pix: data.chave_pix,
    });

    if (error) {
      const raw = (error.message || "").toUpperCase();
      const code = Object.keys(SAQUE_ERROR_MESSAGES).find((k) => raw.includes(k));
      throw new Error(code ? SAQUE_ERROR_MESSAGES[code] : "Não foi possível solicitar o saque. Tente novamente.");
    }

    const payload = (rpcData ?? {}) as { movimentacao_id?: string; valor?: number | string };
    return {
      ok: true,
      movimentacao_id: String(payload.movimentacao_id ?? ""),
      valor: toNumber(payload.valor),
    };
  });
