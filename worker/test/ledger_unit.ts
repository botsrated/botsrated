import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DELETE_REFS_SQL,
  INSERT_REF_SQL,
  LEDGER_NOTE,
  buildLocator,
  dayOf,
  deleteOrgReceiptRefs,
  deskReceiptDay,
  listLedger,
  orgLedgerEnabled,
  receiptUrl,
  recordReceiptRef,
  type RecordReceiptRefInput,
} from "../src/ledger.ts";
import { openMem } from "./d1_mem.ts";

const ORG_A = "sub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ORG_B = "sub_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const RID = "62ea0ea566d9567cf2ca";
const RID_MCP = "1f72a38fff44a6d3ae74";
const SHA = "74a5" + "ab".repeat(30);
const BANNED = /\b(safe|trusted|verified|scam|grade)\b/i;

function base(over: Partial<RecordReceiptRefInput> = {}): RecordReceiptRefInput {
  return {
    org_id: ORG_A,
    host: "blockrun.ai",
    receipt_kind: "unpaid_probe",
    receipt_id: RID,
    day: "2026-10-29",
    at: "2026-10-29T19:16:30.000Z",
    id: "orr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...over,
  };
}

test("migration is additive CREATE IF NOT EXISTS and has no money or ALTER", () => {
  const sql = readFileSync(new URL("../../d1/migrate-0.23-org-ledger-DRAFT-NOT-APPLIED.sql", import.meta.url), "utf8");
  assert.match(sql, /DRAFT-NOT-APPLIED/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS org_receipt_refs/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS orr_dedupe/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS orr_org_at/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS orr_org_host/);
  const ddl = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(ddl, /\bALTER\b/i);
  assert.doesNotMatch(ddl, /\bDROP\b/i);
  assert.doesNotMatch(ddl, /\bbalance\b/i);
  assert.doesNotMatch(ddl, /\bamount\b/i);
  assert.doesNotMatch(ddl, /\bstripe\b/i);
  assert.doesNotMatch(ddl, /\bcustody\b/i);
  const db = openMem();
  db.exec(sql);
  db.exec(sql);
  const tables = db.rows("SELECT name FROM sqlite_master WHERE name = 'org_receipt_refs'");
  assert.equal(tables.length, 1);
});

test("flag is the exact string true", () => {
  assert.equal(orgLedgerEnabled({ FEATURE_ORG_LEDGER: "true" }), true);
  assert.equal(orgLedgerEnabled({ FEATURE_ORG_LEDGER: "false" }), false);
  assert.equal(orgLedgerEnabled({}), false);
  assert.equal(orgLedgerEnabled({ FEATURE_ORG_LEDGER: "TRUE" }), false);
  assert.equal(orgLedgerEnabled({ FEATURE_ORG_LEDGER: "1" }), false);
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /FEATURE_ORG_LEDGER = "false"/);
});

test("buildLocator and receiptUrl stay on the allowlist", () => {
  assert.equal(buildLocator({ kind: "unpaid_probe", host: "Blockrun.AI", day: "2026-10-29" }), "host=blockrun.ai&day=2026-10-29");
  assert.equal(
    receiptUrl(RID, "day=2026-10-29&host=blockrun.ai"),
    "https://botsrated.com/receipt/" + RID + "?host=blockrun.ai&day=2026-10-29",
  );
  assert.equal(
    buildLocator({ kind: "mcp_probe", mcp: "53", day: "2026-10-29", s: "5fc2f595bd0bec49ef95" }),
    "mcp=53&day=2026-10-29&s=5fc2f595bd0bec49ef95",
  );
  assert.equal(
    receiptUrl(RID_MCP, "s=5fc2f595bd0bec49ef95&day=2026-10-29&mcp=53"),
    "https://botsrated.com/receipt/" + RID_MCP + "?mcp=53&day=2026-10-29&s=5fc2f595bd0bec49ef95",
  );
  assert.equal(buildLocator({ kind: "unpaid_probe", host: "not a host", day: "2026-10-29" }), null);
  assert.equal(buildLocator({ kind: "unpaid_probe", host: "blockrun.ai", day: "10/29/2026" }), null);
  assert.equal(buildLocator({ kind: "mcp_probe", mcp: "1234567", day: "2026-10-29", s: "5fc2f595bd0bec49ef95" }), null);
  assert.equal(buildLocator({ kind: "mcp_probe", mcp: "53", day: "2026-10-29", s: "zzzz" }), null);
  assert.equal(receiptUrl("not-an-id", "host=blockrun.ai&day=2026-10-29"), "");
  assert.equal(receiptUrl(RID, "https://evil.example/receipt/" + RID + "?host=blockrun.ai&day=2026-10-29"), "");
  assert.equal(receiptUrl(RID, "host=blockrun.ai&day=2026-10-29&note=hello"), "");
  assert.equal(receiptUrl(RID, "host=blockrun.ai&day=2026-10-29&host=evil.com"), "");
  assert.equal(receiptUrl(RID, "host=blockrun.ai"), "");
});

