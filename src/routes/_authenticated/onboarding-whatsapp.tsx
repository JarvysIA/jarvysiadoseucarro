// Build 5.7D-EXEC — Rota de onboarding pós-cadastro para vínculo WhatsApp.
// Pré-preenche o número já informado em profiles.whatsapp. Após vínculo,
// sincroniza profiles.whatsapp usando o phone_e164 canônico lido de
// whatsapp_contacts (RLS). "Agora não" leva direto ao dashboard.
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { WhatsappLinkCard } from "@/components/WhatsappLinkCard";

export const Route = createFileRoute("/_authenticated/onboarding-whatsapp")({
  component: OnboardingWhatsappPage,
  head: () => ({
    meta: [
      { title: "Ative o Jarvys no WhatsApp" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function OnboardingWhatsappPage() {
  const navigate = useNavigate();
  const [initialPhone, setInitialPhone] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (!userId) {
        if (!cancel) setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("whatsapp")
        .eq("id", userId)
        .maybeSingle();
      if (cancel) return;
      setInitialPhone((data?.whatsapp as string | undefined) ?? "");
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  async function handleLinked({ contactId }: { contactId: string }) {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const userId = sess.session?.user.id;
      if (userId) {
        const { data: contact } = await supabase
          .from("whatsapp_contacts")
          .select("phone_e164")
          .eq("id", contactId)
          .maybeSingle();
        const canonical = (contact as { phone_e164?: string } | null)?.phone_e164;
        if (canonical) {
          await supabase
            .from("profiles")
            .update({ whatsapp: canonical })
            .eq("id", userId);
        }
      }
    } catch {
      // não bloqueia a navegação em caso de falha na sincronização
    }
    navigate({ to: "/dashboard" });
  }

  function handleSkip() {
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen bg-background px-6 pt-10 pb-12">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Bem-vindo ao Jarvys</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Ative agora o WhatsApp para receber lembretes e usar recursos
            inteligentes do app. Você também pode ativar depois em
            Configurações.
          </p>
        </div>
        {loading ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            Carregando...
          </div>
        ) : (
          <WhatsappLinkCard
            source="onboarding"
            initialPhone={initialPhone}
            allowSkip
            onLinked={handleLinked}
            onSkip={handleSkip}
          />
        )}
      </div>
    </div>
  );
}
