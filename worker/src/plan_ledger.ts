// Plan-token paid checks → org ledger (Sticky #2, PR1).
//
// The live worker/src/index.ts and subs.ts are not in this public checkout.
// PR2 (private, tip basis a49fcdfd, Guard ACK) wires this in:
//
//   subs.ts  planAccess: ok:true returns also carry sub_id = row.id.
//   index.ts plan-token branch (dp && dp.ok): c.set("ledger_org", dp.sub_id).
//   index.ts /v1/check, /v1/report/:host, /v1/best: after the response body
//            is built and only on 2xx with ledger_org set, one call:
//
//     schedulePlanLedger(c.executionCtx, c.env.DB, { org_id }, "plan_check", out,
//       { host: normHost(q), origin: new URL(c.req.url).origin });
//
// Rules (Guard notes N1-N4):
// - org_id comes only from server-side planAccess (sha256 token lookup → row.id).
//   Never from query, body or header text. A missing org writes nothing.
// - key_id and agent_id are NULL on this path. No bearer, no token hash.
// - Refs point only to receipts already in the response body. No new mint site.
// - paid_receipts (test-buys) are never read. Free anonymous preflight never
//   calls this. x402 per-call and /mcp payers have no org and never call this.
// - Writes are ungated (same as the policy path). Reads stay behind
//   FEATURE_ORG_LEDGER === "true" in ledger_route.ts.
// - One waitUntil per response. The promise never rejects. A missing table,
//   a bad locator, a cross-host receipt or a foreign origin writes nothing.
// - The response bytes are unchanged: this only reads the built body.

import { receiptUrl, recordReceiptRef, type SqlDb } from "./ledger.ts";

export type PlanLedgerSource = "plan_check" | "plan_report" | "plan_best";

export interface PlanLedgerAuth {
  /** subscriptions.id (sub_…) from planAccess. Never request text. */
  org_id: string;
}

export interface PlanLedgerOpts {
  /** Requested host (normalized) for check/report. Unused for best. */
  host?: string | null;
  /** Request origin, so a pages.dev tip smoke writes too. */
  origin?: string | null;
}

export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export interface PlanRefDraft {
  host: string;
  receipt_kind: "unpaid_probe" | "mcp_probe";
  receipt_id: string;
  day: string;
  mcp?: string;
  s?: string;
  measured_at: string | null;
}

const CANONICAL_ORIGIN = "https://botsrated.com";
const ORIGIN_Q = /^https:\/\/[a-z0-9.-]+$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const PLAN_SOURCES: readonly PlanLedgerSource[] = ["plan_check", "plan_report", "plan_best"];
/** MCP servers per check/report, and ranked hosts per best list. */
export const PLAN_MAX_PER_KIND = 3;

/**
 * One waitUntil for the whole response. No org, no waitUntil.
 * A thrown waitUntil does not escape.
 */
export function schedulePlanLedger(
  ctx: WaitUntilCtx | null | undefined,
  db: SqlDb,
  auth: PlanLedgerAuth | null | undefined,
  source: PlanLedgerSource,
  body: unknown,
  opts: PlanLedgerOpts = {},
): void {
  if (!ctx || !auth || typeof auth.org_id !== "string" || auth.org_id === "") return;
  if (!PLAN_SOURCES.includes(source)) return;
  const orgId = auth.org_id;
  let drafts: PlanRefDraft[];
  try {
    drafts = planRefsFromBody(source, body, opts);
  } catch {
    return;
  }
  if (!drafts.length) return;
  const task = writePlanRefs(db, orgId, source, drafts).catch(() => undefined);
  try {
    ctx.waitUntil(task);
  } catch {
    // A broken waitUntil must not fail the paid response.
  }
}

async function writePlanRefs(db: SqlDb, orgId: string, source: PlanLedgerSource, drafts: PlanRefDraft[]): Promise<void> {
  for (const d of drafts) {
    try {
      await recordReceiptRef(db, {
        org_id: orgId,
        agent_id: null,
        key_id: null,
        source,
        host: d.host,
        receipt_kind: d.receipt_kind,
        receipt_id: d.receipt_id,
        day: d.day,
        mcp: d.mcp ?? null,
        s: d.s ?? null,
        receipt_sha256: null,
        measured_at: d.measured_at,
        usage_event_id: null,
      });
    } catch {
      // One bad ref does not stop the rest.
    }
  }
}

