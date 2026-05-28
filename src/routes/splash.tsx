import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import logo from "@/assets/jarvys-logo.png";
import { loadUser } from "@/lib/jarvys-store";

export const Route = createFileRoute("/splash")({
  head: () => ({
    meta: [
      { title: "Jarvys — A IA do seu carro" },
      { name: "description", content: "Jarvys: monitore a saúde do seu carro com inteligência artificial." },
    ],
  }),
  component: Splash,
});

const STATUS_MESSAGES = [
  "Abrindo sua Garagem...",
  "Verificando revisões...",
  "Sincronizando despesas...",
  "Ligando os motores...",
];

const SPLASH_DURATION_MS = 2000;
const FADE_DURATION_MS = 500;

function Splash() {
  const navigate = useNavigate();
  const [statusIdx, setStatusIdx] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const stepMs = SPLASH_DURATION_MS / STATUS_MESSAGES.length;
    const rotator = setInterval(() => {
      setStatusIdx((i) => (i + 1) % STATUS_MESSAGES.length);
    }, stepMs);

    const fadeTimer = setTimeout(() => setFadeOut(true), SPLASH_DURATION_MS);
    const navTimer = setTimeout(() => {
      const user = loadUser();
      navigate({ to: user ? "/home" : "/welcome", replace: true });
    }, SPLASH_DURATION_MS + FADE_DURATION_MS);

    return () => {
      clearInterval(rotator);
      clearTimeout(fadeTimer);
      clearTimeout(navTimer);
    };
  }, [navigate]);

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black px-6 transition-opacity"
      style={{
        opacity: fadeOut ? 0 : 1,
        transitionDuration: `${FADE_DURATION_MS}ms`,
      }}
    >
      {/* Logo com respiração */}
      <div className="relative flex flex-col items-center">
        <img
          src={logo}
          alt="Jarvys"
          width={520}
          height={520}
          className="w-64 max-w-[70vw] animate-breathing-glow"
        />

        {/* Scan line / barra de progresso */}
        <div className="mt-6 h-px w-48 overflow-hidden bg-[rgba(56,189,248,0.15)]">
          <div className="h-full w-1/3 animate-scan-line bg-[#38BDF8] shadow-[0_0_10px_#38BDF8]" />
        </div>
      </div>

      {/* Status rotativo na base */}
      <div className="absolute bottom-12 left-0 right-0 flex justify-center">
        <p
          key={statusIdx}
          className="font-tech text-neon-white animate-fade-in text-[10px] font-medium tracking-widest opacity-80"
        >
          {STATUS_MESSAGES[statusIdx]}
        </p>
      </div>
    </div>
  );
}
