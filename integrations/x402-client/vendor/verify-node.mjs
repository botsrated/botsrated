// Node Ed25519 + sha256 for spec/verify.mjs. Same checks as webcryptoDeps in verify-core.mjs.
import crypto from "node:crypto";

const edKey = (b64) => crypto.createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(b64, "base64")]),
  format: "der",
  type: "spki",
});

export function nodeDeps() {
  return {
    sha256: (b) => crypto.createHash("sha256").update(b).digest("hex"),
    ed25519(publicKeyB64, message, sigB64) {
      const data = typeof message === "string" ? Buffer.from(message) : Buffer.from(message);
      return crypto.verify(null, data, edKey(publicKeyB64), Buffer.from(sigB64, "base64"));
    },
  };
}
