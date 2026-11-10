/**
 * Local Guard checks that ship inside the installed client.
 *
 * These match the live Guard page (https://botsrated.com/tools/payment-guard):
 * repeat_payment, delivery_check, payto_base58_format, and quote_above_listing.
 * Each warns by default. None of them calls the seller, and none resends a payment.
 * replay_tested stays false: this module does not resend a settled payment.
 */
import { cleanText, hostAndPath, isAtomicAmount, isBase58Pubkey, isBytes32, networkFamily, tryHostOf } from "./util.js";

/** The repeat check never resends a settled payment, so this stays false. */
export const REPLAY_TESTED = false;
/** How long a repeated payment identifier or tuple stays a repeat. */
export const REPEAT_WINDOW_MS = 60_000;
export const QUOTE_ABOVE_LISTING_FACT = "the quoted amount is above the listed amount.";

const BANNED_FACT =
  /\b(safe|unsafe|suspicious|scam|scams|fraud|fraudulent|trusted|untrusted|prevent\w*|guarantee\w*|compliant|secure|insured)\b|trust score|verified seller/i;

/** Content types the delivery check accepts. A parameter such as charset is ignored. `+json` types are accepted too. */
export const DELIVERY_CONTENT_TYPES = new Set(["application/json", "application/problem+json", "text/plain", "text/json"]);

export type RepeatHit = "payment_identifier" | "tuple" | "both";

export interface RepeatSighting {
  paymentId?: string;
  host?: string;
  route?: string;
  amount?: string;
  nonce?: string;
}

/** In-process 60-second window. No network. A third identical sighting stays a warning when the caller left the effect at warn. */
export class RepeatWindow {
  private ids = new Map<string, number>();
  private tuples = new Map<string, number>();

  constructor(private readonly windowMs = REPEAT_WINDOW_MS, private readonly max = 256) {}

  /** A different sighting of the same id or the same host, route, amount and nonce inside the window. */
  check(sighting: RepeatSighting, now: number): RepeatHit | undefined {
    this.prune(now);
    const idHit = !!sighting.paymentId && this.fresh(this.ids.get(sighting.paymentId), now);
    const key = tupleKey(sighting);
    const tupleHit = !!key && this.fresh(this.tuples.get(key), now);
    if (idHit && tupleHit) return "both";
    if (idHit) return "payment_identifier";
    if (tupleHit) return "tuple";
    return undefined;
  }

  /** Remember this sighting. Does not itself decide a repeat. */
  record(sighting: RepeatSighting, now: number): void {
    this.prune(now);
    if (sighting.paymentId) this.ids.set(sighting.paymentId, now);
    const key = tupleKey(sighting);
    if (key) this.tuples.set(key, now);
    this.cap(this.ids);
    this.cap(this.tuples);
  }

  private fresh(at: number | undefined, now: number): boolean {
    return at !== undefined && now - at < this.windowMs && now >= at;
  }

  private prune(now: number): void {
    for (const [k, at] of this.ids) if (now - at >= this.windowMs) this.ids.delete(k);
    for (const [k, at] of this.tuples) if (now - at >= this.windowMs) this.tuples.delete(k);
  }

  private cap(map: Map<string, number>): void {
    while (map.size > this.max) {
      const oldest = [...map.entries()].sort((a, b) => a[1] - b[1])[0];
      if (!oldest) return;
      map.delete(oldest[0]);
    }
  }
}

export function repeatFact(hit: RepeatHit): string {
  const which =
    hit === "payment_identifier"
      ? "the same payment identifier repeated within 60 seconds"
      : hit === "tuple"
        ? "the same host, route, amount and nonce repeated within 60 seconds"
        : "the same payment identifier, or the same host, route, amount and nonce, repeated within 60 seconds";
  return `${which}. replay_tested is false.`;
}

function paymentIdOk(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function nonceOk(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  // These helpers are type predicates on `unknown`. Calling them directly would narrow a string to `never`.
  const bytes32 = (v: string) => isBytes32(v);
  const base58 = (v: string) => isBase58Pubkey(v);
  if (bytes32(text)) return text.toLowerCase();
  if (base58(text)) return text;
  if (text.length >= 16 && text.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(text)) return text;
  return undefined;
}

function readPaymentId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const ext = (value as { extensions?: unknown }).extensions;
  const info = ext && typeof ext === "object" ? (ext as Record<string, unknown>)["payment-identifier"] : undefined;
  const id = info && typeof info === "object" ? (info as { info?: { id?: unknown } }).info?.id : undefined;
  return paymentIdOk(id) ? id : undefined;
}

