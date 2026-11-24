// POST /v1/guard/check and the guard_check MCP tool.
//
// Read-only stub. Mount from the private worker when Lead tips it:
//
//   if (request.method === "POST" && url.pathname === "/v1/guard/check") {
//     return handleGuardCheck(request, env, resolveGuardAuth);
//   }
//
// Flag off → 501 coming, including when no token is sent.
// Flag exactly "true" and no bearer → 401.
// Bearer without the guard-check scope → 403.
//
// This file does not import the org ledger, does not open D1, and does
// not write. D1 writers stay paused. It never signs a payment and never
// sends one. A policy receipt signature needs a non-prod scoped key;
// this stub does not hold that private key, so signature_present stays
// false. X-BotsRated-Client is not read and is not required.

import { assertPolicySigningKeyId, buildPolicyReceipt, evaluateCustomerPolicy, type CustomerPolicy, type MeasuredFacts } from "../../integrations/x402-client/src/guard-policy.ts";
import type { Env } from "./env.ts";

export const GUARD_CHECK_PATH = "/v1/guard/check";
export const GUARD_CHECK_SCOPE = "guard-check";
export const GUARD_CHECK_TOOL_NAME = "guard_check";
const MAX_BODY_BYTES = 32_000;

export const GUARD_CHECK_TOOL = {
  name: GUARD_CHECK_TOOL_NAME,
  description:
    "Read-only. Compare a signed x402 requirement with your policy. Returns pass or fail, receipt fields, and fixed chips. Does not sign or pay. Not a rating.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["policy", "requirement"],
    properties: {
      policy: { type: "object" },
      requirement: {
        type: "object",
        additionalProperties: true,
        properties: {
          amount: { type: "string" },
          payTo: { type: "string" },
          network: { type: "string" },
          resource: { type: "object" },
        },
      },
      measured: { type: "object" },
      team_id: { type: "string" },
      agent_id: { type: "string" },
    },
  },
} as const;

export interface GuardAuth {
  org_id: string;
  team_id?: string | null;
  agent_id?: string | null;
  scopes: readonly string[];
}

export type ResolveGuardAuth = (request: Request, env: Env) => Promise<GuardAuth | Response>;

export function guardCheckEnabled(env: Env): boolean {
  return env.FEATURE_GUARD_CHECK === "true";
}

interface CheckBody {
  policy?: CustomerPolicy;
  requirement?: Record<string, unknown>;
  measured?: MeasuredFacts | null;
  org_id?: unknown;
  team_id?: unknown;
  agent_id?: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export async function runGuardCheck(args: {
  auth: GuardAuth;
  body: CheckBody;
  signingKeyId?: string;
  now?: Date;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!args.auth.scopes.includes(GUARD_CHECK_SCOPE)) {
    return { status: 403, body: { error: "guard_check_scope_required" } };
  }
  if (args.body.org_id !== undefined && args.body.org_id !== args.auth.org_id) {
    return { status: 403, body: { error: "org_mismatch" } };
  }
  // A token that is tied to one team or one agent cannot label a receipt with another. A token with no
  // team or agent of its own (an org-level token) may name the team and agent the check is for.
  if (args.auth.team_id != null && args.body.team_id !== undefined && args.body.team_id !== args.auth.team_id) {
    return { status: 403, body: { error: "team_mismatch" } };
  }
  if (args.auth.agent_id != null && args.body.agent_id !== undefined && args.body.agent_id !== args.auth.agent_id) {
    return { status: 403, body: { error: "agent_mismatch" } };
  }
  const policy = args.body.policy;
  const requirement = asRecord(args.body.requirement);
  if (!policy || !requirement) return { status: 400, body: { error: "invalid_body" } };

  let signingKeyId: string | null = null;
  if (args.signingKeyId !== undefined && args.signingKeyId !== "") {
    try {
      signingKeyId = assertPolicySigningKeyId(args.signingKeyId);
    } catch {
      return { status: 500, body: { error: "policy_signing_key_refused" } };
    }
  }

  const evaluation = evaluateCustomerPolicy(policy, requirement, {
    measured: args.body.measured ?? null,
    now: args.now,
  });
  let receipt;
  try {
    receipt = await buildPolicyReceipt({
      evaluation,
      orgId: args.auth.org_id,
      teamId: args.auth.team_id ?? (typeof args.body.team_id === "string" ? args.body.team_id : null),
      agentId: args.auth.agent_id ?? (typeof args.body.agent_id === "string" ? args.body.agent_id : null),
      policyId: typeof policy.id === "string" ? policy.id : "",
      policyVersion: typeof policy.version === "string" ? policy.version : "",
    });
  } catch {
    return { status: 400, body: { error: "invalid_body" } };
  }

  return {
    status: 200,
    body: {
      verdict: evaluation.verdict,
      your_policy: true,
      not_a_botsrated_rating: true,
      fail_mode: evaluation.fail_mode,
      rule_hit: evaluation.rule_hit,
      chips: evaluation.chips,
      read_only: true,
      pays: false,
      // This stub does not open D1, so it cannot look the measured facts up itself. The chips are built from
      // what the caller sent, and the response says so.
      measured_source: args.body.measured == null ? "none" : "caller",
      signature_present: false,
      signing_key_scope: "nonprod",
      signing_key_id: signingKeyId,
      sig: null,
      receipt,
      message: evaluation.message,
    },
  };
}

/**
 * Read the request body as UTF-8, stopping as soon as it is over `limit` bytes.
 * Returns null when it is too large, so an oversized body is never held in memory or parsed.
 */
async function readBodyUpTo(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

export async function handleGuardCheck(request: Request, env: Env, resolve: ResolveGuardAuth): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== GUARD_CHECK_PATH) return json(404, { error: "not_found" });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!guardCheckEnabled(env)) return json(501, { error: "coming", message: "Guard check is off." });
  if (!bearer(request)) return json(401, { error: "bearer_required" });

  let auth: GuardAuth | Response;
  try {
    auth = await resolve(request, env);
  } catch {
    return json(401, { error: "bearer_required" });
  }
  if (auth instanceof Response) return auth;

  const text = await readBodyUpTo(request, MAX_BODY_BYTES);
  if (text === null) return json(413, { error: "body_too_large" });
  let body: CheckBody;
  try {
    body = JSON.parse(text) as CheckBody;
  } catch {
    return json(400, { error: "invalid_body" });
  }
  const result = await runGuardCheck({ auth, body, signingKeyId: env.GUARD_POLICY_SIGNING_KEY_ID });
  return json(result.status, result.body);
}

export async function callGuardCheckTool(
  args: CheckBody,
  auth: GuardAuth,
  env: Env,
): Promise<{ isError: boolean; content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> }> {
  if (!guardCheckEnabled(env)) {
    return {
      isError: true,
      content: [{ type: "text", text: "Guard check is off." }],
      structuredContent: { error: "coming", read_only: true, pays: false },
    };
  }
  const result = await runGuardCheck({ auth, body: args, signingKeyId: env.GUARD_POLICY_SIGNING_KEY_ID });
  return {
    isError: result.status !== 200,
    content: [{ type: "text", text: String(result.body.message ?? result.body.error ?? "") }],
    structuredContent: result.body,
  };
}
