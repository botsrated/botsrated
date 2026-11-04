/**
 * Customer-policy pass/fail for Desk Guard.
 *
 * The verdict cites the customer's rule. It is not a BotsRated grade.
 * Only signed requirement fields are inputs: amount, payTo, network, and the
 * host of resource.url. Seller text is never read.
 *
 * Measured chips are facts the caller already has. This module does not probe,
 * sign a payment, or hold funds. A policy receipt signature, when one is made,
 * uses a non-prod key id scoped `botsrated-guard-policy-…`.
 *
 * The same rules are checked against docs/guard/policy-vectors.json from the
 * worker stub and the Python mirror.
 */
export const GUARD_CHIPS = ["live", "402 ok", "payTo changed", "probe failed", "no data yet"] as const;
export type GuardChip = (typeof GUARD_CHIPS)[number];

export const POLICY_RECEIPT_SPEC = "botsrated-guard-policy-receipt/1";
export const POLICY_SIGNING_KEY_PREFIX = "botsrated-guard-policy-";

/** Measurement keys that must not sign a policy receipt. */
export const POLICY_SIGNING_KEY_DENY = ["botsrated-prod-1", "botsrated-prober-1", "botsrated-staging-1"] as const;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ATOMIC = /^[0-9]{1,78}$/;
// Control, bidi, and zero-width characters. Seller text is not read; this still caps our own sentences.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

function cleanText(value: unknown, max = 120): string {
  const text = String(value ?? "").replace(UNSAFE_CHARS, "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS.test(value);
}

function isAtomicAmount(value: unknown): value is string {
  return typeof value === "string" && ATOMIC.test(value);
}

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const NETWORK = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,39}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const EVIDENCE = /^https:\/\/(www\.)?botsrated\.com\//i;
const MAX_LIST = 32;

export type RuleHit = "none" | "amount" | "pay_to" | "network" | "resource_host" | "unevaluable";
export type FailMode = "open" | "closed";

export interface CustomerPolicy {
  id?: unknown;
  version?: unknown;
  fail_mode?: unknown;
  failMode?: unknown;
  max_amount_atomic?: unknown;
  pay_to?: unknown;
  networks?: unknown;
  resource_hosts?: unknown;
  /**
   * Opt-in chip list for the client halt. `evaluateCustomerPolicy` does not
   * read this. See halt-policy.
   */
  halt_on?: unknown;
  /**
   * Opt-in sample for the client halt. `evaluateCustomerPolicy` does not read
   * this. See halt-policy.
   */
  strict_mode?: unknown;
}

export interface MeasuredFacts {
  as_of?: unknown;
  expires_at?: unknown;
  pay_to_unchanged?: unknown;
  valid_402?: unknown;
  probe_failed?: unknown;
  no_data_yet?: unknown;
  evidence_url?: unknown;
}

export interface RequirementEcho {
  amount: string | null;
  pay_to: string | null;
  network: string | null;
  resource_host: string | null;
}

export interface MeasuredEcho {
  pay_to_unchanged: boolean | null;
  last_checked: string | null;
  valid_402: boolean | null;
  as_of: string | null;
  expires_at: string | null;
  evidence_url: string | null;
}

export interface PolicyEvaluation {
  verdict: "pass" | "fail" | null;
  rule_hit: RuleHit;
  fail_mode: FailMode;
  abort: boolean;
  chips: GuardChip[];
  your_policy: true;
  not_a_botsrated_rating: true;
  requirement: RequirementEcho;
  measured: MeasuredEcho;
  message: string;
}

export interface EvaluateOptions {
  resourceUrl?: unknown;
  measured?: MeasuredFacts | null;
  now?: Date | string;
  /**
   * The MCP `policies` slot cannot see `resource.url`. Set false there so a
   * host rule waits for the hook. Default true.
   */
  enforceResourceHost?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return LABEL.test(text) ? text : null;
}

function httpHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.includes("*") || text.length > 2048) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.replace(/\.+$/, "").toLowerCase();
    if (!host || host.length > 253 || !host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

function policyHost(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text || text.includes("*") || text.includes("/") || text.includes(":") || text.includes("?")) return null;
  return httpHost(`https://${text}`);
}

function readOwn(record: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  const value = record[key];
  return value === undefined ? undefined : value;
}

