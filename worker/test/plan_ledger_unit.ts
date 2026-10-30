import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { listLedger, orgLedgerEnabled, recordReceiptRef } from "../src/ledger.ts";
import { planRefsFromBody, schedulePlanLedger, type PlanLedgerSource } from "../src/plan_ledger.ts";
import { openMem, type MemDb } from "./d1_mem.ts";

const ORG = "sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ORG_B = "sub_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const R1 = "62ea0ea566d9567cf2ca";
const R2 = "aaaaaaaaaaaaaaaaaaaa";
const R3 = "bbbbbbbbbbbbbbbbbbbb";
const R4 = "cccccccccccccccccccc";
const S1 = "5fc2f595bd0bec49ef95";
const S2 = "1111111111111111111a";
const S3 = "2222222222222222222b";
const S4 = "3333333333333333333c";
const BANNED = /\b(safe|trusted|verified|scam|grade)\b/i;
const MIGRATION = readFileSync(new URL("../../d1/migrate-0.23-org-ledger-DRAFT-NOT-APPLIED.sql", import.meta.url), "utf8");

function ready(): MemDb {
  const db = openMem();
  db.exec(MIGRATION);
  return db;
}

function ctxOf() {
  const tasks: Array<Promise<unknown>> = [];
  return { tasks, waitUntil(p: Promise<unknown>) { tasks.push(p); } };
}

const x402Url = (id: string, host: string, day = "2026-10-29", origin = "https://botsrated.com") =>
  `${origin}/receipt/${id}?host=${host}&day=${day}`;
const mcpUrl = (id: string, s: string, shard = 53, day = "2026-10-29") =>
  `https://botsrated.com/receipt/${id}?mcp=${shard}&day=${day}&s=${s}`;

function checkBody(host = "blockrun.ai") {
  return {
    host,
    receipts: [
      { id: R1, kind: "unpaid_probe", host, ts: "2026-10-29T19:16:30.000Z", receipt_url: x402Url(R1, host), quote: "do-not-store", live_payTo: "0xabc" },
      { id: R2, kind: "unpaid_probe", host, ts: "2026-10-29T18:00:00.000Z", receipt_url: x402Url(R2, host) },
    ],
    paid_receipts: [{ id: R3, kind: "paid_test_buy", receipt_url: `https://botsrated.com/receipt/${R3}`, tx_hash: "0xdead" }],
  };
}

async function run(db: MemDb, source: PlanLedgerSource, body: unknown, opts: { host?: string; origin?: string } = {}, org = ORG) {
  const ctx = ctxOf();
  schedulePlanLedger(ctx, db, { org_id: org }, source, body, opts);
  await Promise.all(ctx.tasks);
  return { ctx, rows: db.rows("SELECT org_id, source, host, receipt_kind, receipt_id, locator, key_id, agent_id, usage_event_id, receipt_sha256, measured_at FROM org_receipt_refs ORDER BY source, receipt_id") };
}

test("paid plan check with receipt_id writes the newest unpaid receipt only, never paid_receipts", async () => {
  const db = ready();
  const { ctx, rows } = await run(db, "plan_check", checkBody(), { host: "blockrun.ai" });
  assert.equal(ctx.tasks.length, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "plan_check");
  assert.equal(rows[0].receipt_id, R1);
  assert.equal(rows[0].receipt_kind, "unpaid_probe");
  assert.equal(rows[0].locator, "host=blockrun.ai&day=2026-10-29");
  assert.equal(rows[0].key_id, null);
  assert.equal(rows[0].agent_id, null);
  assert.equal(rows[0].usage_event_id, null);
  assert.equal(rows[0].measured_at, "2026-10-29T19:16:30.000Z");
  const blob = JSON.stringify(rows);
  for (const s of ["do-not-store", "0xabc", "0xdead", R3, "brs_"]) assert.equal(blob.includes(s), false);
});

test("anonymous (no org) does not schedule or write", async () => {
  const db = ready();
  for (const auth of [null, undefined, { org_id: "" }]) {
    const ctx = ctxOf();
    schedulePlanLedger(ctx, db, auth as { org_id: string } | null, "plan_check", checkBody(), { host: "blockrun.ai" });
    assert.equal(ctx.tasks.length, 0);
  }
  const bad = await run(db, "plan_check", checkBody(), { host: "blockrun.ai" }, "not-an-org");
  assert.equal(bad.rows.length, 0);
});

