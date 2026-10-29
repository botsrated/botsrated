// Browser entry for the receipt page. Same verifyReceipt as the CLI.
// No WebCrypto Ed25519 means signature invalid. The page does not claim a pass.
import { verifyReceipt, webcryptoDeps } from "./verify-core.mjs";
import { signatureStatus } from "./receipt-page.mjs";

export async function ed25519WebCryptoAvailable() {
  const subtle = globalThis.crypto && crypto.subtle;
  if (!subtle || typeof subtle.importKey !== "function" || typeof subtle.verify !== "function" || typeof subtle.digest !== "function") return false;
  try {
    const raw = new Uint8Array(32);
    raw[0] = 1;
    await subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    return true;
  } catch {
    return false;
  }
}

function keyOrigin() {
  const host = location.hostname;
  if (host === "botsrated.com" || host === "www.botsrated.com") return location.origin;
  return "https://botsrated.com";
}

export async function runReceiptPage() {
  const el = document.getElementById("status");
  if (!(await ed25519WebCryptoAvailable())) {
    el.textContent = signatureStatus(null, false);
    return;
  }
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
    el.textContent = signatureStatus(result, true);
  } catch {
    el.textContent = signatureStatus(null, false);
  }
}

if (typeof document !== "undefined") {
  const btn = document.getElementById("verify-btn");
  if (btn) btn.addEventListener("click", () => { runReceiptPage(); });
  if (document.getElementById("receipt-data")) runReceiptPage();
}
