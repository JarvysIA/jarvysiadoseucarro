import { useEffect, useState } from "react";
import { Check, Loader2, Lock, Mail, MapPin, Phone, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { PasswordChecklist, isStrongPassword } from "@/components/PasswordChecklist";

type Props = {
  open: boolean;
  onClose: () => void;
};

type ProfileRow = {
  id: string;
  nome: string;
  email: string | null;
  whatsapp: string;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
};

function maskCep(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function ProfileSettingsModal({ open, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cep, setCep] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [cepLoading, setCepLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("id,nome,email,whatsapp,cep,cidade,uf")
        .eq("id", userId)
        .maybeSingle();
      if (cancel) return;
      const p = (data as ProfileRow | null) ?? null;
      setProfile(p);
      setEmail(p?.email || sess.session?.user.email || "");
      setWhatsapp(p?.whatsapp || "");
      setCep(p?.cep ? maskCep(p.cep) : "");
      setCidade(p?.cidade || "");
      setUf(p?.uf || "");
      setNewPassword("");
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [open]);

  // Lookup automático e silencioso no ViaCEP quando 8 dígitos completos.
  useEffect(() => {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    let cancel = false;
    setCepLoading(true);
    fetch(`https://viacep.com.br/ws/${digits}/json/`)
      .then((r) => r.json())
      .then((data: { localidade?: string; uf?: string; erro?: boolean }) => {
        if (cancel || data?.erro) return;
        if (data.localidade) setCidade(data.localidade);
        if (data.uf) setUf(data.uf);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancel) setCepLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [cep]);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const cepDigits = cep.replace(/\D/g, "") || null;
      const updates: {
        whatsapp: string;
        cep: string | null;
        cidade: string | null;
        uf: string | null;
        email?: string;
      } = {
        whatsapp: whatsapp.trim(),
        cep: cepDigits,
        cidade: cidade.trim() || null,
        uf: uf.trim().toUpperCase().slice(0, 2) || null,
      };
      if (email && email !== profile.email) updates.email = email.trim();

      const { error: upErr } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", profile.id);
      if (upErr) throw upErr;

      // Auth updates (email/senha)
      const authUpdates: { email?: string; password?: string } = {};
      if (email && email !== profile.email) authUpdates.email = email.trim();
      if (newPassword.trim().length > 0) {
        if (!isStrongPassword(newPassword.trim())) {
          toast.error("Senha fraca — atenda a todos os requisitos.");
          setSaving(false);
          return;
        }
        authUpdates.password = newPassword.trim();
      }
      if (Object.keys(authUpdates).length > 0) {
        const { error: authErr } = await supabase.auth.updateUser(authUpdates);
        if (authErr) throw authErr;
      }

      toast.success("Perfil atualizado!");
      onClose();
    } catch (e) {
      console.error("[ProfileSettings]", e);
      toast.error(e instanceof Error ? e.message : "Falha ao salvar perfil.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <UserIcon className="h-4 w-4 text-primary" />
            Configurações
          </DialogTitle>
          <DialogDescription className="text-left">
            Atualize seus dados de contato e segurança.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-4">
            <Field label="E-mail" icon={<Mail className="h-3.5 w-3.5" />}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </Field>

            <Field label="Nova senha (opcional)" icon={<Lock className="h-3.5 w-3.5" />}>
              <input
                type="password"
                placeholder="Deixe em branco para manter"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
              {newPassword.length > 0 && <PasswordChecklist password={newPassword} />}
            </Field>

            <Field label="WhatsApp" icon={<Phone className="h-3.5 w-3.5" />}>
              <input
                type="tel"
                placeholder="(11) 90000-0000"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </Field>

            <Field label="CEP" icon={<MapPin className="h-3.5 w-3.5" />}>
              <div className="flex items-center gap-2">
                <input
                  inputMode="numeric"
                  placeholder="00000-000"
                  value={cep}
                  onChange={(e) => setCep(maskCep(e.target.value))}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                />
                {cepLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              </div>
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="Cidade">
                  <input
                    type="text"
                    value={cidade}
                    onChange={(e) => setCidade(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
                  />
                </Field>
              </div>
              <Field label="UF">
                <input
                  type="text"
                  maxLength={2}
                  value={uf}
                  onChange={(e) => setUf(e.target.value.toUpperCase())}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm uppercase outline-none focus:border-primary"
                />
              </Field>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 rounded-xl border border-border px-3 py-3 text-xs font-medium text-muted-foreground disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || (newPassword.length > 0 && !isStrongPassword(newPassword))}
                className="glow-neon flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.7_0.18_250)] px-3 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}