test("writes are ungated: FEATURE_ORG_LEDGER=false still writes (reads stay gated)", async () => {
  const env = { FEATURE_ORG_LEDGER: "false" };
  assert.equal(orgLedgerEnabled(env), false);
  const db = ready();
  const { rows } = await run(db, "plan_report", checkBody(), { host: "blockrun.ai" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "plan_report");
});

test("dedupe on (org, source, receipt_id); another source or org is a new row", async () => {
  const db = ready();
  await run(db, "plan_check", checkBody(), { host: "blockrun.ai" });
  await run(db, "plan_check", checkBody(), { host: "blockrun.ai" });
  await run(db, "plan_report", checkBody(), { host: "blockrun.ai" });
  await run(db, "plan_check", checkBody(), { host: "blockrun.ai" }, ORG_B);
  const rows = db.rows("SELECT org_id, source, receipt_id FROM org_receipt_refs ORDER BY org_id, source");
  assert.deepEqual(rows.map((r) => `${r.org_id}|${r.source}|${r.receipt_id}`), [
    `${ORG}|plan_check|${R1}`,
    `${ORG}|plan_report|${R1}`,
    `${ORG_B}|plan_check|${R1}`,
  ]);
});

test("cross-host, foreign origin, bad locator and id mismatch write nothing", async () => {
  const db = ready();
  const bodies = [
    { receipts: [{ id: R1, receipt_url: x402Url(R1, "evil.example") }] },
    { receipts: [{ id: R1, receipt_url: x402Url(R1, "blockrun.ai", "2026-10-29", "https://evil.example") }] },
    { receipts: [{ id: R1, receipt_url: `https://botsrated.com/receipt/${R1}?host=blockrun.ai&day=2026-10-29&ip=1` }] },
    { receipts: [{ id: R1, receipt_url: `https://botsrated.com/receipt/${R1}` }] },
    { receipts: [{ id: R2, receipt_url: x402Url(R1, "blockrun.ai") }] },
    { receipts: [{ id: R1, kind: "paid_test_buy", receipt_url: x402Url(R1, "blockrun.ai") }] },
    null,
    "junk",
  ];
  for (const body of bodies) await run(db, "plan_check", body, { host: "blockrun.ai" });
  assert.equal(db.rows("SELECT 1 FROM org_receipt_refs").length, 0);
});

test("request origin (pages.dev tip) is accepted when passed; www is folded", async () => {
  const db = ready();
  const origin = "https://a49fcdfd.botsrated.pages.dev";
  const body = { receipts: [{ id: R1, receipt_url: x402Url(R1, "blockrun.ai", "2026-10-29", origin) }] };
  const none = await run(db, "plan_check", body, { host: "blockrun.ai" });
  assert.equal(none.rows.length, 0);
  const { rows } = await run(db, "plan_check", body, { host: "www.blockrun.ai", origin });
  assert.equal(rows.length, 1);
});

test("MCP host check writes the newest mcp_probe per server, max 3", async () => {
  const db = ready();
  const host = "mcp.offendersearch.app";
  const body = {
    type: "mcp",
    host,
    receipts: [
      { id: R1, receipt_url: mcpUrl(R1, S1) },
      { id: R2, receipt_url: mcpUrl(R2, S1) },
      { id: R3, receipt_url: mcpUrl(R3, S2, 9) },
      { id: R4, receipt_url: mcpUrl(R4, S3, 7) },
      { id: "dddddddddddddddddddd", receipt_url: mcpUrl("dddddddddddddddddddd", S4) },
      { id: "eeeeeeeeeeeeeeeeeeee", receipt_url: `https://botsrated.com/receipt/eeeeeeeeeeeeeeeeeeee?mcp=53&day=2026-10-29` },
    ],
    paid_receipts: [],
  };
  const { rows } = await run(db, "plan_check", body, { host });
  assert.deepEqual(rows.map((r) => r.receipt_id).sort(), [R1, R3, R4]);
  assert.equal(rows.every((r) => r.receipt_kind === "mcp_probe" && r.host === host), true);
  assert.equal(rows.find((r) => r.receipt_id === R1)?.locator, `mcp=53&day=2026-10-29&s=${S1}`);
  const wrong = planRefsFromBody("plan_check", { ...body, host: "other.example" }, { host });
  assert.equal(wrong.length, 0);
});

test("best writes newest receipt per ranked host (max 3) plus MCP latest (max 3)", async () => {
  const db = ready();
  const hosts = ["a.example", "b.example", "c.example", "d.example"];
  const ids = [R1, R2, R3, R4];
  const body = {
    results: hosts.map((h, i) => ({ rank: i + 1, host: h, receipts: [{ id: ids[i], receipt_url: x402Url(ids[i], h) }, { id: "ffffffffffffffffff0" + i, receipt_url: x402Url("ffffffffffffffffff0" + i, h) }] })),
    mcp_results: [
      { host: "m1.example", latest_receipt_url: mcpUrl("10000000000000000001", S1) },
      { host: "m2.example", latest_receipt_url: null },
      { host: "m3.example", latest_receipt_url: mcpUrl("10000000000000000003", S2) },
      { host: "m4.example", latest_receipt_url: mcpUrl("10000000000000000004", S3) },
      { host: "m5.example", latest_receipt_url: mcpUrl("10000000000000000005", S4) },
    ],
  };
  const { rows } = await run(db, "plan_best", body);
  assert.equal(rows.length, 6);
  assert.equal(rows.every((r) => r.source === "plan_best"), true);
  assert.deepEqual(rows.filter((r) => r.receipt_kind === "unpaid_probe").map((r) => r.host).sort(), ["a.example", "b.example", "c.example"]);
  assert.deepEqual(rows.filter((r) => r.receipt_kind === "mcp_probe").map((r) => r.host).sort(), ["m1.example", "m3.example", "m4.example"]);
});

test("missing table and a thrown waitUntil do not escape", async () => {
  const empty = openMem();
  const ctx = ctxOf();
  schedulePlanLedger(ctx, empty, { org_id: ORG }, "plan_check", checkBody(), { host: "blockrun.ai" });
  await Promise.all(ctx.tasks);
  assert.doesNotThrow(() => {
    schedulePlanLedger({ waitUntil() { throw new Error("illegal invocation"); } }, ready(), { org_id: ORG }, "plan_check", checkBody(), { host: "blockrun.ai" });
  });
});

test("listLedger returns the stored plan source and filters by it; policy_check default unchanged", async () => {
  const db = ready();
  await run(db, "plan_check", checkBody(), { host: "blockrun.ai" });
  await recordReceiptRef(db, { org_id: ORG, host: "other.example", receipt_kind: "unpaid_probe", receipt_id: R4, day: "2026-10-29" });
  await recordReceiptRef(db, { org_id: ORG, host: "other.example", receipt_kind: "unpaid_probe", receipt_id: R3, day: "2026-10-29", source: "desk_rollup" as never });
  const all = await listLedger(db, { org_id: ORG });
  assert.equal(all.ok, true);
  if (!all.ok) return;
  assert.deepEqual(all.items.map((i) => i.source).sort(), ["plan_check", "policy_check"]);
  const only = await listLedger(db, { org_id: ORG, source: "plan_check" });
  assert.equal(only.ok && only.items.length === 1 && only.items[0].receipt_id === R1, true);
  const bad = await listLedger(db, { org_id: ORG, source: "preflight_attributed" });
  assert.equal(bad.ok, false);
});

test("plan hook copy avoids banned words and never reads paid_receipts or bearer text", () => {
  const src = readFileSync(new URL("../src/plan_ledger.ts", import.meta.url), "utf8");
  assert.equal(BANNED.test(src), false);
  assert.match(src, /ctx\.waitUntil/);
  assert.equal(src.includes("const { waitUntil"), false);
  assert.equal(/body\.paid_receipts|\.authorization|headers\.get/.test(src), false);
  assert.equal(src.includes("preflight_attributed"), false);
});
