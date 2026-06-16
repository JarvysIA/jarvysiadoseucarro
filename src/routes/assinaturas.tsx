import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, AlertCircle, Car, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/assinaturas")({
  component: AssinaturasPage,
});

type Row = {
  id: string;
  veiculo_id: string | null;
  status: string;
  data_vencimento: string;
  veiculo?: { placa: string; marca: string | null; modelo: string | null } | null;
};

function AssinaturasPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/login" });
        return;
      }
      const { data, error } = await supabase
        .from("assinaturas")
        .select(
          "id, veiculo_id, status, data_vencimento, veiculo:veiculos(placa,marca,modelo)",
        )
        .order("created_at", { ascending: false });
      if (!error && data) setRows(data as unknown as Row[]);
      setLoading(false);
    })();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => navigate({ to: "/app" })}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-foreground"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="font-tech text-base font-bold tracking-wide text-primary">
          Minhas assinaturas
        </h1>
      </header>

      <main className="px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Você ainda não tem assinaturas ativas.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const venc = new Date(r.data_vencimento);
              const ativa = r.status === "ativo" && venc.getTime() > Date.now();
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                      ativa ? "bg-status-ok/15 text-status-ok" : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {ativa ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                  </span>
                  <div className="flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Car className="h-4 w-4 text-primary" />
                      {r.veiculo
                        ? `${r.veiculo.marca ?? ""} ${r.veiculo.modelo ?? ""} · ${r.veiculo.placa}`
                        : "Mensalidade (veículo a vincular)"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {ativa ? "Renova em" : "Venceu em"}{" "}
                      {venc.toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      ativa
                        ? "bg-status-ok/15 text-status-ok"
                        : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {ativa ? "Ativa" : "Expirada"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
