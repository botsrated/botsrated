import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STRICT_MODE_HALT_CHIPS } from "../src/halt-policy";
import { runStrictModeHaltSample } from "../examples/strict-mode-halt";

const MESSAGE_BANNED = /\b(safe|trusted|verified|scam|risky|ranking|grades?|independent|established)\b/i;

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("strict-mode halt client sample", () => {
  it("aborts on payTo changed and probe failed, and stays off when haltOn is omitted", async () => {
    const sample = await runStrictModeHaltSample();
    expect(sample.payToChangedAbort).toEqual({ abort: true, reason: expect.stringMatching(/measured chip "payTo changed"/) });
    expect(sample.probeFailedAbort).toEqual({ abort: true, reason: expect.stringMatching(/measured chip "probe failed"/) });
    expect(sample.omittedContinues).toBeUndefined();
    expect(sample.failOpenDefault).toBe(true);
    expect(sample.failMode).toBe("open");
    expect(sample.payToVerdict).toBe("pass");
    expect(sample.probeVerdict).toBe("pass");
    expect(sample.haltChips).toEqual([...STRICT_MODE_HALT_CHIPS]);
    expect(STRICT_MODE_HALT_CHIPS).toEqual(["payTo changed", "probe failed"]);
    expect(String(sample.payToChangedAbort && "reason" in sample.payToChangedAbort ? sample.payToChangedAbort.reason : "")).not.toMatch(MESSAGE_BANNED);
    expect(String(sample.probeFailedAbort && "reason" in sample.probeFailedAbort ? sample.probeFailedAbort.reason : "")).not.toMatch(MESSAGE_BANNED);
  });

  it("keeps the docs fence identical to the runnable sample and leaves failOpen alone", () => {
    const sample = read("../examples/strict-mode-halt.ts");
    const doc = read("../../../docs/guard/examples/strict-mode-halt.md");
    const fence = doc.match(/```ts\n([\s\S]*?)\n```/);
    expect(fence?.[1] + "\n").toBe(sample);
    expect(sample).toContain('import { guardAttach, strictModeHalt } from "@botsrated/x402-preflight/guard-attach"');
    expect(sample).toContain("haltOn: strictModeHalt()");
    expect(sample).toContain('fail_mode: "open"');
    expect(sample).not.toMatch(/failOpen\s*:/);
    expect(sample).not.toMatch(/fail_mode:\s*"closed"/);
    expect(sample).toContain("Absolute No-Grade");
    expect(sample).toContain("this record and the measured chips only");
    expect(sample).toContain("payTo changed");
    expect(sample).toContain("probe failed");
    expect(sample).toContain("Omit haltOn");
    expect(doc).toContain("Absolute No-Grade");
    expect(doc).toContain("this record and the measured chips only");
    expect(doc).toContain("Omit `haltOn` and chip halt stays off");
    expect(doc).not.toMatch(/failOpen\s*:/);
    expect(doc).not.toMatch(/fail_mode:\s*`closed`|fail_mode:\s*"closed"/);

    const haltPolicy = read("../../../docs/guard/halt-policy.md");
    expect(haltPolicy).toContain("examples/strict-mode-halt.md");
    expect(haltPolicy).toContain("integrations/x402-client/examples/strict-mode-halt.ts");
    const readme = read("../README.md");
    expect(readme).toContain("examples/strict-mode-halt.ts");
    expect(readme).toContain("docs/guard/examples/strict-mode-halt.md");

    const guard = read("../src/payment-guard.ts");
    expect(guard).toContain("const failOpen = opts.failOpen !== false");
  });
});
