// Guard touchpoint for the paid org ledger.
//
// The live worker/src/policy.ts is not in this public checkout. Pages tip
// f61ad18b is an ad-hoc deploy of the private worker. Guard review is required
// before Lead copies this in. The only edit inside policy.ts is one
// ctx.waitUntil call (do not destructure waitUntil):
//
//   schedulePolicyLedger(ctx, env.DB, {
//     org_id: auth.org_id,
//     agent_id: auth.agent_id ?? null,
//     key_id: auth.key_id ?? null, // org_keys.key_id, never the brk_/brs_ bearer
//   }, items);
//
// checkOne passes one item with decided:true after it has a decision.
// Batch passes one item per decided row and decided:false for refused rows.
// This does not change usage_events and does not change the batch event's
// host:null row. Dedupe is UNIQUE (org_id, source, receipt_id).
//
// On deletePolicy, and on any plan-cancel path that already deletes that
// org's usage_events, also call:
//
//   await onPolicyOrPlanDeleted(env.DB, orgId);
//
// Free preflight stays anonymous. preflight_attributed is not emitted.
// No quote, payTo, IP, or request body is copied into a ref.

import {
  dayOf,
  deleteOrgReceiptRefs,
  receiptUrl,
  recordReceiptRef,
  type SqlDb,
} from "./ledger.ts";

const RECEIPT_ID = /^[0-9a-f]{20}$/;
const DAY_Q = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export interface PolicyLedgerAuth {
  org_id: string;
  agent_id?: string | null;
  /** org_keys.key_id. Not the bearer. */
  key_id?: string | null;
}

export interface PolicyLatest {
  id?: string;
  receipt_id?: string;
  day?: string;
  ts?: string;
  host?: string;
  sha256?: string;
  receipt_sha256?: string;
  receipt_url?: string;
}

export interface PolicyFacts {
  latest?: PolicyLatest | null;
}

export interface PolicyLedgerItem {
  /** True only for a decided item. Refused items stay false and write nothing. */
  decided: boolean;
  host: string;
  facts?: PolicyFacts | null;
  usage_event_id?: string | null;
}

export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

const MCP_SQL = `SELECT id, shard, last_receipt_id, last_receipt_day, last_probe_at
  FROM mcp_servers
  WHERE host = ? AND last_receipt_id IS NOT NULL
  ORDER BY last_receipt_day DESC, last_probe_at DESC
  LIMIT 1`;

/**
 * One waitUntil for the whole check or batch. The promise never rejects.
 * A missing table or a bad receipt id writes nothing.
 */
export function schedulePolicyLedger(
  ctx: WaitUntilCtx,
  db: SqlDb,
  auth: PolicyLedgerAuth,
  items: readonly PolicyLedgerItem[],
): void {
  const task = writePolicyRefs(db, auth, items).catch(() => undefined);
  try {
    ctx.waitUntil(task);
  } catch {
    // A broken waitUntil must not fail the policy check.
  }
}

/** deletePolicy and plan-cancel: drop this org's refs with its other org rows. */
export async function onPolicyOrPlanDeleted(db: SqlDb, orgId: string): Promise<void> {
  await deleteOrgReceiptRefs(db, orgId);
}

async function writePolicyRefs(db: SqlDb, auth: PolicyLedgerAuth, items: readonly PolicyLedgerItem[]): Promise<void> {
  for (const item of items) {
    if (item.decided !== true) continue;
    try {
      const draft = await draftForItem(db, item);
      if (!draft) continue;
      await recordReceiptRef(db, {
        org_id: auth.org_id,
        agent_id: auth.agent_id ?? null,
        key_id: auth.key_id ?? null,
        host: item.host,
        receipt_kind: draft.receipt_kind,
        receipt_id: draft.receipt_id,
        day: draft.day,
        mcp: draft.mcp,
        s: draft.s,
        receipt_sha256: draft.receipt_sha256,
        measured_at: draft.measured_at,
        usage_event_id: item.usage_event_id ?? null,
      });
    } catch {
      // One bad item does not stop the rest, and does not fail the check.
    }
  }
}

