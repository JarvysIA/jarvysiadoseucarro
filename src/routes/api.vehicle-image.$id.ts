import { createFileRoute } from "@tanstack/react-router";

function byteaToBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  if (typeof value !== "string") return null;

  if (value.startsWith("\\x")) {
    const hex = value.slice(2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export const Route = createFileRoute("/api/vehicle-image/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as any;
        const { data, error } = await db
          .from("vehicle_images_blob")
          .select("image_data")
          .eq("vehicle_id", params.id)
          .maybeSingle();

        if (error) {
          console.error("[vehicle-image] API lookup failed:", error);
          return new Response("Image lookup failed", { status: 500 });
        }

        const bytes = byteaToBytes(data?.image_data);
        if (!bytes?.byteLength) {
          console.warn("[vehicle-image] API image not found:", params.id);
          return new Response("Image not found", { status: 404 });
        }

        return new Response(bytes, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});