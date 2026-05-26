import { useState } from "react";
import { Sparkles, Send, X } from "lucide-react";

export function ChatFab() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([
    { role: "ai", text: "Olá! Sou o Jarvys. Como posso ajudar com seu carro hoje?" },
  ]);
  const [input, setInput] = useState("");

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [
      ...m,
      { role: "user", text },
      { role: "ai", text: "Entendi! Em breve eu vou poder responder isso de verdade." },
    ]);
    setInput("");
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
            <span className="block text-sm font-medium text-foreground">Pergunte sobre seu carro…</span>
          </span>
          <span className="text-xs text-primary">Abrir</span>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm">
          <div className="glow-neon mx-auto flex h-[78vh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Jarvys IA</p>
                  <p className="text-[11px] text-muted-foreground">Online</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground"
                  }`}
                >
                  {m.text}
                </div>
              ))}
            </div>

            <form onSubmit={send} className="flex items-center gap-2 border-t border-border px-4 py-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Mande uma mensagem…"
                className="h-11 flex-1 rounded-xl bg-secondary px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="submit"
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