test("desk day prefers a stored day, else the UTC day of event_at", () => {
  assert.equal(deskReceiptDay({ receipt_day: "2026-10-28", event_at: "2026-10-29T23:00:00.000Z" }), "2026-10-28");
  assert.equal(deskReceiptDay({ day: "2026-10-27", event_at: "2026-10-29T23:00:00.000Z" }), "2026-10-27");
  assert.equal(deskReceiptDay({ event_at: "2026-10-29T23:10:00.000Z" }), "2026-10-29");
  assert.equal(deskReceiptDay({ receipt_day: "yesterday", event_at: "2026-10-29T00:00:00.000Z" }), "2026-10-29");
  assert.equal(dayOf("2026-10-29T19:16:30.000Z"), "2026-10-29");
  assert.equal(dayOf("nope"), null);
});

test("copy has no banned whole words", () => {
  const note = LEDGER_NOTE;
  const env = readFileSync(new URL("../src/env.ts", import.meta.url), "utf8");
  const src = readFileSync(new URL("../src/ledger.ts", import.meta.url), "utf8");
  assert.equal(BANNED.test(note), false);
  assert.match(note, /unsigned/);
  assert.equal(BANNED.test(env), false);
  assert.equal(BANNED.test(src), false);
});

test("recordReceiptRef writes one row and dedupes on org, source, receipt", async () => {
  const db = openMem();
  db.exec(readFileSync(new URL("../../d1/migrate-0.23-org-ledger-DRAFT-NOT-APPLIED.sql", import.meta.url), "utf8"));
  await recordReceiptRef(db, base({
    agent_id: "ag_abcdef0123456789",
    key_id: "key_abcdef0123456789",
    receipt_sha256: "0x" + SHA,
    measured_at: "2026-10-29T19:16:30.000Z",
    usage_event_id: "ue_abcdef0123456789",
  }));
  await recordReceiptRef(db, base({ id: "orr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
  await recordReceiptRef(db, base({
    org_id: ORG_B,
    id: "orr_cccccccccccccccccccccccccccccccc",
  }));
  const rows = db.rows("SELECT org_id, source, receipt_id, locator, receipt_sha256, key_id, agent_id, usage_event_id FROM org_receipt_refs ORDER BY org_id");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].org_id, ORG_A);
  assert.equal(rows[0].source, "policy_check");
  assert.equal(rows[0].locator, "host=blockrun.ai&day=2026-10-29");
  assert.equal(rows[0].receipt_sha256, SHA);
  assert.equal(rows[0].key_id, "key_abcdef0123456789");
  assert.equal(rows[1].org_id, ORG_B);
});

test("a bearer key id is not stored", async () => {
  const db = openMem();
  db.exec(readFileSync(new URL("../../d1/migrate-0.23-org-ledger-DRAFT-NOT-APPLIED.sql", import.meta.url), "utf8"));
  const bearer = "brk_secretbearersecretbearer";
  await recordReceiptRef(db, base({ key_id: bearer }));
  const rows = db.rows("SELECT key_id, receipt_sha256, locator FROM org_receipt_refs");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key_id, null);
  assert.equal(JSON.stringify(rows).includes(bearer), false);
  assert.equal(JSON.stringify(rows).includes("payTo"), false);
});

test("insert columns are fixed and a missing table does not throw", async () => {
  assert.equal(/\bquote\b|\bpayto\b|\bbody\b|\bbearer\b|\bip\b/i.test(INSERT_REF_SQL), false);
  assert.match(DELETE_REFS_SQL, /DELETE FROM org_receipt_refs WHERE org_id = \?/);
  const empty = openMem();
  await recordReceiptRef(empty, base());
  await deleteOrgReceiptRefs(empty, ORG_A);
  assert.equal(empty.rows("SELECT name FROM sqlite_master WHERE name = 'org_receipt_refs'").length, 0);
});

test("bad ids and a wallet in agent_id write nothing", async () => {
  const db = openMem();
  db.exec(readFileSync(new URL("../../d1/migrate-0.23-org-ledger-DRAFT-NOT-APPLIED.sql", import.meta.url), "utf8"));
  await recordReceiptRef(db, base({ receipt_id: "short" }));
  await recordReceiptRef(db, base({ host: "javascript:alert(1)" }));
  await recordReceiptRef(db, base({ agent_id: "0xabc" }));
  await recordReceiptRef(db, base({ org_id: "org_other" }));
  await recordReceiptRef(db, base({
    receipt_kind: "mcp_probe",
    receipt_id: RID_MCP,
    mcp: "53",
    s: "not-hex",
    id: "orr_dddddddddddddddddddddddddddddddd",
  }));
  assert.equal(db.rows("SELECT id FROM org_receipt_refs").length, 0);
  await recordReceiptRef(db, base({
    receipt_kind: "mcp_probe",
    receipt_id: RID_MCP,
    mcp: "53",
    s: "5fc2f595bd0bec49ef95",
    id: "orr_dddddddddddddddddddddddddddddddd",
  }));
  const rows = db.rows("SELECT locator, receipt_kind FROM org_receipt_refs");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].locator, "mcp=53&day=2026-10-29&s=5fc2f595bd0bec49ef95");
  assert.equal(rows[0].receipt_kind, "mcp_probe");
});