function payToOf(requirement: Record<string, unknown>): { value: unknown; conflict: boolean } {
  const camel = readOwn(requirement, "payTo");
  const snake = readOwn(requirement, "pay_to");
  if (camel !== undefined && snake !== undefined && String(camel).toLowerCase() !== String(snake).toLowerCase()) {
    return { value: undefined, conflict: true };
  }
  return { value: camel !== undefined ? camel : snake, conflict: false };
}

function resourceUrlOf(requirement: Record<string, unknown>, explicit: unknown): { url: unknown; conflict: boolean } {
  let embedded: unknown;
  const resource = readOwn(requirement, "resource");
  if (isRecord(resource)) embedded = readOwn(resource, "url");
  else if (readOwn(requirement, "resource_url") !== undefined) embedded = readOwn(requirement, "resource_url");
  if (explicit === undefined) return { url: embedded, conflict: false };
  if (embedded === undefined) return { url: explicit, conflict: false };
  const a = httpHost(explicit);
  const b = httpHost(embedded);
  if (a && b && a !== b) return { url: explicit, conflict: true };
  return { url: explicit, conflict: false };
}

function iso(value: unknown): string | null {
  if (typeof value !== "string" || !ISO.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? value : null;
}

function evidenceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300 || !EVIDENCE.test(value)) return null;
  return value;
}

export function chipsFromMeasured(measured: MeasuredEcho, live: boolean): GuardChip[] {
  if (!measured.as_of && measured.pay_to_unchanged === null && measured.valid_402 === null) return ["no data yet"];
  if (measured.as_of && measured.pay_to_unchanged === null && measured.valid_402 === null && measured.expires_at === null) {
    return ["probe failed"];
  }
  const chips: GuardChip[] = [];
  if (live) chips.push("live");
  if (measured.valid_402 === true) chips.push("402 ok");
  if (measured.pay_to_unchanged === false) chips.push("payTo changed");
  return chips.length ? chips : ["no data yet"];
}

function normalizeMeasured(input: MeasuredFacts | null | undefined, now: Date): { echo: MeasuredEcho; chips: GuardChip[] } {
  const empty: MeasuredEcho = {
    pay_to_unchanged: null,
    last_checked: null,
    valid_402: null,
    as_of: null,
    expires_at: null,
    evidence_url: null,
  };
  if (!input || input.no_data_yet === true) return { echo: empty, chips: ["no data yet"] };
  const asOf = iso(input.as_of);
  const evidence = evidenceUrl(input.evidence_url);
  if (input.probe_failed === true) {
    const echo: MeasuredEcho = { ...empty, as_of: asOf, last_checked: asOf, evidence_url: evidence };
    return { echo, chips: asOf ? ["probe failed"] : ["no data yet"] };
  }
  const expires = iso(input.expires_at);
  const echo: MeasuredEcho = {
    pay_to_unchanged: typeof input.pay_to_unchanged === "boolean" ? input.pay_to_unchanged : null,
    valid_402: typeof input.valid_402 === "boolean" ? input.valid_402 : null,
    as_of: asOf,
    last_checked: asOf,
    expires_at: expires,
    evidence_url: evidence,
  };
  const live = !!asOf && !!expires && now.getTime() >= Date.parse(asOf) && now.getTime() < Date.parse(expires);
  const chips: GuardChip[] = !asOf && echo.pay_to_unchanged === null && echo.valid_402 === null ? ["no data yet"] : chipsFromMeasured(echo, live);
  if (!asOf && chips.length === 1 && chips[0] === "probe failed") return { echo, chips: ["no data yet"] };
  return { echo, chips };
}

function listOf(value: unknown, map: (item: unknown) => string | null): { ok: true; values: string[] } | { ok: false } {
  if (value === undefined) return { ok: true, values: [] };
  if (!Array.isArray(value) || value.length > MAX_LIST) return { ok: false };
  const values: string[] = [];
  for (const item of value) {
    const mapped = map(item);
    if (!mapped) return { ok: false };
    values.push(mapped);
  }
  return { ok: true, values };
}

function finish(
  partial: Omit<PolicyEvaluation, "your_policy" | "not_a_botsrated_rating" | "abort" | "message"> & { detail: string },
): PolicyEvaluation {
  const abort = partial.verdict === "fail" || (partial.verdict === null && partial.fail_mode === "closed");
  const message =
    partial.verdict === "pass"
      ? `Your policy passed (${partial.detail}).`
      : partial.verdict === "fail"
        ? `Your policy failed (rule: ${partial.rule_hit}). Fact: ${partial.detail}`
        : `Your policy check returned no decision; fail_mode is ${partial.fail_mode}.`;
  return {
    verdict: partial.verdict,
    rule_hit: partial.rule_hit,
    fail_mode: partial.fail_mode,
    abort,
    chips: partial.chips,
    your_policy: true,
    not_a_botsrated_rating: true,
    requirement: partial.requirement,
    measured: partial.measured,
    message: cleanText(message, 700),
  };
}

