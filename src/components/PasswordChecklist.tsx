import { Check, Circle } from "lucide-react";

export type PasswordRules = {
  length: boolean;
  upper: boolean;
  lower: boolean;
  number: boolean;
  special: boolean;
};

export function evaluatePassword(pw: string): PasswordRules {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}

export function isStrongPassword(pw: string): boolean {
  const r = evaluatePassword(pw);
  return r.length && r.upper && r.lower && r.number && r.special;
}

const ITEMS: { key: keyof PasswordRules; label: string }[] = [
  { key: "length", label: "Mínimo 8 caracteres" },
  { key: "upper", label: "1 Letra Maiúscula" },
  { key: "lower", label: "1 Letra Minúscula" },
  { key: "number", label: "1 Número" },
  { key: "special", label: "1 Caractere Especial" },
];

export function PasswordChecklist({ password }: { password: string }) {
  const rules = evaluatePassword(password);
  return (
    <ul className="mt-2 grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
      {ITEMS.map((it) => {
        const ok = rules[it.key];
        return (
          <li
            key={it.key}
            className={`flex items-center gap-1.5 transition-colors ${
              ok ? "text-green-500" : "text-muted-foreground"
            }`}
          >
            {ok ? (
              <Check className="h-3 w-3" />
            ) : (
              <Circle className="h-3 w-3" />
            )}
            <span>{it.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
