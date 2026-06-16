import { ShieldCheck } from "lucide-react";
import { maskCpf } from "@/lib/cpf";

/**
 * Input de CPF Just-in-Time exibido quando o usuário ainda não cadastrou.
 * Texto fixo: "CPF (Exigência do Banco Central para PIX)".
 */
export function CpfJustInTimeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-background/40 p-3">
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
        <ShieldCheck className="h-3 w-3" />
        CPF (Exigência do Banco Central para PIX)
      </label>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(maskCpf(e.target.value))}
        placeholder="000.000.000-00"
        className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary disabled:opacity-60"
      />
    </div>
  );
}
