import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { schedulePolicyLedger, onPolicyOrPlanDeleted, type PolicyLedgerItem } from "../src/policy_ledger.ts";
import { openMem, type MemDb } from "./d1_mem.ts";

const ORG = "sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const X402 = "62ea0ea566d9567cf2ca";
const MCP_ID = "1f72a38fff44a6d3ae74";
const SERVER = "5fc2f595bd0bec49ef95";
const BANNED = /\b(safe|trusted|verified|scam|grade)\b/i;
const MIGRATION = readFileSync(new URL("../../d1/migrate-0.23-org-ledger-DRAFT-NOT-APPLIED.sql", import.meta.url), "utf8");

function ready(): MemDb {
  const db = openMem();
  db.exec(MIGRATION);
  db.exec(`CREATE TABLE mcp_servers (
    host TEXT NOT NULL,
    id TEXT NOT NULL,
    shard INTEGER NOT NULL,
    last_receipt_id TEXT,
    last_receipt_day TEXT,
    last_probe_at TEXT
  )`);
  return db;
}

function ctxOf() {
  const tasks: Array<Promise<unknown>> = [];
  return {
    tasks,
    waitUntil(promise: Promise<unknown>) {
      tasks.push(promise);
    },
  };
}

async function run(db: MemDb, items: PolicyLedgerItem[], keyId: string | null = "key_abcdef0123456789") {
  const ctx = ctxOf();
  schedulePolicyLedger(ctx, db, { org_id: ORG, agent_id: "ag_abcdef0123456789", key_id: keyId }, items);
  assert.equal(ctx.tasks.length, 1);
  await ctx.tasks[0];
  return db.rows("SELECT org_id, source, host, receipt_kind, receipt_id, locator, key_id, usage_event_id, receipt_sha256 FROM org_receipt_refs ORDER BY receipt_id");
}

