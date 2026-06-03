import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Mail, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Recuperar senha — Jarvys" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
    toast.success("Enviamos um link de recuperação para seu e-mail.");
  };

  return (
    <div className="relative min-h-screen bg-background px-6 pt-10 pb-12">
      <Link to="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <div className="mt-8">
        <h1 className="text-3xl font-bold tracking-tight">Esqueci minha senha</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Informe seu e-mail e enviaremos um link para redefinir.
        </p>
      </div>

      {sent ? (
        <div className="mt-8 rounded-2xl border border-primary/40 bg-primary/10 p-5 text-sm text-foreground">
          Verifique sua caixa de entrada — o link de recuperação foi enviado para{" "}
          <span className="font-semibold text-primary">{email}</span>.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label className="block rounded-2xl border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Mail className="h-4 w-4 text-primary" /> E-mail
            </div>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full bg-transparent text-base text-foreground focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="glow-neon mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Enviar link
          </button>
        </form>
      )}
    </div>
  );
}