/** Payment identifier from the 402 extension, the requirements, or an already built payload. */
export function paymentIdentifierOf(...sources: unknown[]): string | undefined {
  for (const source of sources) {
    const direct = readPaymentId(source);
    if (direct) return direct;
    if (!source || typeof source !== "object") continue;
    const extra = (source as { extra?: unknown }).extra;
    if (extra && typeof extra === "object") {
      const bag = extra as Record<string, unknown>;
      for (const key of ["paymentIdentifier", "payment_identifier", "payment-identifier"]) {
        if (paymentIdOk(bag[key])) return bag[key];
      }
    }
  }
  return undefined;
}

/** Nonce from an authorization or from requirement extra. Query strings are not read. */
export function nonceOf(...sources: unknown[]): string | undefined {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const auth = (source as { payload?: { authorization?: { nonce?: unknown } } }).payload?.authorization?.nonce;
    const fromAuth = nonceOk(auth);
    if (fromAuth) return fromAuth;
    const direct = nonceOk((source as { nonce?: unknown }).nonce);
    if (direct) return direct;
    const extra = (source as { extra?: { nonce?: unknown } }).extra?.nonce;
    const fromExtra = nonceOk(extra);
    if (fromExtra) return fromExtra;
  }
  return undefined;
}

export function repeatSighting(parts: { paymentId?: string; url?: string; amount?: unknown; nonce?: string; host?: string }): RepeatSighting {
  const route = parts.url ? hostAndPath(parts.url) : undefined;
  const amount = typeof parts.amount === "bigint" ? parts.amount.toString() : typeof parts.amount === "number" && Number.isSafeInteger(parts.amount) ? String(parts.amount) : parts.amount;
  const host = parts.host ?? route?.host ?? tryHostOf(parts.url);
  return {
    ...(parts.paymentId ? { paymentId: parts.paymentId } : {}),
    ...(host ? { host } : {}),
    ...(route?.path ? { route: route.path } : {}),
    ...(isAtomicAmount(amount) ? { amount: String(amount) } : {}),
    ...(parts.nonce ? { nonce: parts.nonce } : {}),
  };
}

function tupleKey(sighting: RepeatSighting): string | undefined {
  if (!sighting.host || !sighting.route || !sighting.amount || !sighting.nonce) return undefined;
  return `${sighting.host}\n${sighting.route}\n${sighting.amount}\n${sighting.nonce}`;
}

export interface PayToBase58Assessment {
  applies: boolean;
  valid: boolean | null;
  code: "payto_base58_format";
}

/**
 * Solana payTo format. A Base (eip155) payTo is not judged: applies is false and valid is null.
 * A Solana payTo must be a base58 32-byte public key.
 */
export function payToBase58Assessment(network: unknown, payTo: unknown): PayToBase58Assessment {
  if (networkFamily(network) !== "solana") return { applies: false, valid: null, code: "payto_base58_format" };
  return { applies: true, valid: isBase58Pubkey(payTo), code: "payto_base58_format" };
}

export const PAYTO_BASE58_FACT = "the payTo in this payment request is not a base58 32-byte public key.";

export function quoteAboveListingSentence(amount: string, listed: string): string {
  return `the quoted amount (${amount} atomic units) is above the listed amount (${listed}).`;
}

/** Listed atomic amount from a preflight or check body. Probe listed_amount wins, then listing.amount_atomic. */
export function listedAmountOf(body: { latest_probe?: { listed_amount?: unknown }; listing?: { amount_atomic?: unknown } } | null | undefined): string | undefined {
  const probe = body?.latest_probe?.listed_amount;
  if (isAtomicAmount(probe)) return probe;
  const listing = body?.listing?.amount_atomic;
  return isAtomicAmount(listing) ? listing : undefined;
}

const SCHEMA_KEYS = new Set(["$schema", "type", "properties", "required", "items", "enum", "const", "anyOf", "oneOf", "allOf"]);

function isJsonSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => SCHEMA_KEYS.has(key));
}

/** JSON schema the seller declared for the paid response. The payment-identifier extension schema is not this. */
export function declaredOutputSchema(...sources: unknown[]): Record<string, unknown> | undefined {
  const found: unknown[] = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const bag = source as Record<string, any>;
    found.push(
      bag.extensions?.bazaar?.info?.output?.schema,
      bag.extensions?.bazaar?.info?.output?.jsonSchema,
      bag.resource?.schema,
      bag.outputSchema,
      bag.output_schema,
      bag.extra?.outputSchema,
      bag.extra?.output_schema,
    );
  }
  for (const item of found) {
    if (!isJsonSchema(item)) continue;
    try {
      if (JSON.stringify(item).length > 65_536) return undefined;
    } catch {
      return undefined;
    }
    return item;
  }
  return undefined;
}

export type SchemaStatus = "not_declared" | "pass" | "fail" | "not_evaluated";
/** How many schema nodes one delivery check will visit. Past this, the schema is not evaluated and the check warns. */
export const SCHEMA_WORK_BUDGET = 20_000;
/** Bytes read from a response body for the delivery check. The reader stops here; it does not buffer the rest first. */
export const DELIVERY_READ_CAP = 1_000_000;
/** How long the background read may wait, in total, before it releases the stream. */
export const DELIVERY_READ_DEADLINE_MS = 5_000;

export interface SchemaWork {
  left: number;
  exhausted: boolean;
  /** Last value whose size was measured, so a later comparison does not measure it again. */
  sized?: unknown;
  sizedCost?: number;
}

export function schemaWork(): SchemaWork {
  return { left: SCHEMA_WORK_BUDGET, exhausted: false };
}

function takeWork(work: SchemaWork, n = 1): boolean {
  if (work.exhausted || work.left < n) {
    work.exhausted = true;
    work.left = 0;
    return false;
  }
  work.left -= n;
  return true;
}

export interface DeliveryCheck {
  code: "delivery_check";
  rule: "a 2xx is not a delivery";
  blocks_by_default: false;
  checks: {
    http_2xx: boolean;
    body_non_empty: boolean;
    content_type_sane: boolean;
    schema: SchemaStatus;
  };
  outcome: "delivered" | "not_a_delivery";
  effect: "allow" | "warn";
}

export function contentTypeSane(header: string | null | undefined): boolean {
  if (typeof header !== "string") return false;
  const media = header.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!media || media.length > 120 || /\s/.test(media)) return false;
  if (DELIVERY_CONTENT_TYPES.has(media)) return true;
  return media.endsWith("+json") && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(media);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeOk(spec: unknown, value: unknown): boolean {
  const names = Array.isArray(spec) ? spec : [spec];
  const got = typeName(value);
  return names.some((name) => name === got || (name === "number" && got === "integer"));
}

/** Own-key counts already charged. A later comparison does not start another key walk. */
const responseKeyCounts = new WeakMap<object, number>();

/**
 * Count a response object's own keys once and charge that count.
 * Starting a key walk on a large object is expensive, so it happens only the first time.
 */
function chargedKeyCount(work: SchemaWork, value: object): number | undefined {
  const cached = responseKeyCounts.get(value);
  if (cached !== undefined) return cached;
  let n = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    n += 1;
    if (n > work.left) {
      takeWork(work, n);
      return undefined;
    }
  }
  if (!takeWork(work, n)) return undefined;
  responseKeyCounts.set(value, n);
  return n;
}

/**
 * Equal for schema const/enum. Walks the schema literal and stops at the first mismatch.
 * The response value is never serialized. Each response object's keys are counted once and charged.
 */
function sameJson(literal: unknown, value: unknown, work: SchemaWork, depth = 0): boolean {
  if (work.exhausted) return false;
  if (literal === value) return true;
  if (depth > 32 || typeof literal !== "object" || typeof value !== "object" || literal === null || value === null) return false;
  const literalIsArray = Array.isArray(literal);
  if (literalIsArray !== Array.isArray(value)) return false;
  if (literalIsArray) {
    const left = literal as unknown[];
    const right = value as unknown[];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!sameJson(left[i], right[i], work, depth + 1)) return false;
    return !work.exhausted;
  }
  const left = literal as Record<string, unknown>;
  const right = value as Record<string, unknown>;
  const counted = chargedKeyCount(work, right);
  if (counted === undefined) return false;
  const keys = Object.keys(left);
  if (counted !== keys.length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !sameJson(left[key], right[key], work, depth + 1)) return false;
  }
  return !work.exhausted;
}

