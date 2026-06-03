import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Mail, Lock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { OAuthButtons } from "@/components/OAuthButtons";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar — Jarvys" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/app" });
  };

  return (
    <div className="relative min-h-screen bg-background px-6 pt-10 pb-12">
      <Link to="/welcome" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <div className="mt-8">
        <h1 className="text-3xl font-bold tracking-tight">Entrar</h1>
        <p className="mt-2 text-sm text-muted-foreground">Bem-vindo de volta à sua garagem.</p>
      </div>

      <div className="mt-8">
        <OAuthButtons />
      </div>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">ou com e-mail</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block rounded-2xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Mail className="h-4 w-4 text-primary" /> E-mail
          </div>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full bg-transparent text-base text-foreground focus:outline-none" />
        </label>
        <label className="block rounded-2xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Lock className="h-4 w-4 text-primary" /> Senha
          </div>
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-transparent text-base text-foreground focus:outline-none" />
        </label>

        <div className="text-right">
          <Link to="/forgot-password" className="text-xs text-primary underline-offset-2 hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        <button type="submit" disabled={loading}
          className="glow-neon mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Entrar
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Não tem conta?{" "}
          <Link to="/signup" className="text-primary underline-offset-2 hover:underline">
            Criar agora
          </Link>
        </p>
      </form>
    </div>
  );
}
