import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CarteiraJarvys } from "@/components/CarteiraJarvys";

export const Route = createFileRoute("/carteira")({
  head: () => ({ meta: [{ title: "Minha Carteira Jarvys" }] }),
  component: CarteiraPage,
});

function CarteiraPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancel) return;
      if (!data.session) {
        navigate({ to: "/login" });
        return;
      }
      setReady(true);
    })();
    return () => {
      cancel = true;
    };
  }, [navigate]);

  if (!ready) return null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-background px-4 pb-24 pt-6 text-foreground">
      <button
        type="button"
        onClick={() => navigate({ to: "/app" })}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Voltar
      </button>
      <CarteiraJarvys />
    </main>
  );
}
