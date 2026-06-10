import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, User, Mail, Phone, Hash, Lock, Loader2 } from "lucide-react";
import { saveUser } from "@/lib/jarvys-store";
import { supabase } from "@/integrations/supabase/client";
import { CarConfirmModal } from "@/components/CarConfirmModal";
import { lookupPlate, sanitizePlate, isValidPlate } from "@/lib/plate-lookup";
import { getStoredRef, resolveReferrerId, clearStoredRef } from "@/lib/referral";
import { toast } from "sonner";
import { OAuthButtons } from "@/components/OAuthButtons";
import { fireWelcomeWebhook, normalizePhoneBR } from "@/lib/welcome-webhook";
import { PasswordChecklist, isStrongPassword } from "@/components/PasswordChecklist";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Cadastro — Jarvys" }] }),
  component: SignupPage,
});

type CarDraft = {
  marca: string;
  modelo: string;
  ano: string;
  cor: string;
  motorizacao: string;
  chassi: string;
  km_atual: number | null;
};

function SignupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", plate: "" });
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [hasReferrer, setHasReferrer] = useState(false);

  useEffect(() => {
    setHasReferrer(!!getStoredRef());
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Botão principal: valida o formulário e abre o modal do veículo.
  // NÃO cria conta nem salva nada ainda.
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const plate = sanitizePlate(form.plate);
    if (!isValidPlate(plate)) {
      toast.error("Placa inválida. Use o formato AAA0000 ou AAA0A00.");
      return;
    }
    if (!form.name.trim() || !form.email.trim() || !isStrongPassword(form.password)) {
      toast.error("Preencha todos os campos e use uma senha forte.");
      return;
    }
    setModalOpen(true);
  };

  // Modal: ao confirmar o carro, executamos toda a sequência:
  // 1) Cria conta no Auth (trigger cria profile com nome/whatsapp/placa)
  // 2) Garante sessão / pega user_id
  // 3) Atualiza referrer_id se houver
  // 4) Insere veículo vinculado ao user_id
  const handleConfirmCar = async (car: CarDraft) => {
    if (loading) return;
    setLoading(true);
    const plate = sanitizePlate(form.plate);
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const ensureProfileExists = async (user: { id: string; email?: string | null }) => {
      const profilePayload = {
        id: user.id,
        nome: form.name.trim(),
        whatsapp: form.phone.trim(),
        email: user.email ?? form.email.trim(),
        placa: plate,
      };

      for (let attempt = 0; attempt < 6; attempt++) {
        const { data: existingProfile, error: readError } = await supabase
          .from("profiles")
          .select("id")
          .eq("id", user.id)
          .maybeSingle();

        if (existingProfile?.id) {
          const { error: updateError } = await supabase
            .from("profiles")
            .update(profilePayload)
            .eq("id", user.id);
          if (updateError) throw updateError;
          return;
        }

        if (readError) throw readError;

        const { error: insertProfileError } = await supabase.from("profiles").insert(profilePayload);
        if (!insertProfileError || insertProfileError.code === "23505") return;

        if (attempt === 5) throw insertProfileError;
        await wait(250);
      }
    };

    try {
      // Step 1: cria a conta no Supabase Auth (auto-confirm ativo → sessão imediata)
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/app`,
          data: {
            full_name: form.name,
            phone: form.phone,
            placa: plate,
          },
        },
      });

      if (signUpError) {
        // Email já existente → tenta login com a mesma senha
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        });
        if (signInError || !signInData.user) {
          toast.error(signUpError.message);
          return;
        }
      } else if (!signUpData.session) {
        // Sem sessão imediata (ex.: confirmação por e-mail ligada) → faz login
        await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        });
      }

      // Step 2: aguarda a sessão estar realmente disponível (auth.uid() válido)
      let authenticatedUser: { id: string; email?: string | null } | null = null;
      for (let i = 0; i < 10; i++) {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (!userError && user?.id) {
          authenticatedUser = user;
          break;
        }
        await wait(150);
      }
      if (!authenticatedUser) {
        throw new Error("Usuário não autenticado no Supabase");
      }

      // Step 2.1: garante que o profile exista antes do veículo (FK veiculos_user_id_fkey)
      await ensureProfileExists(authenticatedUser);

      // Step 2.2: referência (padrinho), se houver
      const refCode = getStoredRef();
      if (refCode) {
        const referrerId = await resolveReferrerId(refCode);
        if (referrerId) {
          await supabase.from("profiles").update({ referrer_id: referrerId }).eq("id", authenticatedUser.id);
        }
      }

      // Step 3: insere o veículo já com o user_id autenticado (= auth.uid())
      const { data: { user }, error: finalUserError } = await supabase.auth.getUser();
      if (finalUserError || !user?.id) {
        throw new Error("Usuário não autenticado no Supabase");
      }
      console.log("[signup] usuário autenticado antes de inserir veículo:", user);

      const { error: vehErr } = await supabase.from("veiculos").insert({
        user_id: user.id,
        placa: plate,
        marca: car.marca,
        modelo: car.modelo,
        ano: car.ano,
        cor: car.cor,
        motorizacao: car.motorizacao,
        chassi: car.chassi || null,
        km_atual: car.km_atual,
      });
      if (vehErr) {
        console.error("[veiculos.insert] erro:", vehErr);
        toast.error(`Erro ao salvar veículo: ${vehErr.message}${vehErr.code ? ` (${vehErr.code})` : ""}`);
        return;
      }

      // Step 4: normaliza telefone (E.164) e persiste no profile
      const whatsappE164 = normalizePhoneBR(form.phone);
      if (whatsappE164) {
        await supabase.from("profiles").update({ whatsapp: whatsappE164 }).eq("id", user.id);
      }

      // Step 5: dispara webhook de boas-vindas (não-bloqueante)
      void fireWelcomeWebhook({
        user_id: user.id,
        nome: form.name.trim(),
        email: form.email.trim(),
        whatsapp: whatsappE164,
        placa: plate,
        marca: car.marca,
        modelo: car.modelo,
        ano: car.ano,
        cor: car.cor,
      });

      // Step 6: sucesso → limpa estado e vai para a Dashboard
      saveUser({ name: form.name, email: form.email, phone: whatsappE164, plate });
      clearStoredRef();
      setModalOpen(false);
      setForm({ name: "", email: "", phone: "", password: "", plate: "" });
      toast.success("Conta criada e veículo salvo!");
      navigate({ to: "/dashboard" });
    } catch (err: any) {
      console.error("[signup] exceção:", err);
      toast.error(`Falha no cadastro: ${err?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
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
        {hasReferrer && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
            🎉 Desconto de indicado aplicado — ative por R$ 19,90
          </div>
        )}
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
          <input required type="password" minLength={8} value={form.password} onChange={set("password")} placeholder="Crie uma senha forte"
            className="w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none" />
        </Field>
        <PasswordChecklist password={form.password} />
        <Field icon={<Hash className="h-4 w-4" />} label="Placa do carro">
          <input
            required
            value={form.plate}
            onChange={(e) =>
              setForm((f) => ({ ...f, plate: sanitizePlate(e.target.value) }))
            }
            placeholder="ABC1D23"
            maxLength={7}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-full bg-transparent text-base uppercase tracking-widest text-foreground placeholder:text-muted-foreground placeholder:normal-case focus:outline-none"
          />
        </Field>

        <button type="submit" disabled={loading || !isStrongPassword(form.password)}
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