test("listLedger is org scoped and the cursor is org bound", async () => {
  const db = openMem();
  db.exec(readFileSync(new URL("../../d1/migrate-0.23-org-ledger-DRAFT-NOT-APPLIED.sql", import.meta.url), "utf8"));
  await recordReceiptRef(db, base({ id: "orr_01010101010101010101010101010101", at: "2026-10-29T01:00:00.000Z", receipt_id: "aaaaaaaaaaaaaaaaaaaa" }));
  await recordReceiptRef(db, base({ id: "orr_02020202020202020202020202020202", at: "2026-10-29T02:00:00.000Z", receipt_id: "bbbbbbbbbbbbbbbbbbbb" }));
  await recordReceiptRef(db, base({ id: "orr_03030303030303030303030303030303", at: "2026-10-29T03:00:00.000Z", receipt_id: "cccccccccccccccccccc" }));
  await recordReceiptRef(db, base({
    org_id: ORG_B,
    id: "orr_04040404040404040404040404040404",
    at: "2026-10-29T04:00:00.000Z",
    receipt_id: "dddddddddddddddddddd",
    host: "other.example",
  }));

  const first = await listLedger(db, { org_id: ORG_A, limit: 2 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.items.length, 2);
  assert.equal(first.items[0].receipt_id, "cccccccccccccccccccc");
  assert.equal(first.items[0].receipt_url, "https://botsrated.com/receipt/cccccccccccccccccccc?host=blockrun.ai&day=2026-10-29");
  assert.equal(first.items.every((item) => item.host === "blockrun.ai"), true);
  assert.ok(first.next_cursor);

  const second = await listLedger(db, { org_id: ORG_A, limit: 2, cursor: first.next_cursor });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].receipt_id, "aaaaaaaaaaaaaaaaaaaa");
  assert.equal(second.next_cursor, null);

  const crossed = await listLedger(db, { org_id: ORG_B, limit: 2, cursor: first.next_cursor });
  assert.deepEqual(crossed, { ok: false, error: "invalid_cursor" });

  const onlyB = await listLedger(db, { org_id: ORG_B, limit: 10 });
  assert.equal(onlyB.ok, true);
  if (!onlyB.ok) return;
  assert.equal(onlyB.items.length, 1);
  assert.equal(onlyB.items[0].host, "other.example");

  const filtered = await listLedger(db, { org_id: ORG_A, host: "blockrun.ai", from: "2026-10-29", to: "2026-10-29" });
  assert.equal(filtered.ok, true);
  if (!filtered.ok) return;
  assert.equal(filtered.items.length, 3);
  assert.equal(filtered.from, "2026-10-29T00:00:00.000Z");
  assert.equal(filtered.to, "2026-10-30T00:00:00.000Z");

  const badHost = await listLedger(db, { org_id: ORG_A, host: "https://blockrun.ai/path" });
  assert.deepEqual(badHost, { ok: false, error: "invalid_query" });
  const badLimit = await listLedger(db, { org_id: ORG_A, limit: 201 });
  assert.deepEqual(badLimit, { ok: false, error: "invalid_query" });
});

test("deleteOrgReceiptRefs removes one org only", async () => {
  const db = openMem();
  db.exec(readFileSync(new URL("../../d1/migrate-0.23-org-ledger-DRAFT-NOT-APPLIED.sql", import.meta.url), "utf8"));
  await recordReceiptRef(db, base());
  await recordReceiptRef(db, base({
    org_id: ORG_B,
    id: "orr_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    receipt_id: "eeeeeeeeeeeeeeeeeeee",
  }));
  await deleteOrgReceiptRefs(db, ORG_A);
  const rows = db.rows("SELECT org_id FROM org_receipt_refs");
  assert.deepEqual(rows.map((row) => row.org_id), [ORG_B]);
  await deleteOrgReceiptRefs(db, "brk_notanorg");
  assert.equal(db.rows("SELECT org_id FROM org_receipt_refs").length, 1);
});

test("a missing refs table on read is unavailable, not another org's rows", async () => {
  const db = openMem();
  const listed = await listLedger(db, { org_id: ORG_A });
  assert.deepEqual(listed, { ok: false, error: "ledger_unavailable" });
});
