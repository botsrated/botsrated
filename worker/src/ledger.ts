// Org receipt ledger. Drop-in for the private Pages worker.
// The live worker is not in this public repo (Pages tip f61ad18b, ad-hoc deploy).
// Free /receipt, /spec/* and /.well-known/botsrated-key stay anonymous.
// Public routes must not import this module.
//
// Retention: receipt_sha256 is kept indefinitely. This slice does not prune
// and does not null locator (the 0.23 draft declares locator NOT NULL).

import type { Env } from "./env.ts";

/** Same allowlists as spec/receipt-page.mjs receiptCliUrl. */
const RECEIPT_ID = /^[0-9a-f]{20}$/;
const HOST_Q = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const MCP_Q = /^[0-9]{1,6}$/;
const DAY_Q = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const S_Q = /^[0-9a-f]{20}$/;
const ORG_ID = /^sub_[0-9a-f]{8,64}$/;
const AGENT_ID = /^ag_[0-9a-f]{8,64}$/;
const KEY_ID = /^key_[0-9a-f]{8,64}$/;
const USAGE_EVENT_ID = /^ue_[0-9a-f]{8,64}$/;
const REF_ID = /^orr_[0-9a-f]{16,64}$/;
const SHA256 = /^(?:0x)?([0-9a-f]{64})$/i;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const CANONICAL_ORIGIN = "https://botsrated.com";

export const LEDGER_NOTE =
  "Ledger rows are unsigned. Each receipt_url is a public signed receipt; verify it free with the HTML page or spec/verify.mjs.";

export const INSERT_REF_SQL =
  "INSERT OR IGNORE INTO org_receipt_refs (id, org_id, agent_id, key_id, source, host, receipt_kind, receipt_id, locator, receipt_sha256, measured_at, usage_event_id, at) VALUES (?, ?, ?, ?, 'policy_check', ?, ?, ?, ?, ?, ?, ?, ?)";

export const DELETE_REFS_SQL = "DELETE FROM org_receipt_refs WHERE org_id = ?";

export interface SqlStmt {
  bind(...params: Array<string | number | null>): SqlBound;
}

