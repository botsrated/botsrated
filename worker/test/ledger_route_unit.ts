import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { handleOrgLedger, type ResolveOrgAuth } from "../src/ledger_route.ts";
import { deskReceiptDay, readOrgLedger } from "../src/ledger.ts";
import { recordReceiptRef } from "../src/ledger.ts";
import { openMem, type MemDb } from "./d1_mem.ts";

const ORG_A = "sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ORG_B = "sub_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const RID = "62ea0ea566d9567cf2ca";
const BANNED = /\b(safe|trusted|verified|scam|grade)\b/i;
const MIGRATION = readFileSync(new URL("../../d1/migrate-0.23-org-ledger-DRAFT-NOT-APPLIED.sql", import.meta.url), "utf8");

function db(): MemDb {
  const mem = openMem();
  mem.exec(MIGRATION);
  mem.exec(`CREATE TABLE desk_alert_rollups (
    org_id TEXT NOT NULL,
    rollup_key TEXT NOT NULL,
    host TEXT NOT NULL,
    event_at TEXT NOT NULL,
    receipt_id TEXT
  )`);
  mem.exec(`CREATE TABLE usage_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    rail TEXT NOT NULL,
    kind TEXT NOT NULL,
    units INTEGER NOT NULL DEFAULT 1,
    host TEXT,
    at TEXT NOT NULL
  )`);
  return mem;
}

function env(mem: MemDb, flag: string) {
  return { FEATURE_ORG_LEDGER: flag, DB: mem };
}

function request(url: string, token?: string): Request {
  const headers = new Headers();
  if (token != null) headers.set("authorization", token);
  return new Request(url, { headers });
}

const paid: ResolveOrgAuth = async () => ({ org_id: ORG_A, agent_id: null, key_id: "key_abcdef0123456789" });

test("flag off is 501 coming before auth, including with no token", async () => {
  let called = false;
  const resolve: ResolveOrgAuth = async () => {
    called = true;
    return { org_id: ORG_A };
  };
  const mem = db();
  for (const flag of ["false", "TRUE", "1", ""]) {
    const res = await handleOrgLedger(request("https://botsrated.com/v1/org/ledger"), env(mem, flag), resolve);
    assert.equal(res.status, 501);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
    const body = await res.json() as { error: string };
    assert.equal(body.error, "coming");
  }
  const withToken = await handleOrgLedger(
    request("https://botsrated.com/v1/org/ledger", "Bearer brs_example"),
    env(mem, "false"),
    resolve,
  );
  assert.equal(withToken.status, 501);
  assert.equal(called, false);
});

test("flag on and no token is 401 paid_plan_token_required", async () => {
  const res = await handleOrgLedger(request("https://botsrated.com/v1/org/ledger"), env(db(), "true"), paid);
  assert.equal(res.status, 401);
  const body = await res.json() as { error: string };
  assert.equal(body.error, "paid_plan_token_required");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex");
});

