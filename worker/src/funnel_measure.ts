// Privacy-conscious request counts for entry, a completed useful check,
// and a paid settlement. The three counts stay side by side. Do not divide
// one count by another. These are not unique people. Mount later from the
// private worker. Do not run the SQL in this change. It does not ALTER
// visits_daily and it does not open a writer.
//
// Entry: one HTML page response. Useful check: a finished 200 on
// /v1/check, /v1/preflight, /v1/find, or /v1/report that is not an error
// and not degraded. Paid: a 2xx the existing code already marks charged.
// One response is paid or a useful check, not both.
//
// Audience is outside, crawler, or internal. Internal is an existing
// callers_week mark, a match of INTERNAL_CALLER_TOKEN, or the published
// prober User-Agent. The token compare is not an authorization decision.
// Authorization is not read. The User-Agent is not stored.
//
// Counts land in visits_daily (day, kind, key) which already exists.
// kind is "funnel". key is "<stage>:<audience>". The historical `human`
// column holds the request count. `bot` stays 0. Readers must say
// "requests".

export const FUNNEL_KIND = "funnel";
export const FUNNEL_STAGES = ["entry", "useful_check", "paid"] as const;
export const FUNNEL_AUDIENCES = ["outside", "crawler", "internal"] as const;
export const FUNNEL_NOTE = "request counts, not unique people";

export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export type FunnelAudience = (typeof FUNNEL_AUDIENCES)[number];

const PROBER_UA = ["BotsRated-probe/", "BotsRated-mcp-probe/", "botsrated-prober"];
const CRAWLERS = [
  "googlebot", "bingbot", "duckduckbot", "baiduspider", "yandexbot", "slurp",
  "facebookexternalhit", "twitterbot", "linkedinbot", "slackbot", "discordbot",
  "telegrambot", "whatsapp", "applebot", "petalbot", "ahrefsbot", "semrushbot",
  "mj12bot", "dotbot", "bytespider", "gptbot", "claudebot", "perplexitybot",
  "amazonbot", "ccbot", "dataforseo", "ia_archiver",
];

const CHECK_EXACT = new Set(["/v1/check", "/v1/preflight", "/v1/find"]);

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function classifyAudience(input: {
  userAgent: string | null;
  internalHeader: string | null;
  internalToken: string | null;
  markedInternal?: boolean;
  surface: "entry" | "check";
}): FunnelAudience {
  if (input.markedInternal === true) return "internal";
  if (tokenMatches(input.internalHeader ?? "", input.internalToken ?? "")) return "internal";
  const ua = input.userAgent ?? "";
  if (PROBER_UA.some((mark) => ua.includes(mark))) return "internal";
  if (ua.length === 0) return input.surface === "entry" ? "crawler" : "outside";
  const lower = ua.toLowerCase();
  if (CRAWLERS.some((mark) => lower.includes(mark))) return "crawler";
  return "outside";
}

export function funnelStageForCheck(pathname: string, status: number, body: unknown, charged: boolean): FunnelStage | null {
  if (isPaidSettlement(status, charged)) return "paid";
  if (isUsefulCheck(pathname, status, body)) return "useful_check";
  return null;
}

export function isPaidSettlement(status: number, charged: boolean): boolean {
  return status >= 200 && status < 300 && charged === true;
}

export function isUsefulCheck(pathname: string, status: number, body: unknown): boolean {
  if (status !== 200 || !isCheckPath(pathname)) return false;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if (record.degraded === true || record.error != null) return false;
  return true;
}

export function funnelKey(stage: FunnelStage, audience: FunnelAudience): string {
  return `${stage}:${audience}`;
}

export interface FunnelRow {
  day: string;
  kind: typeof FUNNEL_KIND;
  key: string;
  human: number;
  bot: 0;
}

/** `human` is a request count. The column name is the existing visits_daily column. */
export function funnelRow(day: string, stage: FunnelStage, audience: FunnelAudience, requests = 1): FunnelRow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("funnel day");
  if (!Number.isInteger(requests) || requests !== 1) throw new Error("funnel increment");
  return { day, kind: FUNNEL_KIND, key: funnelKey(stage, audience), human: 1, bot: 0 };
}

export const FUNNEL_UPSERT_SQL =
  "INSERT INTO visits_daily (day, kind, key, human, bot) VALUES (?, 'funnel', ?, 1, 0) ON CONFLICT(day, kind, key) DO UPDATE SET human = human + 1";

export function funnelUpsertParams(row: FunnelRow): [string, string] {
  return [row.day, row.key];
}

export interface FunnelCell {
  stage: FunnelStage;
  audience: FunnelAudience;
  requests: number;
}

export function summarizeFunnel(rows: readonly { kind?: string; key?: string; human?: number; bot?: number }[]): {
  note: typeof FUNNEL_NOTE;
  cells: FunnelCell[];
} {
  const cells: FunnelCell[] = [];
  for (const stage of FUNNEL_STAGES) {
    for (const audience of FUNNEL_AUDIENCES) {
      const key = funnelKey(stage, audience);
      let requests = 0;
      for (const row of rows) {
        if (row.kind !== FUNNEL_KIND || row.key !== key) continue;
        requests += requestCount(row.human) + requestCount(row.bot);
      }
      cells.push({ stage, audience, requests });
    }
  }
  return { note: FUNNEL_NOTE, cells };
}

export interface FunnelMemory {
  add(row: FunnelRow): void;
  rows(): FunnelRow[];
}

export function openFunnelMemory(): FunnelMemory {
  const map = new Map<string, FunnelRow>();
  return {
    add(row) {
      const id = `${row.day}\u0000${row.key}`;
      const prev = map.get(id);
      if (!prev) map.set(id, { ...row });
      else prev.human += row.human;
    },
    rows() {
      return [...map.values()];
    },
  };
}

function isCheckPath(pathname: string): boolean {
  return CHECK_EXACT.has(pathname) || pathname.startsWith("/v1/report/");
}

function requestCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function tokenMatches(presented: string, secret: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(presented);
  const b = enc.encode(secret);
  if (a.byteLength === 0 || b.byteLength === 0 || a.byteLength !== b.byteLength) return false;
  const subtle = globalThis.crypto?.subtle as { timingSafeEqual?: (x: Uint8Array, y: Uint8Array) => boolean } | undefined;
  if (subtle && typeof subtle.timingSafeEqual === "function") return subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