test("x402 comes from Facts.latest and MCP is not used when latest is present", async () => {
  const db = ready();
  db.exec(`INSERT INTO mcp_servers (host, id, shard, last_receipt_id, last_receipt_day, last_probe_at)
    VALUES ('blockrun.ai', '${SERVER}', 53, '${MCP_ID}', '2026-10-29', '2026-10-29T19:00:00.000Z')`);
  const rows = await run(db, [{
    decided: true,
    host: "blockrun.ai",
    usage_event_id: "ue_abcdef0123456789",
    facts: {
      latest: {
        id: X402,
        ts: "2026-10-29T19:16:30.000Z",
        day: "2026-10-29",
        sha256: "ab".repeat(32),
        quote: "do-not-store",
        payTo: "0xabc",
        ip: "203.0.113.5",
        body: "raw body",
      } as { id: string; ts: string; day: string; sha256: string },
    },
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "policy_check");
  assert.equal(rows[0].receipt_kind, "unpaid_probe");
  assert.equal(rows[0].receipt_id, X402);
  assert.equal(rows[0].locator, "host=blockrun.ai&day=2026-10-29");
  assert.equal(rows[0].usage_event_id, "ue_abcdef0123456789");
  assert.equal(rows[0].receipt_sha256, "ab".repeat(32));
  const blob = JSON.stringify(rows);
  assert.equal(blob.includes("do-not-store"), false);
  assert.equal(blob.includes("0xabc"), false);
  assert.equal(blob.includes("203.0.113.5"), false);
  assert.equal(blob.includes("raw body"), false);
});

test("MCP lookup runs when Facts.latest is null", async () => {
  const db = ready();
  db.exec(`INSERT INTO mcp_servers (host, id, shard, last_receipt_id, last_receipt_day, last_probe_at) VALUES
    ('mcp.offendersearch.app', '${SERVER}', 53, '${MCP_ID}', '2026-10-29', '2026-10-29T18:00:00.000Z'),
    ('mcp.offendersearch.app', 'aaaaaaaaaaaaaaaaaaaa', 9, 'bbbbbbbbbbbbbbbbbbbb', '2026-10-28', '2026-10-28T18:00:00.000Z')`);
  const rows = await run(db, [{
    decided: true,
    host: "mcp.offendersearch.app",
    facts: { latest: null },
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].receipt_kind, "mcp_probe");
  assert.equal(rows[0].receipt_id, MCP_ID);
  assert.equal(rows[0].locator, "mcp=53&day=2026-10-29&s=" + SERVER);
  assert.equal(rows[0].host, "mcp.offendersearch.app");
});

test("batch writes one ref per decided item and none for refused", async () => {
  const db = ready();
  const rows = await run(db, [
    { decided: true, host: "blockrun.ai", facts: { latest: { id: X402, day: "2026-10-29", ts: "2026-10-29T19:16:30.000Z" } } },
    { decided: false, host: "refused.example", facts: { latest: { id: "aaaaaaaaaaaaaaaaaaaa", day: "2026-10-29" } } },
    { decided: true, host: "other.example", facts: { latest: { id: "bbbbbbbbbbbbbbbbbbbb", day: "2026-10-29", ts: "2026-10-29T20:00:00.000Z" } } },
    { decided: true, host: "blockrun.ai", facts: { latest: { id: X402, day: "2026-10-29" } } },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.receipt_id).sort(), [X402, "bbbbbbbbbbbbbbbbbbbb"]);
});

test("a bearer is not stored and a thrown waitUntil does not escape", async () => {
  const db = ready();
  const rows = await run(db, [{
    decided: true,
    host: "blockrun.ai",
    facts: { latest: { receipt_url: "https://botsrated.com/receipt/" + X402 + "?host=blockrun.ai&day=2026-10-29" } },
  }], "brk_thismustnotpersist");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key_id, null);
  assert.equal(rows[0].receipt_id, X402);
  assert.equal(JSON.stringify(rows).includes("brk_"), false);

  assert.doesNotThrow(() => {
    schedulePolicyLedger(
      { waitUntil() { throw new Error("illegal invocation"); } },
      db,
      { org_id: ORG, key_id: null },
      [{ decided: true, host: "blockrun.ai", facts: { latest: { id: X402, day: "2026-10-29" } } }],
    );
  });
});

test("missing tables and a mismatched latest host do not throw or write", async () => {
  const empty = openMem();
  const ctx = ctxOf();
  schedulePolicyLedger(ctx, empty, { org_id: ORG }, [{
    decided: true,
    host: "blockrun.ai",
    facts: { latest: null },
  }]);
  await ctx.tasks[0];

  const db = ready();
  const rows = await run(db, [{
    decided: true,
    host: "blockrun.ai",
    facts: { latest: { id: X402, day: "2026-10-29", host: "evil.example" } },
  }]);
  assert.equal(rows.length, 0);
});

test("deletePolicy / plan-cancel removes only that org", async () => {
  const db = ready();
  await run(db, [{ decided: true, host: "blockrun.ai", facts: { latest: { id: X402, day: "2026-10-29" } } }]);
  db.exec(`INSERT INTO org_receipt_refs (id, org_id, source, host, receipt_kind, receipt_id, locator, at)
    VALUES ('orr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'sub_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'policy_check', 'other.example', 'unpaid_probe', 'bbbbbbbbbbbbbbbbbbbb', 'host=other.example&day=2026-10-29', '2026-10-29T00:00:00.000Z')`);
  await onPolicyOrPlanDeleted(db, ORG);
  const left = db.rows("SELECT org_id FROM org_receipt_refs");
  assert.deepEqual(left.map((row) => row.org_id), ["sub_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);
});

test("hook copy stays off public trees and avoids banned words", () => {
  const src = readFileSync(new URL("../src/policy_ledger.ts", import.meta.url), "utf8");
  assert.equal(BANNED.test(src), false);
  assert.match(src, /ctx\.waitUntil/);
  assert.equal(src.includes("const { waitUntil"), false);
  assert.match(src, /onPolicyOrPlanDeleted/);
  assert.equal(src.includes("usage_events"), true);
  assert.equal(src.includes("INSERT INTO usage_events"), false);
  assert.equal(src.includes("preflight_attributed"), true);
  const root = new URL("../..", import.meta.url);
  const hits: string[] = [];
  for (const dir of ["spec", "integrations"]) {
    walk(new URL(dir + "/", root), (file) => {
      if (!/\.(mjs|js|ts|py|md)$/.test(file)) return;
      const text = readFileSync(file, "utf8");
      if (text.includes("policy_ledger") || text.includes("org_receipt_refs") || text.includes("listLedger")) hits.push(file);
    });
  }
  assert.deepEqual(hits, []);
});

function walk(dir: URL, visit: (file: string) => void) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".venv") continue;
    const path = join(dir.pathname, name);
    if (statSync(path).isDirectory()) walk(new URL(name + "/", dir), visit);
    else visit(path);
  }
}
