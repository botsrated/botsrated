/**
 * Customer halt on measured chips.
 *
 * The customer lists chips. When one of those chips is on the measurement,
 * the payment hook aborts. Omit the list and this halt stays off.
 *
 * Chips stay the fixed measurement set. This module does not score, probe,
 * sign a payment, or hold funds. It does not change the payment-guard default.
 */
import { GUARD_CHIPS, type GuardChip } from "./guard-policy.js";

/** Sample list for `strict_mode`. Applied only when the customer opts in. */
export const STRICT_MODE_HALT_CHIPS = ["payTo changed", "probe failed"] as const satisfies readonly GuardChip[];

const CHIP_SET = new Set<string>(GUARD_CHIPS);

export interface HaltDecision {
  /** True when the customer passed a halt list or `strict_mode`. */
  enabled: boolean;
  /** True only when the payment hook should abort. */
  abort: boolean;
  /** First listed chip that was present, or null. */
  matched: GuardChip | null;
  /** The list that was applied. Empty when halt is off or the list could not be read. */
  chips: GuardChip[];
  message: string;
}

export type HaltOn =
  | string
  | readonly string[]
  | {
      chips?: readonly string[] | null;
      strict_mode?: boolean;
    };

const OFF: HaltDecision = { enabled: false, abort: false, matched: null, chips: [], message: "" };
const UNREADABLE = "Your halt list could not be read. The payment stops.";

function isChip(value: unknown): value is GuardChip {
  return typeof value === "string" && CHIP_SET.has(value);
}

function unreadable(): HaltDecision {
  return { enabled: true, abort: true, matched: null, chips: [], message: UNREADABLE };
}

function fromChips(chips: readonly GuardChip[]): { enabled: true; chips: GuardChip[] } {
  return { enabled: true, chips: [...chips] };
}

type Resolved = { enabled: false } | { enabled: true; unreadable: true } | { enabled: true; chips: GuardChip[] };

function resolve(haltOn: unknown): Resolved {
  if (haltOn == null) return { enabled: false };
  if (typeof haltOn === "string") return isChip(haltOn) ? fromChips([haltOn]) : { enabled: true, unreadable: true };
  if (Array.isArray(haltOn)) {
    if (!haltOn.every(isChip)) return { enabled: true, unreadable: true };
    return fromChips(haltOn);
  }
  if (typeof haltOn !== "object") return { enabled: true, unreadable: true };
  const record = haltOn as { chips?: unknown; strict_mode?: unknown };
  const hasChips = Object.prototype.hasOwnProperty.call(record, "chips") && record.chips != null;
  const hasStrict = Object.prototype.hasOwnProperty.call(record, "strict_mode") && record.strict_mode != null;
  if (!hasChips && !hasStrict) return { enabled: false };
  if (hasStrict && typeof record.strict_mode !== "boolean") return { enabled: true, unreadable: true };
  if (hasChips) {
    if (!Array.isArray(record.chips) || !record.chips.every(isChip)) return { enabled: true, unreadable: true };
    return fromChips(record.chips);
  }
  if (record.strict_mode === true) return fromChips(STRICT_MODE_HALT_CHIPS);
  return { enabled: false };
}

/**
 * Read the customer's halt list against chips already measured.
 * `measuredChips` comes from the fixed set. This function does not invent chips.
 */
export function evaluateHalt(measuredChips: readonly string[], haltOn: unknown): HaltDecision {
  const resolved = resolve(haltOn);
  if (!resolved.enabled) return { ...OFF };
  if ("unreadable" in resolved) return unreadable();
  const matched = resolved.chips.find((chip) => measuredChips.includes(chip)) ?? null;
  if (!matched) return { enabled: true, abort: false, matched: null, chips: resolved.chips, message: "" };
  return {
    enabled: true,
    abort: true,
    matched,
    chips: resolved.chips,
    message: `Your halt rule matched measured chip "${matched}". The payment stops. This measurement is this record only. It is not a rating.`,
  };
}

/** Opt-in sample. Halt when the measurement shows `payTo changed` or `probe failed`. */
export function strictModeHalt(): { strict_mode: true } {
  return { strict_mode: true };
}
