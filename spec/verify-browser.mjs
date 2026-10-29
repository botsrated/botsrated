// Browser entry for the receipt page. Same verifyReceipt as the CLI.
import { verifyReceipt, webcryptoDeps } from "./verify-core.mjs";

function keyOrigin() {
  const host = location.hostname;
  if (host === "botsrated.com" || host === "www.botsrated.com") return location.origin;
  return "https://botsrated.com";
}

export async function runReceiptPage() {
  const el = document.getElementById("status");
  const raw = JSON.parse(document.getElementById("receipt-data").textContent);
  const origin = keyOrigin();
  let keyset;
  try {
    const res = await fetch(origin + "/.well-known/botsrated-key", { credentials: "omit" });
    if (!res.ok) throw new Error(String(res.status));
    keyset = await res.json();
  } catch {
    el.textContent = "key unknown";
    return;
  }
  const deps = webcryptoDeps();
  deps.loadSnapshot = async () => {
    const [bytes, sig] = await Promise.all([
      fetch(origin + "/dataset.json", { credentials: "omit" }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }),
      fetch(origin + "/dataset.sig.json", { credentials: "omit" }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
    ]);
    return { bytes: new Uint8Array(bytes), sig };
  };
  try {
    const result = await verifyReceipt(raw, keyset, deps);
    el.textContent = result.status;
  } catch {
    el.textContent = "signature invalid";
  }
}

const btn = document.getElementById("verify-btn");
if (btn) btn.addEventListener("click", () => { runReceiptPage(); });
runReceiptPage();
