// GET /v1/org/ledger
//
// Mount from the private worker's mountOrg (org.ts is not in this public repo):
//
//   if (request.method === "GET" && url.pathname === "/v1/org/ledger") {
//     return handleOrgLedger(request, env, resolveOrgAuth);
//   }
//
// Flag off → 501 coming, including when no token is sent (dark deploy smoke).
// Flag exactly "true" and no bearer → 401 paid_plan_token_required.
// alerts-free and expired plans are refused by resolveOrgAuth / planWho;
// this route does not reimplement that check.
//
// On deletePolicy and on plan-cancel, call onPolicyOrPlanDeleted (PR 2)
// so refs are deleted with the org's other rows.
//
// Desk rollups are a read-only join. This file does not write Desk tables
// and does not edit desk.ts or desk_store.ts.

import type { Env } from "./env.ts";
import {
  LEDGER_NOTE,
  orgLedgerEnabled,
  readOrgLedger,
  type LedgerItem,
  type SqlDb,
  type UsageTotal,
} from "./ledger.ts";
import { onPolicyOrPlanDeleted } from "./policy_ledger.ts";

export { onPolicyOrPlanDeleted };

export const PAID_PLAN_TOKEN_REQUIRED = {
  error: "paid_plan_token_required",
  message: "Need an active paid alerts/data plan bearer (brs_…) or an org key (brk_…).",
};

export interface ResolvedOrg {
  org_id: string;
  agent_id?: string | null;
  key_id?: string | null;
}

export type ResolveOrgAuth = (
  request: Request,
  env: Env & { DB: SqlDb },
  opts: { need: "check" },
) => Promise<ResolvedOrg | Response>;

export interface LedgerResponseBody {
  org_id: string;
  from: string | null;
  to: string | null;
  signed: false;
  not_a_botsrated_rating: true;
  note: string;
  items: LedgerItem[];
  usage_totals: UsageTotal[];
  next_cursor: string | null;
}

export async function handleOrgLedger(
  request: Request,
  env: Env & { DB: SqlDb },
  resolveOrgAuth: ResolveOrgAuth,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/org/ledger") return ledgerJson(404, { error: "not_found" });
  if (request.method !== "GET") return ledgerJson(405, { error: "method_not_allowed" });

  // Dark deploy: 501 before auth so a no-token smoke sees coming, not 401.
  if (!orgLedgerEnabled(env)) return ledgerJson(501, { error: "coming", message: "Org ledger is off." });

  const header = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(header)) return ledgerJson(401, PAID_PLAN_TOKEN_REQUIRED);

  let auth: ResolvedOrg | Response;
  try {
    auth = await resolveOrgAuth(request, env, { need: "check" });
  } catch {
    return ledgerJson(401, PAID_PLAN_TOKEN_REQUIRED);
  }
  if (auth instanceof Response) return withLedgerHeaders(auth);
  if (!auth || typeof auth.org_id !== "string" || auth.org_id === "") {
    return ledgerJson(401, PAID_PLAN_TOKEN_REQUIRED);
  }

  const limitRaw = url.searchParams.get("limit");
  let limit: number | undefined;
  if (limitRaw != null && limitRaw !== "") {
    if (!/^[0-9]+$/.test(limitRaw)) return ledgerJson(400, { error: "invalid_query" });
    limit = Number(limitRaw);
  }

  const result = await readOrgLedger(env.DB, {
    org_id: auth.org_id,
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    host: url.searchParams.get("host"),
    source: url.searchParams.get("source"),
    cursor: url.searchParams.get("cursor"),
    limit,
  });
  if (!result.ok) {
    const status = result.error === "ledger_unavailable" ? 503 : 400;
    return ledgerJson(status, { error: result.error });
  }

  const body: LedgerResponseBody = {
    org_id: auth.org_id,
    from: result.from,
    to: result.to,
    signed: false,
    not_a_botsrated_rating: true,
    note: LEDGER_NOTE,
    items: result.items,
    usage_totals: result.usage_totals,
    next_cursor: result.next_cursor,
  };
  return ledgerJson(200, body);
}

function ledgerJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: ledgerHeaders() });
}

function ledgerHeaders(): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("x-robots-tag", "noindex");
  return headers;
}

async function withLedgerHeaders(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-robots-tag", "noindex");
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers });
}
