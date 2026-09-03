import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Lock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PasswordChecklist, isStrongPassword } from "@/components/PasswordChecklist";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Nova senha — Jarvys" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isStrongPassword(password)) {
      toast.error("Use uma senha forte (mínimo 8 caracteres, com maiúscula, minúscula, número e caractere especial).");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Senha atualizada!");
      navigate({ to: "/app" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível conectar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background px-6 pt-10 pb-12">
      <div className="mt-8">
        <h1 className="text-3xl font-bold tracking-tight">Nova senha</h1>
        <p className="mt-2 text-sm text-muted-foreground">Defina sua nova senha de acesso.</p>
      </div>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block rounded-2xl border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Lock className="h-4 w-4 text-primary" /> Nova senha
          </div>
          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-transparent text-base text-foreground focus:outline-none"
          />
        </label>
        <PasswordChecklist password={password} />

        <button
          type="submit"
          disabled={loading || !isStrongPassword(password)}
          className="glow-neon mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Salvar nova senha
        </button>
      </form>
    </div>
  );
}
