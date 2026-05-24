import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, User, Mail, Phone, Hash } from "lucide-react";
import { saveUser } from "@/lib/jarvys-store";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Cadastro — Jarvys" }] }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", plate: "" });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveUser({ ...form, plate: form.plate.toUpperCase() });
    navigate({ to: "/home" });
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="relative min-h-screen bg-background px-6 pt-10 pb-12">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
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
          <input
            required
            value={form.name}
            onChange={set("name")}
            placeholder="Seu nome completo"
            className="w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </Field>
        <Field icon={<Mail className="h-4 w-4" />} label="E-mail">
          <input
            required
            type="email"
            value={form.email}
            onChange={set("email")}
            placeholder="voce@email.com"
            className="w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </Field>
        <Field icon={<Phone className="h-4 w-4" />} label="Celular">
          <input
            required
            type="tel"
            value={form.phone}
            onChange={set("phone")}
            placeholder="(11) 99999-9999"
            className="w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </Field>
        <Field icon={<Hash className="h-4 w-4" />} label="Placa do carro">
          <input
            required
            value={form.plate}
            onChange={set("plate")}
            placeholder="ABC-1D23"
            maxLength={8}
            className="w-full bg-transparent text-base uppercase tracking-widest text-foreground placeholder:text-muted-foreground placeholder:normal-case focus:outline-none"
          />
        </Field>

        <button
          type="submit"
          className="glow-neon mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          Entrar na garagem
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
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
