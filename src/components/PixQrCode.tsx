import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface PixQrCodeProps {
  base64?: string | null;
  copiaCola: string;
  size?: number;
}

export function PixQrCode({ base64, copiaCola, size = 220 }: PixQrCodeProps) {
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);

  const directSrc = base64
    ? base64.startsWith("data:")
      ? base64
      : `data:image/png;base64,${base64}`
    : null;

  useEffect(() => {
    if (directSrc || !copiaCola) {
      setFallbackSrc(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(copiaCola, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setFallbackSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFallbackSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [directSrc, copiaCola, size]);

  const src = directSrc ?? fallbackSrc;
  if (!src) return null;

  return (
    <div className="flex justify-center">
      <img
        src={src}
        alt="QR Code PIX"
        width={size}
        height={size}
        className="rounded-md border border-border bg-white p-2"
      />
    </div>
  );
}
