// Ambient shim para o runner nativo `bun test`.
// Evita instalar `bun-types` (Build 6.42F veta dependências novas)
// e permite `import { describe, test, expect } from "bun:test"`.
declare module "bun:test" {
  export const describe: (name: string, fn: () => void) => void;
  export const test: (name: string, fn: () => void | Promise<void>) => void;
  type Matchers = {
    toBe: (expected: unknown) => void;
    toContain: (expected: unknown) => void;
    not: {
      toBe: (expected: unknown) => void;
      toContain: (expected: unknown) => void;
    };
  };
  export const expect: (value: unknown) => Matchers;
}