export interface SqlBound {
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

/** Subset of D1Database this module uses. */
export interface SqlDb {
  prepare(sql: string): SqlStmt;
}

export type ReceiptKind = "unpaid_probe" | "mcp_probe";

export type LocatorParts =
  | { kind: "unpaid_probe"; host: string; day: string }
  | { kind: "mcp_probe"; mcp: string; day: string; s: string };

export function orgLedgerEnabled(env: Env): boolean {
  return env.FEATURE_ORG_LEDGER === "true";
}

export function buildLocator(parts: LocatorParts): string | null {
  if (parts.kind === "unpaid_probe") {
    const host = normHost(parts.host);
    const day = normDay(parts.day);
    if (!host || !day) return null;
    return "host=" + host + "&day=" + day;
  }
  const mcp = typeof parts.mcp === "string" && MCP_Q.test(parts.mcp) ? parts.mcp : "";
  const day = normDay(parts.day);
  const s = typeof parts.s === "string" && S_Q.test(parts.s) ? parts.s.toLowerCase() : "";
  if (!mcp || !day || !s) return null;
  return "mcp=" + mcp + "&day=" + day + "&s=" + s;
}

/**
 * Rebuild a receipt URL from an id plus an allowlisted locator.
 * The locator string is parsed and rebuilt. It is never copied through.
 * A bad id or any disallowed query key yields "".
 */
export function receiptUrl(id: string, locator: string): string {
  if (typeof id !== "string" || !RECEIPT_ID.test(id)) return "";
  const rebuilt = rebuildLocator(locator);
  if (!rebuilt) return "";
  return CANONICAL_ORIGIN + "/receipt/" + id + "?" + rebuilt;
}

export function dayOf(iso: string | null | undefined): string | null {
  if (typeof iso !== "string" || iso.length < 10) return null;
  return normDay(iso.slice(0, 10));
}

/**
 * Desk rollup day. Prefer a stored receipt day when the row has one.
 * desk_alert_rollups on botsrated-data has event_at and receipt_id only,
 * so production reads fall through to the UTC day prefix of event_at.
 */
export function deskReceiptDay(row: { receipt_day?: string | null; day?: string | null; event_at?: string | null }): string | null {
  const stored = normDay(row.receipt_day) || normDay(row.day);
  if (stored) return stored;
  return dayOf(row.event_at);
}

export interface RecordReceiptRefInput {
  org_id: string;
  agent_id?: string | null;
  /** org_keys.key_id. A bearer (brk_ / brs_) is dropped, never stored. */
  key_id?: string | null;
  host: string;
  receipt_kind: ReceiptKind;
  receipt_id: string;
  day: string;
  /** MCP shard. Required when receipt_kind is mcp_probe. */
  mcp?: string | null;
  /** mcp_servers.id (20 hex). Required when receipt_kind is mcp_probe. */
  s?: string | null;
  receipt_sha256?: string | null;
  measured_at?: string | null;
  usage_event_id?: string | null;
  at?: string;
  id?: string;
}

/**
 * INSERT OR IGNORE one policy_check ref. Missing table, bad ids, and
 * constraint failures return without throwing.
 */
export async function recordReceiptRef(db: SqlDb, input: RecordReceiptRefInput): Promise<void> {
  try {
    const row = normalizeRef(input);
    if (!row) return;
    await db.prepare(INSERT_REF_SQL).bind(
      row.id,
      row.org_id,
      row.agent_id,
      row.key_id,
      row.host,
      row.receipt_kind,
      row.receipt_id,
      row.locator,
      row.receipt_sha256,
      row.measured_at,
      row.usage_event_id,
      row.at,
    ).run();
  } catch {
    // Missing table and other D1 errors must not fail the caller.
  }
}

/**
 * Delete every ref for one org. Call this from deletePolicy and from any
 * plan-cancel path that already deletes that org's usage_events, so refs
 * are not left behind. Missing table: no-op.
 */
export async function deleteOrgReceiptRefs(db: SqlDb, orgId: string): Promise<void> {
  try {
    if (!ORG_ID.test(orgId)) return;
    await db.prepare(DELETE_REFS_SQL).bind(orgId).run();
  } catch {
    // no-op
  }
}

export interface LedgerItem {
  at: string;
  source: "policy_check" | "desk_rollup";
  host: string;
  agent_id: string | null;
  receipt_kind: ReceiptKind;
  receipt_id: string;
  receipt_url: string | null;
  receipt_sha256: string | null;
  measured_at: string | null;
}

export interface UsageTotal {
  kind: string;
  rail: string;
  units: number;
}

export interface ListLedgerQuery {
  org_id: string;
  from?: string | null;
  to?: string | null;
  host?: string | null;
  source?: string | null;
  limit?: number;
  cursor?: string | null;
}

export type ListLedgerResult =
  | {
      ok: true;
      items: LedgerItem[];
      next_cursor: string | null;
      from: string | null;
      to: string | null;
      /** Same page as items, with the cursor id. HTTP responses omit this. */
      rows: Array<LedgerItem & { id: string }>;
    }
  | { ok: false; error: "invalid_cursor" | "invalid_query" | "ledger_unavailable" };

interface RefRow {
  id: string;
  org_id: string;
  agent_id: string | null;
  source: string;
  host: string;
  receipt_kind: string;
  receipt_id: string;
  locator: string;
  receipt_sha256: string | null;
  measured_at: string | null;
  at: string;
}

const LIST_SQL = `SELECT id, org_id, agent_id, source, host, receipt_kind, receipt_id, locator, receipt_sha256, measured_at, at
  FROM org_receipt_refs
  WHERE org_id = ?
    AND (? IS NULL OR at >= ?)
    AND (? IS NULL OR at < ?)
    AND (? IS NULL OR host = ?)
    AND (? IS NULL OR source = ?)
    AND (? IS NULL OR at < ? OR (at = ? AND id < ?))
  ORDER BY at DESC, id DESC
  LIMIT ?`;

/** Always filtered by org_id. Cursor is opaque and bound to that org. */
export async function listLedger(db: SqlDb, query: ListLedgerQuery): Promise<ListLedgerResult> {
  if (!ORG_ID.test(query.org_id)) return { ok: false, error: "invalid_query" };
  const window = normalizeWindow(query.from, query.to);
  if (!window) return { ok: false, error: "invalid_query" };
  const host = query.host == null || query.host === "" ? null : normHost(query.host);
  if (query.host != null && query.host !== "" && !host) return { ok: false, error: "invalid_query" };
  const source = query.source == null || query.source === "" ? null : query.source;
  if (source != null && source !== "policy_check" && source !== "desk_rollup") {
    return { ok: false, error: "invalid_query" };
  }
  const limit = normalizeLimit(query.limit);
  if (limit == null) return { ok: false, error: "invalid_query" };

  let cursorAt: string | null = null;
  let cursorId: string | null = null;
  if (query.cursor != null && query.cursor !== "") {
    const decoded = decodeCursor(query.cursor);
    if (!decoded || decoded.o !== query.org_id) return { ok: false, error: "invalid_cursor" };
    cursorAt = decoded.at;
    cursorId = decoded.id;
  }

  // desk_rollup rows are not stored in this slice. A source filter for them
  // matches nothing in org_receipt_refs (the read route joins rollups).
  const sourceParam = source;

  try {
    const bound = db.prepare(LIST_SQL).bind(
      query.org_id,
      window.from,
      window.from,
      window.to,
      window.to,
      host,
      host,
      sourceParam,
      sourceParam,
      cursorAt,
      cursorAt,
      cursorAt,
      cursorId,
      limit + 1,
    );
    const result = await bound.all<RefRow>();
    const rows = result.results ?? [];
    const mapped = rows.map(rowToItem).filter((row) => row.receipt_id !== "" && row.receipt_url != null);
    const page = mapped.slice(0, limit);
    let next: string | null = null;
    if (mapped.length > limit && page.length) {
      const last = page[page.length - 1];
      next = encodeCursor(query.org_id, last.at, last.id);
    }
    return {
      ok: true,
      items: page.map(publicItem),
      next_cursor: next,
      from: window.from,
      to: window.to,
      rows: mapped,
    };
  } catch {
    return { ok: false, error: "ledger_unavailable" };
  }
}

function publicItem(row: LedgerItem & { id: string }): LedgerItem {
  const { id: _id, ...item } = row;
  return item;
}

const DESK_SQL = `SELECT rollup_key, host, event_at, receipt_id
  FROM desk_alert_rollups
  WHERE org_id = ?
    AND receipt_id IS NOT NULL
    AND (? IS NULL OR event_at >= ?)
    AND (? IS NULL OR event_at < ?)
    AND (? IS NULL OR host = ?)
    AND (? IS NULL OR event_at < ? OR (event_at = ? AND ('desk:' || rollup_key) < ?))
  ORDER BY event_at DESC, rollup_key DESC
  LIMIT ?`;

const USAGE_SQL = `SELECT kind, rail, SUM(units) AS units
  FROM usage_events
  WHERE org_id = ?
    AND (? IS NULL OR at >= ?)
    AND (? IS NULL OR at < ?)
  GROUP BY kind, rail
  ORDER BY kind, rail`;

export type ReadLedgerResult =
  | {
      ok: true;
      items: LedgerItem[];
      next_cursor: string | null;
      from: string | null;
      to: string | null;
      usage_totals: UsageTotal[];
    }
  | { ok: false; error: "invalid_cursor" | "invalid_query" | "ledger_unavailable" };

/**
 * Policy refs plus a read-only join of desk_alert_rollups for this org.
 * Desk rows are not written into org_receipt_refs. receipt_url is rebuilt
 * from host and deskReceiptDay (stored day when the row has one, else the
 * UTC day of event_at). The live rollup table has no receipt-day column.
 */
export async function readOrgLedger(db: SqlDb, query: ListLedgerQuery): Promise<ReadLedgerResult> {
  const refs = await listLedger(db, query);
  if (!refs.ok) return refs;
  const source = query.source == null || query.source === "" ? null : query.source;
  const limit = normalizeLimit(query.limit);
  if (limit == null) return { ok: false, error: "invalid_query" };
  const host = query.host == null || query.host === "" ? null : normHost(query.host);

  let cursorAt: string | null = null;
  let cursorId: string | null = null;
  if (query.cursor != null && query.cursor !== "") {
    const decoded = decodeCursor(query.cursor);
    if (!decoded || decoded.o !== query.org_id) return { ok: false, error: "invalid_cursor" };
    cursorAt = decoded.at;
    cursorId = decoded.id;
  }

  let desk: Array<LedgerItem & { id: string }> = [];
  if (source !== "policy_check") {
    try {
      const result = await db.prepare(DESK_SQL).bind(
        query.org_id,
        refs.from,
        refs.from,
        refs.to,
        refs.to,
        host,
        host,
        cursorAt,
        cursorAt,
        cursorAt,
        cursorId,
        limit + 1,
      ).all<DeskRow>();
      desk = (result.results ?? []).map(deskRowToItem).filter((row): row is LedgerItem & { id: string } => row != null);
    } catch {
      return { ok: false, error: "ledger_unavailable" };
    }
  }

  let usage_totals: UsageTotal[] = [];
  try {
    const totals = await db.prepare(USAGE_SQL).bind(
      query.org_id,
      refs.from,
      refs.from,
      refs.to,
      refs.to,
    ).all<{ kind: string; rail: string; units: number | null }>();
    usage_totals = (totals.results ?? []).map((row) => ({
      kind: String(row.kind),
      rail: String(row.rail),
      units: Number(row.units ?? 0),
    }));
  } catch {
    return { ok: false, error: "ledger_unavailable" };
  }

  const refRows = source === "desk_rollup" ? [] : refs.rows;
  const merged = [...refRows, ...desk].sort(byAtDesc);
  const page = merged.slice(0, limit);
  const next = merged.length > limit && page.length
    ? encodeCursor(query.org_id, page[page.length - 1].at, page[page.length - 1].id)
    : null;
  return {
    ok: true,
    items: page.map(publicItem),
    next_cursor: next,
    from: refs.from,
    to: refs.to,
    usage_totals,
  };
}

interface DeskRow {
  rollup_key: string;
  host: string;
  event_at: string;
  receipt_id: string;
  receipt_day?: string | null;
  day?: string | null;
}

function deskRowToItem(row: DeskRow): (LedgerItem & { id: string }) | null {
  if (typeof row.receipt_id !== "string" || !RECEIPT_ID.test(row.receipt_id)) return null;
  const host = normHost(row.host);
  const day = deskReceiptDay({ receipt_day: row.receipt_day, day: row.day, event_at: row.event_at });
  if (!host || !day) return null;
  if (typeof row.rollup_key !== "string" || row.rollup_key.length === 0 || row.rollup_key.length > 160) return null;
  const locator = buildLocator({ kind: "unpaid_probe", host, day });
  if (!locator) return null;
  const url = receiptUrl(row.receipt_id, locator);
  if (!url) return null;
  const at = typeof row.event_at === "string" ? row.event_at : "";
  if (!ISO_TS.test(at)) return null;
  return {
    id: "desk:" + row.rollup_key,
    at,
    source: "desk_rollup",
    host,
    agent_id: null,
    receipt_kind: "unpaid_probe",
    receipt_id: row.receipt_id,
    receipt_url: url,
    receipt_sha256: null,
    measured_at: at,
  };
}

function byAtDesc(a: LedgerItem & { id: string }, b: LedgerItem & { id: string }): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

function rowToItem(row: RefRow): LedgerItem & { id: string } {
  const url = receiptUrl(row.receipt_id, row.locator);
  const kind: ReceiptKind = row.receipt_kind === "mcp_probe" ? "mcp_probe" : "unpaid_probe";
  return {
    id: row.id,
    at: row.at,
    source: "policy_check",
    host: row.host,
    agent_id: row.agent_id,
    receipt_kind: kind,
    receipt_id: RECEIPT_ID.test(row.receipt_id) ? row.receipt_id : "",
    receipt_url: url || null,
    receipt_sha256: normSha(row.receipt_sha256),
    measured_at: row.measured_at,
  };
}

interface NormalizedRef {
  id: string;
  org_id: string;
  agent_id: string | null;
  key_id: string | null;
  host: string;
  receipt_kind: ReceiptKind;
  receipt_id: string;
  locator: string;
  receipt_sha256: string | null;
  measured_at: string | null;
  usage_event_id: string | null;
  at: string;
}

function normalizeRef(input: RecordReceiptRefInput): NormalizedRef | null {
  if (!ORG_ID.test(input.org_id)) return null;
  if (!RECEIPT_ID.test(input.receipt_id)) return null;
  const host = normHost(input.host);
  if (!host) return null;
  if (input.receipt_kind !== "unpaid_probe" && input.receipt_kind !== "mcp_probe") return null;
  const locator = input.receipt_kind === "mcp_probe"
    ? buildLocator({ kind: "mcp_probe", mcp: input.mcp ?? "", day: input.day, s: input.s ?? "" })
    : buildLocator({ kind: "unpaid_probe", host, day: input.day });
  if (!locator) return null;
  const agent = input.agent_id == null || input.agent_id === "" ? null : input.agent_id;
  if (agent != null && !AGENT_ID.test(agent)) return null;
  const key = scrubKeyId(input.key_id);
  const usage = input.usage_event_id == null || input.usage_event_id === "" ? null : input.usage_event_id;
  const measured = input.measured_at == null || input.measured_at === "" ? null : input.measured_at;
  const at = input.at && ISO_TS.test(input.at) ? input.at : new Date().toISOString();
  const id = input.id && REF_ID.test(input.id) ? input.id : newRefId();
  return {
    id,
    org_id: input.org_id,
    agent_id: agent,
    key_id: key,
    host,
    receipt_kind: input.receipt_kind,
    receipt_id: input.receipt_id.toLowerCase(),
    locator,
    receipt_sha256: normSha(input.receipt_sha256),
    measured_at: measured != null && ISO_TS.test(measured) ? measured : null,
    usage_event_id: usage != null && USAGE_EVENT_ID.test(usage) ? usage : null,
    at,
  };
}

/** A bearer or any other free text becomes NULL. Only org_keys.key_id is stored. */
function scrubKeyId(value: string | null | undefined): string | null {
  if (typeof value === "string" && KEY_ID.test(value)) return value;
  return null;
}

function newRefId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return "orr_" + hex;
}

