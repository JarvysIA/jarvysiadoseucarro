import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export function OAuthButtons() {
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);

  const signIn = async (provider: "google" | "apple") => {
    setLoading(provider);
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: `${window.location.origin}/app`,
    });
    if (result.error) {
      toast.error(result.error.message || "Não foi possível entrar.");
      setLoading(null);
      return;
    }
    if (result.redirected) return;
    window.location.href = "/app";
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => signIn("google")}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-card py-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
      >
        {loading === "google" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GoogleIcon className="h-5 w-5" />
        )}
        Continuar com Google
      </button>
      <button
        type="button"
        onClick={() => signIn("apple")}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-foreground py-3.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {loading === "apple" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <AppleIcon className="h-5 w-5" />
        )}
        Continuar com Apple
      </button>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.6 39.6 16.3 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.42 2.21-1.26 3.04-.85.84-1.96 1.32-2.99 1.24-.13-1.1.4-2.24 1.18-3.07.84-.88 2.13-1.5 3.07-1.21zM20.5 17.27c-.55 1.27-.82 1.84-1.54 2.96-1 1.57-2.42 3.53-4.17 3.55-1.56.02-1.96-1.02-4.07-1.01-2.11.02-2.55 1.03-4.11 1.01-1.76-.02-3.1-1.79-4.1-3.36-2.79-4.4-3.08-9.56-1.36-12.3 1.22-1.95 3.15-3.09 4.96-3.09 1.84 0 3 1.01 4.52 1.01 1.48 0 2.38-1.02 4.51-1.02 1.61 0 3.32.88 4.54 2.4-3.99 2.19-3.34 7.89.82 9.85z" />
    </svg>
  );
}
