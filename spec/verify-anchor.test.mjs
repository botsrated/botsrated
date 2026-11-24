// Offline tests for spec/verify-anchor.mjs (no network). Run: node spec/verify-anchor.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { merkleRoot, checkAnchor, leafCandidates, dayOf } from "./verify-anchor.mjs";
import { canon } from "./verify-core.mjs";
const sha = (b) => new Uint8Array(createHash("sha256").update(b).digest());
const hex = (b) => Buffer.from(b).toString("hex");
const deps0 = { sha256Bytes: async (b) => sha(b) };
// RFC 6962: empty tree, one leaf, three leaves (split 2+1)
assert.equal(await merkleRoot([], deps0), hex(sha(new Uint8Array(0))));
const L = ["a", "b", "c"].map((s) => hex(sha(Buffer.from(s))));
const node = (x) => sha(Buffer.concat([Buffer.from([0]), Buffer.from(x, "hex")]));
const inner = (l, r) => sha(Buffer.concat([Buffer.from([1]), Buffer.from(l), Buffer.from(r)]));
assert.equal(await merkleRoot([L[0]], deps0), hex(node(L[0])));
assert.equal(await merkleRoot(L, deps0), hex(inner(inner(node(L[0]), node(L[1])), node(L[2]))));
// A record found in a synthetic day
const rec = { id: "0123456789abcdef0123", kind: "paid_test_buy", ts: "2026-11-23T19:15:00.421Z", tx_hash: "0xab", tx_url: "https://basescan.org/tx/0xab", sig: { key_id: "k", sig_b64: "AA==" } };
const leafH = hex(sha(Buffer.from(canon(rec))));
const leaves = [{ s: "receipt", id: rec.id, h: leafH }, { s: "receipt", id: "x", h: L[0] }];
const root = await merkleRoot(leaves.map((l) => l.h), deps0);
const head = { v: "botsrated-anchor-1", day: "2026-11-23", leaf_count: 2, merkle_root: root, prev_anchor: "p" };
const doc = { ...head, status: "final", anchor: hex(sha(Buffer.from(canon(head)))) };
const deps = { ...deps0, fetchJson: async (p) => p.endsWith("/leaves") ? { merkle_root: root, leaves } : doc };
const served = { receipt: { ...rec, receipt_url: "https://botsrated.com/receipt/x", payment: "hint", signature: "hint" } };
assert.equal(dayOf(served), "2026-11-23");
assert.ok(leafCandidates(served).length >= 2);
const ok = await checkAnchor(served, deps);
assert.equal(ok.ok, true, ok.lines.join("\n"));
const bad = await checkAnchor({ receipt: { ...served.receipt, tx_hash: "0xac" } }, deps);
assert.equal(bad.ok, false);
const old = await checkAnchor({ ...rec, ts: "2026-11-01T00:00:00Z" }, deps);
assert.equal(old.ok, null);
console.log("verify-anchor tests passed");