/**
 * Compare one signed requirement with the customer's policy.
 * A missing decision is `verdict: null`, never a pass.
 */
export function evaluateCustomerPolicy(
  policy: CustomerPolicy | null | undefined,
  requirement: Record<string, unknown> | null | undefined,
  options: EvaluateOptions = {},
): PolicyEvaluation {
  const now = options.now instanceof Date ? options.now : new Date(typeof options.now === "string" ? options.now : Date.now());
  const measured = normalizeMeasured(options.measured, Number.isFinite(now.getTime()) ? now : new Date());
  const req = isRecord(requirement) ? requirement : {};
  const pay = payToOf(req);
  const resource = resourceUrlOf(req, options.resourceUrl);
  const amountRaw = readOwn(req, "amount");
  const networkRaw = readOwn(req, "network");
  const echo: RequirementEcho = {
    amount: isAtomicAmount(amountRaw) ? amountRaw : null,
    pay_to: !pay.conflict && isAddress(pay.value) ? String(pay.value).toLowerCase() : null,
    network: typeof networkRaw === "string" && NETWORK.test(networkRaw.trim()) ? networkRaw.trim() : null,
    resource_host: resource.conflict ? null : httpHost(resource.url),
  };
  const failDisagree = policy?.fail_mode !== undefined && policy?.failMode !== undefined && policy.fail_mode !== policy.failMode;
  const failRaw = failDisagree ? "disagree" : (policy?.fail_mode ?? policy?.failMode);
  const failMode: FailMode | null = failRaw === undefined ? "open" : failRaw === "open" || failRaw === "closed" ? failRaw : null;
  const id = label(policy?.id);
  const version = label(policy?.version);
  const enforceHost = options.enforceResourceHost !== false;
  const hosts = listOf(policy?.resource_hosts, policyHost);
  const payTos = listOf(policy?.pay_to, (item) => (isAddress(item) ? String(item).toLowerCase() : null));
  const networks = listOf(policy?.networks, (item) => (typeof item === "string" && NETWORK.test(item.trim()) ? item.trim() : null));
  const max = policy?.max_amount_atomic;
  const maxOk = max === undefined || isAtomicAmount(max);
  const badPolicy = !policy || !id || !version || !failMode || !hosts.ok || !payTos.ok || !networks.ok || !maxOk || pay.conflict || resource.conflict;

  const base = {
    fail_mode: failMode ?? "open",
    chips: measured.chips,
    requirement: echo,
    measured: measured.echo,
  };

  if (badPolicy) {
    return finish({ ...base, verdict: null, rule_hit: "unevaluable", detail: "the policy document could not be read" });
  }

  const needAmount = max !== undefined;
  const needPay = policy.pay_to !== undefined;
  const needNetwork = policy.networks !== undefined;
  const needHost = enforceHost && policy.resource_hosts !== undefined;
  if ((needAmount && !echo.amount) || (needPay && !echo.pay_to) || (needNetwork && !echo.network) || (needHost && !echo.resource_host)) {
    return finish({ ...base, verdict: null, rule_hit: "unevaluable", detail: "a signed requirement field is missing" });
  }

  if (needAmount && BigInt(echo.amount!) > BigInt(max as string)) {
    return finish({ ...base, verdict: "fail", rule_hit: "amount", detail: "the signed amount is above your policy ceiling" });
  }
  if (needPay && !payTos.values.includes(echo.pay_to!)) {
    return finish({ ...base, verdict: "fail", rule_hit: "pay_to", detail: "the signed payTo is not in your policy" });
  }
  if (needNetwork && !networks.values.includes(echo.network!)) {
    return finish({ ...base, verdict: "fail", rule_hit: "network", detail: "the signed network is not in your policy" });
  }
  if (needHost && !hosts.values.includes(echo.resource_host!)) {
    return finish({ ...base, verdict: "fail", rule_hit: "resource_host", detail: "the resource.url host is not in your policy" });
  }
  return finish({ ...base, verdict: "pass", rule_hit: "none", detail: `policy ${id} version ${version}` });
}