interface Draft {
  receipt_kind: "unpaid_probe" | "mcp_probe";
  receipt_id: string;
  day: string;
  mcp?: string;
  s?: string;
  receipt_sha256: string | null;
  measured_at: string | null;
}

async function draftForItem(db: SqlDb, item: PolicyLedgerItem): Promise<Draft | null> {
  const host = typeof item.host === "string" ? item.host.trim().toLowerCase() : "";
  const x402 = x402Draft(host, item.facts?.latest);
  if (x402) return x402;
  if (item.facts?.latest && x402Blocked(host, item.facts.latest)) return null;
  return mcpDraft(db, host);
}

function x402Blocked(host: string, latest: PolicyLatest): boolean {
  if (typeof latest.host !== "string" || latest.host.trim() === "") return false;
  return latest.host.trim().toLowerCase() !== host;
}

function x402Draft(host: string, latest: PolicyLatest | null | undefined): Draft | null {
  if (!latest || x402Blocked(host, latest)) return null;
  let id = pickId(latest.id) || pickId(latest.receipt_id);
  let day = pickDay(latest.day) || dayOf(latest.ts);
  if ((!id || !day) && typeof latest.receipt_url === "string") {
    const parsed = parseAllowlistedUrl(latest.receipt_url);
    if (parsed?.host && parsed.host !== host) return null;
    if (parsed && !parsed.mcp) {
      id = id || parsed.id;
      day = day || parsed.day;
    }
  }
  if (!id || !day) return null;
  const measured = typeof latest.ts === "string" && ISO_TS.test(latest.ts) ? latest.ts : null;
  const sha = latest.receipt_sha256 ?? latest.sha256 ?? null;
  return {
    receipt_kind: "unpaid_probe",
    receipt_id: id,
    day,
    receipt_sha256: typeof sha === "string" ? sha : null,
    measured_at: measured,
  };
}

async function mcpDraft(db: SqlDb, host: string): Promise<Draft | null> {
  if (!host) return null;
  try {
    const row = await db.prepare(MCP_SQL).bind(host).first<McpRow>();
    if (!row) return null;
    const id = pickId(row.last_receipt_id);
    const day = pickDay(row.last_receipt_day);
    const s = pickId(row.id);
    const mcp = row.shard == null ? "" : String(row.shard);
    if (!id || !day || !s || !/^[0-9]{1,6}$/.test(mcp)) return null;
    const measured = typeof row.last_probe_at === "string" && ISO_TS.test(row.last_probe_at) ? row.last_probe_at : null;
    return {
      receipt_kind: "mcp_probe",
      receipt_id: id,
      day,
      mcp,
      s,
      receipt_sha256: null,
      measured_at: measured,
    };
  } catch {
    return null;
  }
}

interface McpRow {
  id?: string;
  shard?: number | string | null;
  last_receipt_id?: string | null;
  last_receipt_day?: string | null;
  last_probe_at?: string | null;
}

function pickId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return RECEIPT_ID.test(id) ? id : null;
}

function pickDay(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return DAY_Q.test(value) ? value : null;
}

function parseAllowlistedUrl(raw: string): { id: string; host: string | null; day: string | null; mcp: string | null } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== "https://botsrated.com") return null;
  const m = /^\/receipt\/([0-9a-f]{20})$/.exec(url.pathname);
  if (!m) return null;
  const locator = url.search.startsWith("?") ? url.search.slice(1) : "";
  const rebuilt = receiptUrl(m[1], locator);
  if (!rebuilt) return null;
  const parsed = new URL(rebuilt);
  return {
    id: m[1],
    host: parsed.searchParams.get("host"),
    day: parsed.searchParams.get("day"),
    mcp: parsed.searchParams.get("mcp"),
  };
}