test("alerts-free and expired responses from planWho pass through", async () => {
  const resolve: ResolveOrgAuth = async (_req, _env, opts) => {
    assert.equal(opts.need, "check");
    return new Response(JSON.stringify({ error: "plan_not_paid", plan: "alerts-free" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  };
  const res = await handleOrgLedger(
    request("https://botsrated.com/v1/org/ledger", "Bearer brs_free"),
    env(db(), "true"),
    resolve,
  );
  assert.equal(res.status, 403);
  const body = await res.json() as { error: string; plan: string };
  assert.equal(body.error, "plan_not_paid");
  assert.equal(body.plan, "alerts-free");
  assert.equal(res.headers.get("x-robots-tag"), "noindex");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("paid org ledger shape, desk full locator, usage totals, and org isolation", async () => {
  const mem = db();
  await recordReceiptRef(mem, {
    org_id: ORG_A,
    host: "blockrun.ai",
    receipt_kind: "unpaid_probe",
    receipt_id: RID,
    day: "2026-10-29",
    at: "2026-10-29T19:16:30.000Z",
    id: "orr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    receipt_sha256: "cd".repeat(32),
    measured_at: "2026-10-29T19:16:30.000Z",
  });
  await recordReceiptRef(mem, {
    org_id: ORG_B,
    host: "secret.example",
    receipt_kind: "unpaid_probe",
    receipt_id: "bbbbbbbbbbbbbbbbbbbb",
    day: "2026-10-29",
    at: "2026-10-29T21:00:00.000Z",
    id: "orr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  mem.exec(`INSERT INTO desk_alert_rollups (org_id, rollup_key, host, event_at, receipt_id) VALUES
    ('${ORG_A}', 'r1', 'blockrun.ai', '2026-10-29T18:00:00.000Z', 'cccccccccccccccccccc'),
    ('${ORG_B}', 'r2', 'secret.example', '2026-10-29T22:00:00.000Z', 'dddddddddddddddddddd')`);
  mem.exec(`INSERT INTO usage_events (id, org_id, rail, kind, units, host, at) VALUES
    ('ue_aaaaaaaa', '${ORG_A}', 'free', 'policy_check', 2, 'blockrun.ai', '2026-10-29T19:16:30.000Z'),
    ('ue_bbbbbbbb', '${ORG_B}', 'free', 'policy_check', 9, 'secret.example', '2026-10-29T21:00:00.000Z')`);

  const res = await handleOrgLedger(
    request("https://evil.example/v1/org/ledger?org_id=" + ORG_B + "&limit=50", "Bearer brs_paid"),
    env(mem, "true"),
    paid,
  );
  assert.equal(res.status, 200);
  const body = await res.json() as {
    org_id: string;
    signed: boolean;
    not_a_botsrated_rating: boolean;
    note: string;
    items: Array<Record<string, unknown>>;
    usage_totals: Array<{ kind: string; rail: string; units: number }>;
    next_cursor: string | null;
  };
  assert.equal(body.org_id, ORG_A);
  assert.equal(body.signed, false);
  assert.equal(body.not_a_botsrated_rating, true);
  assert.equal(BANNED.test(JSON.stringify(body)), false);
  assert.equal(body.items.some((item) => JSON.stringify(item).includes("secret.example")), false);
  assert.equal(body.usage_totals.length, 1);
  assert.equal(body.usage_totals[0].units, 2);
  assert.equal(body.usage_totals[0].kind, "policy_check");
  const desk = body.items.find((item) => item.source === "desk_rollup");
  assert.ok(desk);
  assert.equal(desk.receipt_url, "https://botsrated.com/receipt/cccccccccccccccccccc?host=blockrun.ai&day=2026-10-29");
  assert.equal(String(desk.receipt_url).includes("?"), true);
  assert.equal(String(desk.receipt_url).endsWith("/receipt/cccccccccccccccccccc"), false);
  const policy = body.items.find((item) => item.source === "policy_check");
  assert.equal(policy?.receipt_sha256, "cd".repeat(32));
  assert.equal("id" in (policy ?? {}), false);
  assert.equal(body.items.every((item) => item.receipt_url && String(item.receipt_url).startsWith("https://botsrated.com/receipt/")), true);

  const day = deskReceiptDay({ event_at: "2026-10-29T18:00:00.000Z" });
  assert.equal(day, "2026-10-29");
  assert.equal(deskReceiptDay({ receipt_day: "2026-10-01", event_at: "2026-10-29T18:00:00.000Z" }), "2026-10-01");
});

test("cursor is org bound across refs and rollups", async () => {
  const mem = db();
  await recordReceiptRef(mem, {
    org_id: ORG_A,
    host: "blockrun.ai",
    receipt_kind: "unpaid_probe",
    receipt_id: RID,
    day: "2026-10-29",
    at: "2026-10-29T19:00:00.000Z",
    id: "orr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  mem.exec(`INSERT INTO desk_alert_rollups (org_id, rollup_key, host, event_at, receipt_id) VALUES
    ('${ORG_A}', 'r1', 'blockrun.ai', '2026-10-29T20:00:00.000Z', 'aaaaaaaaaaaaaaaaaaaa')`);
  const first = await readOrgLedger(mem, { org_id: ORG_A, limit: 1 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].source, "desk_rollup");
  assert.ok(first.next_cursor);
  const second = await readOrgLedger(mem, { org_id: ORG_A, limit: 1, cursor: first.next_cursor });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].source, "policy_check");
  const crossed = await readOrgLedger(mem, { org_id: ORG_B, cursor: first.next_cursor });
  assert.deepEqual(crossed, { ok: false, error: "invalid_cursor" });
});

test("limit above 200 is rejected and public trees do not import the ledger", async () => {
  const res = await handleOrgLedger(
    request("https://botsrated.com/v1/org/ledger?limit=201", "Bearer brs_example"),
    env(db(), "true"),
    paid,
  );
  assert.equal(res.status, 400);
  const hits: string[] = [];
  const root = new URL("../..", import.meta.url);
  for (const dir of ["spec", "integrations"]) {
    walk(new URL(dir + "/", root), (file) => {
      if (!/\.(mjs|js|ts|py|md)$/.test(file)) return;
      const text = readFileSync(file, "utf8");
      if (text.includes("ledger_route") || text.includes("readOrgLedger") || text.includes("/v1/org/ledger")) hits.push(file);
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
