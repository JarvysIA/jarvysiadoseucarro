// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Public backend config must be baked into the client bundle deterministically.
// Without this, a bundle can be produced where `import.meta.env.VITE_SUPABASE_*` is
// undefined, and the app only fails later — at the first sign-in/sign-up click —
// with "Missing Supabase environment variable(s)".
const publicBackendUrl = process.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"] || "";
const publicBackendKey =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_PUBLISHABLE_KEY"] || "";

const isBuild = process.argv.includes("build");
if (isBuild && (!publicBackendUrl || !publicBackendKey)) {
  const missing = [
    ...(!publicBackendUrl ? ["VITE_SUPABASE_URL"] : []),
    ...(!publicBackendKey ? ["VITE_SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
  throw new Error(
    `[build] Missing public backend configuration: ${missing.join(", ")}. ` +
      "Refusing to emit a client bundle that would break sign-in and sign-up at runtime.",
  );
}

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(publicBackendUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publicBackendKey),
    },
  },
});
