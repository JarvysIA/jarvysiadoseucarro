// Public backend configuration, versioned on purpose.
//
// Both values below are PUBLIC by design: the backend URL and the publishable
// (anon) key are meant to ship in the browser bundle. No admin/service secret
// belongs in this file.
//
// Why it is versioned: builds that run outside this sandbox may not have the
// VITE_SUPABASE_* environment variables available. Without a versioned
// fallback, the client bundle is emitted with an undefined configuration and
// the app only fails later, at the first sign-in/sign-up click, with
// "Missing Supabase environment variable(s)".
//
// Verified to point at the same backend used by the rest of the project
// (project ref embedded in the publishable key matches the URL).
export const PUBLIC_BACKEND_URL = "https://thbbyjyefozrznocihso.supabase.co";
export const PUBLIC_BACKEND_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoYmJ5anllZm96cnpub2NpaHNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMTQ1NDgsImV4cCI6MjA5NTU5MDU0OH0.fAZ3RPOSRYf3ckrfB9ELo4gXUuD2NLT3b5hAjvs81v4";
export const PUBLIC_BACKEND_PROJECT_REF = "thbbyjyefozrznocihso";
