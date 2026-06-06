import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, X } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useActiveVehicleId } from "@/lib/active-vehicle";
import { jarvysChatFn, type ChatMsg, type JarvysPlanTier } from "@/lib/jarvys-chat.functions";

type VehicleCtx = {
  marca: string | null;
  modelo: string | null;
  ano: string | null;
  km: number | null;
};

function storageKey(vehicleId: string | null) {
  return `jarvys_chat_${vehicleId ?? "none"}`;
}

function loadHistory(vehicleId: string | null): ChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(vehicleId));
    return raw ? (JSON.parse(raw) as ChatMsg[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(vehicleId: string | null, msgs: ChatMsg[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(vehicleId), JSON.stringify(msgs.slice(-40)));
  } catch {
    /* ignore */
  }
}

export function ChatFab() {
  const [open, setOpen] = useState(false);
  const activeVehicleId = useActiveVehicleId();
  const [vehicle, setVehicle] = useState<VehicleCtx | null>(null);
  const [planTier, setPlanTier] = useState<JarvysPlanTier | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chat = useServerFn(jarvysChatFn);

  // Fetch current user's plan tier
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) {
        if (!cancel) setPlanTier(null);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("plan_tier")
        .eq("id", uid)
        .maybeSingle();
      if (cancel) return;
      const tier = (data as { plan_tier?: JarvysPlanTier } | null)?.plan_tier ?? "free";
      setPlanTier(tier);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  // Fetch active vehicle context
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!activeVehicleId) {
        setVehicle(null);
        return;
      }
      const { data } = await supabase
        .from("veiculos")
        .select("marca,modelo,ano,km_atual")
        .eq("id", activeVehicleId)
        .maybeSingle();
      if (cancel) return;
      setVehicle(
        data
          ? { marca: data.marca, modelo: data.modelo, ano: data.ano, km: data.km_atual }
          : null,
      );
    })();
    return () => {
      cancel = true;
    };
  }, [activeVehicleId]);

  // Load per-vehicle history when opening / switching
  useEffect(() => {
    if (!open) return;
    const hist = loadHistory(activeVehicleId);
    if (hist.length) {
      setMessages(hist);
    } else {
      const modelo = vehicle?.modelo?.trim() || "seu veículo";
      setMessages([
        {
          role: "assistant",
          content: `Olá! Como posso ajudar com o seu ${modelo} hoje?`,
        },
      ]);
    }
  }, [open, activeVehicleId, vehicle?.modelo]);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const userMsg: ChatMsg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setSending(true);
    try {
      const { reply } = await chat({
        data: {
          messages: next,
          vehicle: vehicle
            ? {
                marca: vehicle.marca,
                modelo: vehicle.modelo,
                ano: vehicle.ano,
                km: vehicle.km,
              }
            : null,
        },
      });
      const aiMsg: ChatMsg = { role: "assistant", content: reply };
      const finalMsgs = [...next, aiMsg];
      setMessages(finalMsgs);
      saveHistory(activeVehicleId, finalMsgs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha na conexão.";
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${msg}` }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="glow-neon fixed bottom-24 left-1/2 z-40 flex h-14 w-[88%] max-w-sm -translate-x-1/2 items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left transition-transform active:scale-[0.99]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="flex-1">
            <span className="block text-xs text-muted-foreground">Jarvys IA</span>
            <span className="block text-sm font-medium text-foreground">
              Pergunte sobre seu carro…
            </span>
          </span>
          <span className="text-xs text-primary">Abrir</span>
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="h-[92vh] flex flex-col gap-0 border-t border-primary/40 bg-card p-0 rounded-t-3xl"
          style={{ boxShadow: "0 -20px 60px -20px rgba(56,189,248,0.35)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary"
                style={{ boxShadow: "0 0 18px -4px rgba(56,189,248,0.7)" }}
              >
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Jarvys IA</p>
                <p className="text-[11px] text-muted-foreground">
                  {vehicle?.modelo
                    ? `${vehicle.marca ?? ""} ${vehicle.modelo} ${vehicle.ano ?? ""}`.trim()
                    : "Mecânico particular"}
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-secondary text-foreground"
                      : "text-primary-foreground"
                  }`}
                  style={
                    m.role === "assistant"
                      ? {
                          background:
                            "linear-gradient(135deg, rgba(56,189,248,0.18), rgba(56,189,248,0.08))",
                          border: "1px solid rgba(56,189,248,0.35)",
                          color: "#E0F2FE",
                          boxShadow: "0 0 14px -6px rgba(56,189,248,0.55)",
                        }
                      : undefined
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && <TypingBubble />}
          </div>

          {/* Input */}
          <form
            onSubmit={send}
            className="flex items-center gap-2 border-t border-border bg-card/95 px-4 py-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte algo sobre seu carro…"
              disabled={sending}
              className="h-11 flex-1 rounded-xl bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Enviar"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              style={{ boxShadow: "0 0 18px -4px rgba(56,189,248,0.7)" }}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start">
      <div
        className="flex items-center gap-1.5 rounded-2xl px-4 py-3"
        style={{
          background:
            "linear-gradient(135deg, rgba(56,189,248,0.18), rgba(56,189,248,0.08))",
          border: "1px solid rgba(56,189,248,0.35)",
        }}
      >
        <span className="sr-only">Jarvys está digitando</span>
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-2 w-2 rounded-full bg-primary"
      style={{
        animation: "jarvys-bounce 1s infinite ease-in-out",
        animationDelay: delay,
        boxShadow: "0 0 8px rgba(56,189,248,0.8)",
      }}
    />
  );
}