export function assertPolicySigningKeyId(keyId: unknown): string {
  if (typeof keyId !== "string") throw new TypeError("policy signing key id must be a non-prod scoped id");
  const id = keyId.trim().toLowerCase();
  if ((POLICY_SIGNING_KEY_DENY as readonly string[]).includes(id)) {
    throw new TypeError("policy receipts are not signed with the prod or prober key");
  }
  if (id.startsWith("botsrated-prod") || id.startsWith("botsrated-prober") || id.startsWith("botsrated-staging")) {
    throw new TypeError("policy receipts are not signed with the prod or prober key");
  }
  if (!id.startsWith(POLICY_SIGNING_KEY_PREFIX) || !LABEL.test(id)) {
    throw new TypeError("policy signing key id must be scoped botsrated-guard-policy-");
  }
  return id;
}

export interface PolicyReceiptBody {
  spec: typeof POLICY_RECEIPT_SPEC;
  kind: "guard_policy_receipt";
  id: string;
  org_id: string;
  team_id: string | null;
  agent_id: string | null;
  policy_id: string;
  policy_version: string;
  rule_hit: RuleHit;
  fail_mode: FailMode;
  verdict: "pass" | "fail" | null;
  your_policy: true;
  not_a_botsrated_rating: true;
  rails: ["x402", "mcp"];
  requirement: RequirementEcho;
  measured: MeasuredEcho;
  chips: GuardChip[];
}

export function canon(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canon(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canon(record[key])}`).join(",")}}`;
}

function bytesOf(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}

function hexOf(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function policyReceiptId(bodyWithoutId: Omit<PolicyReceiptBody, "id">): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytesOf(canon(bodyWithoutId)));
  return hexOf(digest).slice(0, 20);
}

export async function buildPolicyReceipt(args: {
  evaluation: PolicyEvaluation;
  orgId: string;
  teamId?: string | null;
  agentId?: string | null;
  policyId: string;
  policyVersion: string;
}): Promise<PolicyReceiptBody> {
  const org = label(args.orgId);
  const team = args.teamId == null || args.teamId === "" ? null : label(args.teamId);
  const agent = args.agentId == null || args.agentId === "" ? null : label(args.agentId);
  if (!org || (args.teamId != null && args.teamId !== "" && !team) || (args.agentId != null && args.agentId !== "" && !agent)) {
    throw new TypeError("receipt ids must be labels");
  }
  const policyId = label(args.policyId);
  const policyVersion = label(args.policyVersion);
  if (!policyId || !policyVersion) throw new TypeError("policy id and version are required");
  const withoutId = {
    spec: POLICY_RECEIPT_SPEC,
    kind: "guard_policy_receipt" as const,
    org_id: org,
    team_id: team,
    agent_id: agent,
    policy_id: policyId,
    policy_version: policyVersion,
    rule_hit: args.evaluation.rule_hit,
    fail_mode: args.evaluation.fail_mode,
    verdict: args.evaluation.verdict,
    your_policy: true as const,
    not_a_botsrated_rating: true as const,
    rails: ["x402", "mcp"] as ["x402", "mcp"],
    requirement: args.evaluation.requirement,
    measured: args.evaluation.measured,
    chips: args.evaluation.chips,
  } satisfies Omit<PolicyReceiptBody, "id">;
  return { ...withoutId, id: await policyReceiptId(withoutId) };
}

export interface PolicyReceiptSignature {
  alg: "ed25519";
  key_id: string;
  sig_b64: string;
  signed: string;
}

/** Sign `canon(receipt)`. Refuses prod and prober key ids before any signature bytes are produced. */
export async function signPolicyReceipt(receipt: PolicyReceiptBody, keyId: string, privateKey: CryptoKey): Promise<PolicyReceiptSignature> {
  const id = assertPolicySigningKeyId(keyId);
  const sig = await crypto.subtle.sign("Ed25519", privateKey, bytesOf(canon(receipt)));
  return {
    alg: "ed25519",
    key_id: id,
    sig_b64: b64Of(sig),
    signed: "Guard policy receipt. Pass or fail is your policy. Not a rating.",
  };
}

export async function verifyPolicyReceipt(receipt: PolicyReceiptBody, signature: PolicyReceiptSignature, publicKey: CryptoKey): Promise<boolean> {
  assertPolicySigningKeyId(signature.key_id);
  if (signature.alg !== "ed25519") return false;
  const raw = Uint8Array.from(atob(signature.sig_b64), (c) => c.charCodeAt(0));
  const copy = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return crypto.subtle.verify("Ed25519", publicKey, copy, bytesOf(canon(receipt)));
}
