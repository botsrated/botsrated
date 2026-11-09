import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FUNNEL_NOTE,
  FUNNEL_UPSERT_SQL,
  classifyAudience,
  funnelRow,
  funnelStageForCheck,
  funnelUpsertParams,
  openFunnelMemory,
  summarizeFunnel,
  utcDay,
} from "../src/funnel_measure.ts";

const browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const secret = "qa-token-value";

test("audiences split outside, crawlers, and internal without storing the User-Agent", () => {
  assert.equal(classifyAudience({ userAgent: browser, internalHeader: null, internalToken: secret, surface: "entry" }), "outside");
  assert.equal(classifyAudience({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)", internalHeader: null, internalToken: secret, surface: "check" }), "crawler");
  assert.equal(classifyAudience({ userAgent: "my-agent-bot/1.0", internalHeader: null, internalToken: secret, surface: "check" }), "outside");
  assert.equal(classifyAudience({ userAgent: "python-requests/2.32", internalHeader: null, internalToken: secret, surface: "check" }), "outside");
  assert.equal(classifyAudience({ userAgent: "", internalHeader: null, internalToken: secret, surface: "entry" }), "crawler");
  assert.equal(classifyAudience({ userAgent: "", internalHeader: null, internalToken: secret, surface: "check" }), "outside");
  assert.equal(classifyAudience({ userAgent: browser, internalHeader: secret, internalToken: secret, surface: "entry" }), "internal");
  assert.equal(classifyAudience({ userAgent: "Googlebot", internalHeader: secret, internalToken: secret, surface: "check" }), "internal");
  assert.equal(classifyAudience({ userAgent: browser, internalHeader: "wrong-token", internalToken: secret, surface: "entry" }), "outside");
  assert.equal(classifyAudience({ userAgent: browser, internalHeader: secret, internalToken: "", surface: "entry" }), "outside");
  assert.equal(classifyAudience({ userAgent: browser, internalHeader: null, internalToken: null, markedInternal: true, surface: "check" }), "internal");
  assert.equal(classifyAudience({ userAgent: "BotsRated-probe/0.2 (unpaid check)", internalHeader: null, internalToken: null, surface: "check" }), "internal");
  assert.equal(classifyAudience({ userAgent: "BotsRated-mcp-probe/0.4", internalHeader: null, internalToken: null, surface: "entry" }), "internal");
});

test("a finished check, a payment, and a miss stay separate stages", () => {
  assert.equal(funnelStageForCheck("/v1/check", 200, { found: false }, false), "useful_check");
  assert.equal(funnelStageForCheck("/v1/preflight", 200, { found: true }, false), "useful_check");
  assert.equal(funnelStageForCheck("/v1/find", 200, { matches: [] }, false), "useful_check");
  assert.equal(funnelStageForCheck("/v1/report/seller.example", 200, { host: "seller.example" }, false), "useful_check");
  assert.equal(funnelStageForCheck("/v1/check", 200, { error: { code: "not_found" } }, false), null);
  assert.equal(funnelStageForCheck("/v1/check", 200, { degraded: true }, false), null);
  assert.equal(funnelStageForCheck("/v1/check", 402, { found: true }, false), null);
  assert.equal(funnelStageForCheck("/v1/check", 200, { found: true }, true), "paid");
  assert.equal(funnelStageForCheck("/v1/best", 200, { ok: true }, true), "paid");
  assert.equal(funnelStageForCheck("/v1/pulse", 200, { ok: true }, false), null);
});

test("counts sit side by side and are not people or a rate", () => {
  const mem = openFunnelMemory();
  const day = utcDay(new Date("2026-11-09T21:00:00Z"));
  assert.equal(day, "2026-11-09");
  mem.add(funnelRow(day, "entry", "outside"));
  mem.add(funnelRow(day, "entry", "outside"));
  mem.add(funnelRow(day, "entry", "crawler"));
  mem.add(funnelRow(day, "useful_check", "outside"));
  mem.add(funnelRow(day, "paid", "internal"));
  const summary = summarizeFunnel(mem.rows());
  assert.equal(summary.note, FUNNEL_NOTE);
  const cell = (stage: string, audience: string) => summary.cells.find((row) => row.stage === stage && row.audience === audience);
  assert.equal(cell("entry", "outside")?.requests, 2);
  assert.equal(cell("entry", "crawler")?.requests, 1);
  assert.equal(cell("useful_check", "outside")?.requests, 1);
  assert.equal(cell("paid", "outside")?.requests, 0);
  assert.equal(cell("paid", "internal")?.requests, 1);
  assert.equal("rate" in summary, false);
  assert.equal(summary.note.includes("request counts"), true);
  assert.equal(Object.keys(summary).includes("unique"), false);
  const row = funnelRow(day, "entry", "outside");
  assert.deepEqual(funnelUpsertParams(row), [day, "entry:outside"]);
  assert.equal(row.bot, 0);
  assert.equal(FUNNEL_UPSERT_SQL.includes("ALTER"), false);
  assert.equal(FUNNEL_UPSERT_SQL.includes("CREATE"), false);
  assert.equal(FUNNEL_UPSERT_SQL.includes("human + 1"), true);
});

test("the module does not divide counts or read Authorization", () => {
  const src = readFileSync(new URL("../src/funnel_measure.ts", import.meta.url), "utf8");
  assert.equal(/headers\.get\(["']authorization/i.test(src), false);
  assert.equal(src.includes(" / "), false);
  assert.equal(src.includes("/ requests"), false);
  assert.throws(() => funnelRow("today", "entry", "outside"));
  assert.throws(() => funnelRow("2026-11-09", "entry", "outside", 2));
});