function normHost(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase();
  return HOST_Q.test(host) ? host : null;
}

function normDay(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const day = value.trim();
  return DAY_Q.test(day) ? day : null;
}

function normSha(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const m = SHA256.exec(value.trim());
  return m ? m[1].toLowerCase() : null;
}

function rebuildLocator(locator: string): string | null {
  if (typeof locator !== "string" || locator.length === 0 || locator.length > 300) return null;
  if (/[^a-z0-9=&._-]/i.test(locator)) return null;
  const bag: Record<string, string> = {};
  for (const part of locator.split("&")) {
    if (!part) return null;
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key !== "host" && key !== "mcp" && key !== "day" && key !== "s") return null;
    if (bag[key] != null) return null;
    bag[key] = value;
  }
  const day = normDay(bag.day);
  if (!day) return null;
  if (bag.mcp != null || bag.s != null) {
    if (bag.host != null) return null;
    return buildLocator({ kind: "mcp_probe", mcp: bag.mcp ?? "", day, s: bag.s ?? "" });
  }
  return buildLocator({ kind: "unpaid_probe", host: bag.host ?? "", day });
}

function normalizeLimit(limit: number | undefined): number | null {
  if (limit == null) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return null;
  return limit;
}

function normalizeWindow(from: string | null | undefined, to: string | null | undefined): { from: string | null; to: string | null } | null {
  const start = bound(from, "from");
  const end = bound(to, "to");
  if (start === false || end === false) return null;
  return { from: start, to: end };
}