/** Extra visits for a schema literal, roughly one per 64 serialized bytes. Numbers cost nothing extra. */
function compareSizeCost(value: unknown): number {
  if (typeof value === "string") return Math.ceil(value.length / 64);
  if (value == null || typeof value === "number" || typeof value === "boolean") return 0;
  try {
    return Math.ceil(JSON.stringify(value).length / 64);
  } catch {
    return 1;
  }
}

/**
 * Visits owed by the response value. Measured once per value. Strings use their length.
 * Objects and arrays count keys and nested strings, and stop once the count passes the budget.
 */
function instanceCost(work: SchemaWork, value: unknown): number {
  if (work.sized === value && work.sizedCost !== undefined) return work.sizedCost;
  let cost = 1;
  if (typeof value === "string") cost = Math.max(1, Math.ceil(value.length / 64));
  else if (value && typeof value === "object") {
    let n = 0;
    const limit = work.left + 1;
    if (Array.isArray(value)) {
      n = value.length;
      if (n <= limit) {
        for (const item of value) {
          if (typeof item === "string") n += Math.ceil(item.length / 64);
          if (n > limit) break;
        }
      }
    } else {
      for (const key in value as object) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        n += 1;
        const child = (value as Record<string, unknown>)[key];
        if (typeof child === "string") n += Math.ceil(child.length / 64);
        if (n > limit) break;
      }
    }
    cost = Math.max(1, n);
  }
  work.sized = value;
  work.sizedCost = cost;
  return cost;
}

const allowedKeys = new WeakMap<object, Set<string>>();

function allowedKeySet(properties: object): Set<string> {
  let set = allowedKeys.get(properties);
  if (!set) {
    set = new Set(Object.keys(properties));
    allowedKeys.set(properties, set);
  }
  return set;
}

/** A small JSON Schema check. Stops when {@link SCHEMA_WORK_BUDGET} is used up so a seller schema cannot tie up the process. */
export function schemaMatches(schema: unknown, value: unknown, depth = 0, work: SchemaWork = schemaWork()): boolean {
  if (!takeWork(work)) return false;
  if (depth > 12 || !schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.allOf)) {
    for (const part of s.allOf) if (!schemaMatches(part, value, depth + 1, work)) return false;
  }
  if (Array.isArray(s.anyOf)) {
    let any = false;
    for (const part of s.anyOf) {
      if (work.exhausted) return false;
      if (schemaMatches(part, value, depth + 1, work)) {
        any = true;
        break;
      }
    }
    if (!any) return false;
  }
  if (Array.isArray(s.oneOf)) {
    let hits = 0;
    for (const part of s.oneOf) {
      if (work.exhausted) return false;
      if (schemaMatches(part, value, depth + 1, work)) hits += 1;
      if (hits > 1) return false;
    }
    if (hits !== 1) return false;
  }
  if (Object.prototype.hasOwnProperty.call(s, "const")) {
    // Charge the response value as well as the literal. A number literal is tiny; the body may not be.
    if (!takeWork(work, 1 + compareSizeCost(s.const) + instanceCost(work, value))) return false;
    if (!sameJson(s.const, value, work)) return false;
  }
  if (Array.isArray(s.enum)) {
    // Charge the length up front. Math.min(len, 1) was always 1, so a long enum was free.
    if (!takeWork(work, s.enum.length)) return false;
    const valueCost = instanceCost(work, value);
    let found = false;
    for (const item of s.enum) {
      if (work.exhausted) return false;
      if (!takeWork(work, valueCost + compareSizeCost(item))) return false;
      if (sameJson(item, value, work)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  if (s.type !== undefined && !typeOk(s.type, value)) return false;
  if (typeof s.minLength === "number" && (typeof value !== "string" || value.length < s.minLength)) return false;
  if (typeof s.maxLength === "number" && (typeof value !== "string" || value.length > s.maxLength)) return false;
  if (typeof s.minimum === "number" && (typeof value !== "number" || value < s.minimum)) return false;
  if (typeof s.maximum === "number" && (typeof value !== "number" || value > s.maximum)) return false;
  const looksObject = s.properties !== undefined || s.required !== undefined || s.additionalProperties === false || s.type === "object";
  if (looksObject) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    if (Array.isArray(s.required)) {
      if (!takeWork(work, s.required.length)) return false;
      for (const key of s.required) if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(obj, key)) return false;
    }
    if (s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)) {
      const entries = Object.entries(s.properties as Record<string, unknown>).filter(
        ([key]) => key !== "__proto__" && key !== "constructor" && key !== "prototype",
      );
      if (!takeWork(work, entries.length)) return false;
      for (const [key, sub] of entries) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && !schemaMatches(sub, obj[key], depth + 1, work)) return false;
      }
      if (s.additionalProperties === false) {
        // Pay for the object's keys before enumerating them. A wide body must not be listed in full first.
        if (!takeWork(work, instanceCost(work, obj))) return false;
        const allowed = allowedKeySet(s.properties as object);
        for (const key in obj) {
          if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
          if (!takeWork(work, 1)) return false;
          if (!allowed.has(key)) return false;
        }
      }
    } else if (s.additionalProperties === false) {
      if (!takeWork(work, instanceCost(work, obj))) return false;
      for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        if (!takeWork(work, 1)) return false;
        return false;
      }
    }
  }
  if (s.items !== undefined || s.type === "array") {
    if (!Array.isArray(value)) return false;
    if (s.items && typeof s.items === "object" && !Array.isArray(s.items)) {
      for (const item of value) {
        if (!takeWork(work, 1)) return false;
        if (!schemaMatches(s.items, item, depth + 1, work)) return false;
      }
    }
  }
  return !work.exhausted;
}