/**
 * Pick the refs a response already carries. Exported for tests and for the
 * PR2 dry-run. Pure: no I/O.
 *   check/report, x402 host: the newest unpaid_probe receipt for that host.
 *   check/report, MCP host:  the newest mcp_probe receipt per server, max 3.
 *   best: newest receipt per ranked x402 host (max 3), plus latest_receipt_url
 *         per ranked MCP server (max 3).
 */
export function planRefsFromBody(source: PlanLedgerSource, body: unknown, opts: PlanLedgerOpts = {}): PlanRefDraft[] {
  if (!isObj(body)) return [];
  const origins = allowedOrigins(opts.origin);
  const out: PlanRefDraft[] = [];
  const seen = new Set<string>();
  const push = (d: PlanRefDraft | null) => {
    if (!d || seen.has(d.receipt_id)) return false;
    seen.add(d.receipt_id);
    out.push(d);
    return true;
  };

  if (source === "plan_best") {
    let n = 0;
    for (const r of arr(body.results)) {
      if (n >= PLAN_MAX_PER_KIND) break;
      if (!isObj(r)) continue;
      const host = bare(r.host);
      if (!host) continue;
      for (const rec of arr(r.receipts)) {
        if (push(fromReceipt(rec, host, origins, "unpaid_probe"))) {
          n++;
          break;
        }
      }
    }
    let m = 0;
    for (const r of arr(body.mcp_results)) {
      if (m >= PLAN_MAX_PER_KIND) break;
      if (!isObj(r)) continue;
      const host = bare(r.host);
      if (!host) continue;
      if (push(fromUrl(r.latest_receipt_url, host, origins, "mcp_probe", null))) m++;
    }
    return out;
  }

  const want = bare(opts.host);
  if (!want) return [];
  if (body.type === "mcp") {
    if (bare(body.host) !== want) return [];
    const servers = new Set<string>();
    for (const rec of arr(body.receipts)) {
      if (servers.size >= PLAN_MAX_PER_KIND) break;
      const d = fromReceipt(rec, want, origins, "mcp_probe");
      if (!d || !d.s || servers.has(d.s)) continue;
      if (push(d)) servers.add(d.s);
    }
    return out;
  }
  for (const rec of arr(body.receipts)) {
    if (push(fromReceipt(rec, want, origins, "unpaid_probe"))) break;
  }
  return out;
}

function fromReceipt(rec: unknown, host: string, origins: Set<string>, kind: PlanRefDraft["receipt_kind"]): PlanRefDraft | null {
  if (!isObj(rec)) return null;
  if (rec.kind === "paid_test_buy") return null;
  if (typeof rec.kind === "string" && rec.kind !== kind) return null;
  const d = fromUrl(rec.receipt_url, host, origins, kind, typeof rec.ts === "string" ? rec.ts : null);
  if (!d) return null;
  if (typeof rec.id === "string" && rec.id.toLowerCase() !== d.receipt_id) return null;
  return d;
}

function fromUrl(raw: unknown, host: string, origins: Set<string>, kind: PlanRefDraft["receipt_kind"], ts: string | null): PlanRefDraft | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!origins.has(url.origin)) return null;
  const m = /^\/receipt\/([0-9a-f]{20})$/.exec(url.pathname);
  if (!m) return null;
  const locator = url.search.startsWith("?") ? url.search.slice(1) : "";
  const rebuilt = receiptUrl(m[1], locator);
  if (!rebuilt) return null;
  const q = new URL(rebuilt).searchParams;
  const day = q.get("day");
  if (!day) return null;
  const measured = ts && ISO_TS.test(ts) ? ts : null;
  if (kind === "unpaid_probe") {
    const h = q.get("host");
    if (!h || bare(h) !== host) return null;
    return { host: h, receipt_kind: kind, receipt_id: m[1], day, measured_at: measured };
  }
  const mcp = q.get("mcp");
  const s = q.get("s");
  if (!mcp || !s || q.get("host") != null) return null;
  return { host, receipt_kind: kind, receipt_id: m[1], day, mcp, s, measured_at: measured };
}

function allowedOrigins(origin: string | null | undefined): Set<string> {
  const set = new Set<string>([CANONICAL_ORIGIN]);
  if (typeof origin === "string") {
    const o = origin.trim().toLowerCase();
    if (ORIGIN_Q.test(o)) set.add(o);
  }
  return set;
}

function bare(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/^www\./, "");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
