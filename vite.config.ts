/// <reference types="node" />
// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import {
  PUBLIC_BACKEND_URL,
  PUBLIC_BACKEND_PUBLISHABLE_KEY,
  PUBLIC_BACKEND_PROJECT_REF,
} from "./src/config/public-backend";

// Public backend config must be baked into the client bundle deterministically.
// Without this, a bundle can be produced where `import.meta.env.VITE_SUPABASE_*` is
// undefined, and the app only fails later — at the first sign-in/sign-up click —
// with "Missing Supabase environment variable(s)".
// Environment wins when present; the versioned public values are the fallback so
// builds outside this sandbox can never emit an unconfigured bundle.
const publicBackendUrl =
  process.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"] || PUBLIC_BACKEND_URL;
const publicBackendKey =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
  process.env["SUPABASE_PUBLISHABLE_KEY"] ||
  PUBLIC_BACKEND_PUBLISHABLE_KEY;

if (!publicBackendUrl || !publicBackendKey) {
  throw new Error(
    "[build] Public backend configuration resolved empty. Check src/config/public-backend.ts.",
  );
}
if (!publicBackendUrl.includes(PUBLIC_BACKEND_PROJECT_REF)) {
  throw new Error(
    "[build] Public backend URL does not match the expected project. Refusing to build against a different backend.",
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
