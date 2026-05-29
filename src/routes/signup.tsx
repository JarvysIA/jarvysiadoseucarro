import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, User, Mail, Phone, Hash, Lock, Loader2 } from "lucide-react";
import { saveUser } from "@/lib/jarvys-store";
import { supabase } from "@/integrations/supabase/client";
import { CarConfirmModal } from "@/components/CarConfirmModal";
import { lookupPlate } from "@/lib/plate-lookup";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Cadastro — Jarvys" }] }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", plate: "" });
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const plate = form.plate.toUpperCase();

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/app`,
          data: { nome: form.name, whatsapp: form.phone },
        },
      });

      if (signUpError) {
        // Tenta login se já existir
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        });
        if (signInError || !signInData.user) {
          toast.error(signUpError.message);
          setLoading(false);
          return;
        }
        setUserId(signInData.user.id);
      } else if (signUpData.user) {
        setUserId(signUpData.user.id);
      }

      const uid = signUpData?.user?.id;
      if (uid) {
        const { error: profileError } = await supabase.from("profiles").upsert({
          id: uid,
          nome: form.name,
          whatsapp: form.phone,
          email: form.email.trim(),
          placa: plate,
          status_usuario: "trial",
          permite_indicacao: false,
        });
        if (profileError) {
          toast.error("Erro ao salvar perfil: " + profileError.message);
          setLoading(false);
          return;
        }
      }

      saveUser({ name: form.name, email: form.email, phone: form.phone, plate });
      setModalOpen(true);
    } catch (err) {
      toast.error("Falha no cadastro. Tente novamente.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCar = async (data: {
    marca: string;
    modelo: string;
    ano: string;
    motorizacao: string;
    km_atual: number | null;
  }) => {
    const { data: session } = await supabase.auth.getSession();
    const uid = userId ?? session.session?.user.id;
    if (!uid) {
      toast.error("Sessão expirada. Faça login.");
      return;
    }
    const { error } = await supabase.from("veiculos").insert({
      user_id: uid,
      placa: form.plate.toUpperCase(),
      marca: data.marca,
      modelo: data.modelo,
      ano: data.ano,
      motorizacao: data.motorizacao,
      km_atual: data.km_atual,
    });
    if (error) {
      toast.error("Erro ao salvar veículo: " + error.message);
      return;
    }
    setModalOpen(false);
    navigate({ to: "/app" });
  };

  return (
    <div className="relative min-h-screen bg-background px-6 pt-10 pb-12">
      <Link to="/welcome" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      <div className="mt-8">
        <h1 className="text-3xl font-bold tracking-tight">Criar conta</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Vamos conhecer você e seu carro.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field icon={<User className="h-4 w-4" />} label="Nome">
          <input required value={form.name} onChange={set("name")} placeholder="Seu nome completo"
            className="w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none" />
        </Field>
        <Field icon={<Mail className="h-4 w-4" />} label="E-mail">
          <input required type="email" value={form.email} onChange={set("email")} placeholder="voce@email.com"
            className="w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none" />
        </Field>
        <Field icon={<Phone className="h-4 w-4" />} label="WhatsApp">
          <input required type="tel" value={form.phone} onChange={set("phone")} placeholder="(11) 99999-9999"
            className="w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none" />
        </Field>
        <Field icon={<Lock className="h-4 w-4" />} label="Senha">
          <input required type="password" minLength={6} value={form.password} onChange={set("password")} placeholder="Mínimo 6 caracteres"
            className="w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none" />
        </Field>
        <Field icon={<Hash className="h-4 w-4" />} label="Placa do carro">
          <input required value={form.plate} onChange={set("plate")} placeholder="ABC-1D23" maxLength={8}
            className="w-full bg-transparent text-base uppercase tracking-widest text-foreground placeholder:text-muted-foreground placeholder:normal-case focus:outline-none" />
        </Field>

        <button type="submit" disabled={loading}
          className="glow-neon mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {loading ? "Criando conta..." : "Entrar na garagem"}
        </button>
      </form>

      <CarConfirmModal
        open={modalOpen}
        plate={form.plate}
        lookup={lookupPlate}
        onConfirm={handleConfirmCar}
      />
    </div>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <label className="block rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </label>
  );
}
