import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Check, Loader2, Share2, Wallet, Users, Clock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  getCarteiraIndicacao,
  solicitarSaqueIndicacao,
  type CarteiraIndicacaoDTO,
  type MovimentacaoIndicacaoDTO,
} from "@/lib/carteira-indicacao.functions";

const SAQUE_MINIMO = 20;

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const DATE_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return DATE_FMT.format(d);
}

const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  pendente: {
    label: "Pendente",
    className: "border-transparent bg-yellow-500/15 text-yellow-300",
  },
  disponivel: {
    label: "Disponível",
    className: "border-transparent bg-emerald-500/15 text-emerald-300",
  },
  reservado: {
    label: "Reservado",
    className: "border-transparent bg-sky-500/15 text-sky-300",
  },
  pago: {
    label: "Pago",
    className: "border-transparent bg-emerald-600/20 text-emerald-200",
  },
  cancelado: {
    label: "Cancelado",
    className: "border-transparent bg-destructive/15 text-destructive",
  },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? {
    label: status,
    className: "border-border bg-muted text-muted-foreground",
  };
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

function buildWhatsappLink(codigo: string): string {
  const msg = `🚗 Conheça o Jarvys, a 1ª IA automotiva pensada no motorista !

Olha o que o Jarvys faz pela sua garagem:

📊 Status Inteligente: A saúde do seu veículo atualizada em tempo real com base no seu histórico.
📸 Timeline de Revisões: Fim do trabalho manual. Tire foto da nota do mecânico e a IA lê as peças, cria o histórico e te avisa da próxima troca antes do pior acontecer.
🛡️ Certificado Jarvys: Validação e credibilidade para as suas revisões (perfeito para valorizar o carro na hora da venda).
💰 Gestão Financeira: Controle total das despesas em um só painel (manutenção, IPVA, multas e até lavagem).
👨‍🔧 Dr. Jarvys: Um especialista na palma da mão. Nossa IA tira dúvidas técnicas e orienta sobre o seu veículo.
📈 Tabela FIPE Integrada: Acompanhe a valorização ou desvalorização do seu patrimônio, sempre atualizada.
📲 Ecossistema Integrado: Tudo isso conectado e enviando alertas diretamente aqui no seu WhatsApp.

Use meu cupom: ${codigo}

E ganhe um super desconto na ativação !`;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

function MovimentacaoItem({ m }: { m: MovimentacaoIndicacaoDTO }) {
  const isCredito = m.tipo === "credito_indicacao";
  const sign = isCredito ? "+" : "";
  const descricao =
    m.descricao ||
    (isCredito ? "Comissão por indicação" : m.tipo.replace(/_/g, " "));
  return (
    <li className="rounded-xl border border-border bg-card/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-300">
            {sign} {BRL.format(m.valor)}
          </p>
          <p className="mt-0.5 text-xs text-foreground/90">{descricao}</p>
          {m.referencia && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              Referência: {m.referencia}
            </p>
          )}
        </div>
        <StatusBadge status={m.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>Criado em {formatDate(m.created_at)}</span>
        {m.liberado_em && <span>· Liberado em {formatDate(m.liberado_em)}</span>}
      </div>
    </li>
  );
}

export function CarteiraJarvys() {
  const fetchCarteira = useServerFn(getCarteiraIndicacao);
  const solicitarSaque = useServerFn(solicitarSaqueIndicacao);
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<CarteiraIndicacaoDTO>({
    queryKey: ["carteira-indicacao"],
    queryFn: () => fetchCarteira(),
    staleTime: 30_000,
  });

  const [copied, setCopied] = useState(false);
  const [saqueOpen, setSaqueOpen] = useState(false);
  const [chavePix, setChavePix] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const codigo = data?.codigo_indicacao ?? null;
  const carteira = data?.carteira;
  const movs = data?.movimentacoes ?? [];
  const podeSaque = (carteira?.saldo_disponivel ?? 0) >= SAQUE_MINIMO;

  // Pré-carrega chave PIX salva ao abrir o modal.
  useEffect(() => {
    if (!saqueOpen) return;
    let cancel = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("pix_recebimento")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (!cancel && prof?.pix_recebimento) {
        setChavePix((prev) => prev || String(prof.pix_recebimento));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [saqueOpen]);

  const proximoSaqueMsg = useMemo(() => {
    if (!carteira) return null;
    const diff = SAQUE_MINIMO - carteira.saldo_disponivel;
    if (carteira.saldo_disponivel >= SAQUE_MINIMO) {
      return `Você tem ${BRL.format(carteira.saldo_disponivel)} disponível para saque via PIX.`;
    }
    return `Faltam ${BRL.format(Math.max(0, diff))} para solicitar seu PIX.`;
  }, [carteira]);

  const handleCopy = async () => {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopied(true);
      toast.success("Código copiado!");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente.");
    }
  };

  const handleWhats = () => {
    if (!codigo) return;
    window.open(buildWhatsappLink(codigo), "_blank", "noopener,noreferrer");
  };

  const handleConfirmSaque = async () => {
    if (submitting) return;
    const chave = chavePix.trim();
    if (!chave) {
      toast.error("Informe sua chave PIX.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await solicitarSaque({ data: { chave_pix: chave } });
      toast.success(`Saque de ${BRL.format(res.valor)} solicitado!`);
      setSaqueOpen(false);
      setChavePix("");
      await queryClient.invalidateQueries({ queryKey: ["carteira-indicacao"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível solicitar o saque.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-60 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4" />
          Não foi possível carregar sua carteira.
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-3 rounded-md border border-destructive/40 px-3 py-1.5 text-xs"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const semIndicacoes = (carteira?.total_indicacoes ?? 0) === 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <span aria-hidden>🚗</span> Minha Carteira Jarvys
        </h1>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </header>

      {/* Resumo */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Wallet className="h-3.5 w-3.5 text-primary" /> Resumo
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat
            icon={<Users className="h-3.5 w-3.5" />}
            label="Indicações"
            value={`${carteira?.total_indicacoes ?? 0} ${
              (carteira?.total_indicacoes ?? 0) === 1 ? "amigo" : "amigos"
            }`}
          />
          <Stat
            label="Saldo disponível"
            value={BRL.format(carteira?.saldo_disponivel ?? 0)}
            highlight
          />
          <Stat label="Pendente" value={BRL.format(carteira?.saldo_pendente ?? 0)} />
          <Stat label="Reservado" value={BRL.format(carteira?.saldo_reservado ?? 0)} />
        </div>
      </section>

      {/* Próximo saque */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Clock className="h-3.5 w-3.5 text-primary" /> Próximo saque
        </div>
        <p className="text-sm text-foreground/90">{proximoSaqueMsg}</p>
        <button
          type="button"
          disabled={!podeSaque}
          onClick={() => setSaqueOpen(true)}
          className={
            podeSaque
              ? "glow-neon mt-3 w-full rounded-xl bg-gradient-to-r from-primary to-primary/80 px-3 py-3 text-sm font-semibold text-primary-foreground"
              : "mt-3 w-full cursor-not-allowed rounded-xl border border-border bg-muted/30 px-3 py-3 text-sm font-semibold text-muted-foreground opacity-70"
          }
          title={podeSaque ? "Solicitar PIX" : "Saldo abaixo do mínimo"}
        >
          {podeSaque ? "Solicitar PIX" : "Solicitar PIX — saldo insuficiente"}
        </button>
      </section>

      {/* Código */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Meu código de indicação
        </div>
        <div className="rounded-xl border border-border bg-background px-3 py-3 text-center font-mono text-base font-bold tracking-wider text-primary">
          {codigo ?? "—"}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!codigo}
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar código"}
          </button>
          <button
            type="button"
            onClick={handleWhats}
            disabled={!codigo}
            className="glow-neon flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
            WhatsApp
          </button>
        </div>
        {semIndicacoes && (
          <p className="mt-3 text-xs text-muted-foreground">
            Você ainda não possui indicações. Compartilhe seu código e ganhe R$ 5,00 a cada
            amigo que ativar o Jarvys.
          </p>
        )}
      </section>

      {/* Histórico */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Histórico
        </div>
        {movs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma movimentação por enquanto.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {movs.map((m) => (
              <MovimentacaoItem key={m.id} m={m} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  highlight,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={
          highlight
            ? "mt-1 text-lg font-bold text-primary"
            : "mt-1 text-sm font-semibold text-foreground"
        }
      >
        {value}
      </div>
    </div>
  );
}