/**
 * A 2xx is not a delivery. Warns unless the body is non-empty, the content type is one this check accepts,
 * and a JSON schema the seller declared matches. The effect is warn or allow. This check does not block.
 */
export function evaluateDelivery(input: { status: number; body: Uint8Array | string; contentType?: string | null; schema?: unknown; truncated?: boolean }): DeliveryCheck {
  const bytes = typeof input.body === "string" ? new TextEncoder().encode(input.body) : input.body;
  const http2xx = Number.isInteger(input.status) && input.status >= 200 && input.status < 300;
  const bodyNonEmpty = bytes.byteLength > 0;
  const typeSane = contentTypeSane(input.contentType);
  let schema: SchemaStatus = "not_declared";
  if (input.schema !== undefined && input.schema !== null) {
    schema = "fail";
    if (!input.truncated && isJsonSchema(input.schema)) {
      const text = typeof input.body === "string" ? input.body : new TextDecoder().decode(bytes);
      try {
        const work = schemaWork();
        const matched = schemaMatches(input.schema, JSON.parse(text), 0, work);
        schema = work.exhausted ? "not_evaluated" : matched ? "pass" : "fail";
      } catch {
        schema = "fail";
      }
    }
  }
  const delivered = http2xx && bodyNonEmpty && typeSane && schema === "pass";
  return {
    code: "delivery_check",
    rule: "a 2xx is not a delivery",
    blocks_by_default: false,
    checks: { http_2xx: http2xx, body_non_empty: bodyNonEmpty, content_type_sane: typeSane, schema },
    outcome: delivered ? "delivered" : "not_a_delivery",
    effect: delivered ? "allow" : "warn",
  };
}

export function deliveryFact(check?: DeliveryCheck): string {
  if (check?.checks.schema === "not_evaluated") {
    return "a 2xx is not a delivery. The declared JSON schema was too large to evaluate.";
  }
  if (!check || check.checks.schema !== "not_declared") {
    return "a 2xx is not a delivery. The body, content type, or declared JSON schema did not all match.";
  }
  if (!check.checks.body_non_empty) return "a 2xx is not a delivery. The body is empty.";
  if (!check.checks.content_type_sane) return "a 2xx is not a delivery. The content type is not one this check accepts.";
  return "a 2xx is not a delivery. The seller declared no JSON schema for this response.";
}

