// Dev-only smoke UI for Build 5.7C1/C2 (WhatsApp link request + confirm).
// Remove after smoke test completes.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  requestWhatsappLinkCodeFn,
  confirmWhatsappLinkCodeFn,
} from "@/lib/whatsapp-link.functions";

export const Route = createFileRoute("/dev-wa-link")({
  component: DevWaLinkPage,
  head: () => ({ meta: [{ title: "Dev WA Link" }] }),
});

function DevWaLinkPage() {
  const requestFn = useServerFn(requestWhatsappLinkCodeFn);
  const confirmFn = useServerFn(confirmWhatsappLinkCodeFn);
  const [phone, setPhone] = useState("+5521972540805");
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [out, setOut] = useState<string>("");

  async function doRequest() {
    setOut("...requesting");
    try {
      const r = await requestFn({
        data: { phone, consentGeneralAccepted: true, source: "app_settings" },
      });
      setOut(JSON.stringify(r, null, 2));
      if ((r as { ok?: boolean; verificationId?: string }).ok && (r as { verificationId?: string }).verificationId) {
        setVerificationId((r as { verificationId: string }).verificationId);
      }
    } catch (e) {
      setOut("ERR: " + String(e));
    }
  }

  async function doConfirm() {
    setOut("...confirming");
    try {
      const r = await confirmFn({ data: { verificationId, code } });
      setOut(JSON.stringify(r, null, 2));
    } catch (e) {
      setOut("ERR: " + String(e));
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace", color: "#eee", background: "#111", minHeight: "100vh" }}>
      <h1>WA Link smoke</h1>
      <div style={{ display: "grid", gap: 8, maxWidth: 480 }}>
        <label>Phone <input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: "100%" }} /></label>
        <button onClick={doRequest} style={{ padding: 8 }}>1) Request code</button>
        <label>verificationId <input value={verificationId} onChange={(e) => setVerificationId(e.target.value)} style={{ width: "100%" }} /></label>
        <label>code (6 dígitos) <input value={code} onChange={(e) => setCode(e.target.value)} style={{ width: "100%" }} /></label>
        <button onClick={doConfirm} style={{ padding: 8 }}>2) Confirm</button>
        <pre style={{ background: "#000", padding: 12, whiteSpace: "pre-wrap" }}>{out}</pre>
      </div>
    </div>
  );
}