function bound(value: string | null | undefined, edge: "from" | "to"): string | null | false {
  if (value == null || value === "") return null;
  if (DAY_Q.test(value)) {
    if (edge === "from") return value + "T00:00:00.000Z";
    return nextDay(value) + "T00:00:00.000Z";
  }
  if (!ISO_TS.test(value) || Number.isNaN(Date.parse(value))) return false;
  return value;
}

function nextDay(day: string): string {
  const t = Date.parse(day + "T00:00:00.000Z");
  return new Date(t + 86_400_000).toISOString().slice(0, 10);
}

interface CursorPayload {
  v: 1;
  o: string;
  at: string;
  id: string;
}

function encodeCursor(orgId: string, at: string, id: string): string {
  const json = JSON.stringify({ v: 1, o: orgId, at, id } satisfies CursorPayload);
  return "v1." + btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(cursor: string): CursorPayload | null {
  if (!cursor.startsWith("v1.")) return null;
  try {
    const b64 = cursor.slice(3).replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    const parsed = JSON.parse(json) as Partial<CursorPayload>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.o !== "string" || !ORG_ID.test(parsed.o)) return null;
    if (typeof parsed.at !== "string" || !ISO_TS.test(parsed.at)) return null;
    if (typeof parsed.id !== "string" || parsed.id.length > 200) return null;
    return { v: 1, o: parsed.o, at: parsed.at, id: parsed.id };
  } catch {
    return null;
  }
}