const STREAMING_TYPES = new Set(["text/event-stream", "application/x-ndjson", "multipart/x-mixed-replace"]);

/** Streaming responses are not read. Other bodies are read only up to {@link DELIVERY_READ_CAP}. */
export function isStreamingContentType(header: string | null | undefined): boolean {
  if (typeof header !== "string") return false;
  const media = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return STREAMING_TYPES.has(media);
}

function readOrDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<{ done: boolean; value?: Uint8Array; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ done: true, timedOut: true });
    }, ms);
    reader.read().then(
      (chunk) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ done: chunk.done, value: chunk.value, timedOut: false });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ done: true, timedOut: false });
      },
    );
  });
}

/** Read at most {@link DELIVERY_READ_CAP} bytes, and for at most {@link DELIVERY_READ_DEADLINE_MS}. Does not await cancel. */
export async function readDeliveryBody(res: Response): Promise<{ body: Uint8Array; truncated: boolean; skipped: boolean }> {
  const empty = { body: new Uint8Array(), truncated: false, skipped: true as boolean };
  const contentType = res.headers.get("content-type");
  if (isStreamingContentType(contentType)) return empty;
  if (!res.body || res.body.locked) return empty;
  let clone: Response;
  try {
    clone = res.clone();
  } catch {
    return empty;
  }
  const reader = clone.body?.getReader();
  if (!reader) return { body: new Uint8Array(), truncated: false, skipped: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const started = Date.now();
  try {
    while (total < DELIVERY_READ_CAP) {
      const remaining = DELIVERY_READ_DEADLINE_MS - (Date.now() - started);
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const chunk = await readOrDeadline(reader, remaining);
      if (chunk.timedOut) {
        truncated = true;
        break;
      }
      if (chunk.done) break;
      if (!chunk.value || chunk.value.byteLength === 0) continue;
      const room = DELIVERY_READ_CAP - total;
      if (chunk.value.byteLength > room) {
        chunks.push(chunk.value.subarray(0, room));
        total += room;
        truncated = true;
        break;
      }
      chunks.push(chunk.value);
      total += chunk.value.byteLength;
    }
  } finally {
    // Do not await. The caller's cancel waits until this branch cancels, and awaiting it can wait on the caller.
    reader.cancel().catch(() => undefined);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, truncated, skipped: false };
}

/** Run a delivery note without holding the response. Errors are swallowed. */
export function scheduleDeliveryCheck(task: () => Promise<void>): void {
  void task().catch(() => undefined);
}

export interface ServerReasonSplit {
  quoteFact?: string;
  otherWarnOrBlock: boolean;
  hasReasons: boolean;
}

/** Pull quote_above_listing out of a policy-check body. Other warn/block reasons stay on the aggregate decision. */
export function splitPolicyReasons(body: unknown): ServerReasonSplit {
  if (!body || typeof body !== "object" || !Array.isArray((body as { reasons?: unknown }).reasons)) {
    return { otherWarnOrBlock: false, hasReasons: false };
  }
  const reasons = (body as { reasons: unknown[] }).reasons;
  let quoteFact: string | undefined;
  let otherWarnOrBlock = false;
  for (const item of reasons) {
    if (!item || typeof item !== "object") continue;
    const row = item as { rule?: unknown; code?: unknown; effect?: unknown; fact?: unknown };
    const rule = typeof row.rule === "string" ? row.rule : typeof row.code === "string" ? row.code : "";
    const effect = typeof row.effect === "string" ? row.effect.trim().toLowerCase() : "";
    if (rule === "quote_above_listing") {
      if (!quoteFact) quoteFact = cleanServerFact(row.fact);
    } else if (effect === "warn" || effect === "block") {
      otherWarnOrBlock = true;
    }
  }
  return { ...(quoteFact ? { quoteFact } : {}), otherWarnOrBlock, hasReasons: reasons.length > 0 };
}

function cleanServerFact(fact: unknown): string {
  if (typeof fact !== "string") return QUOTE_ABOVE_LISTING_FACT;
  const cleaned = cleanText(fact, 240);
  if (!cleaned || cleaned.length < 8 || BANNED_FACT.test(cleaned)) return QUOTE_ABOVE_LISTING_FACT;
  return cleaned;
}
