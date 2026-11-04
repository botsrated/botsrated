import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const BANNED = /\b(safe|trusted|verified|scam|risky|ranking|grades?|independent|established)\b/i;

function load(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/** Mirrors the schema publish gate. A count at or below 0, or a filter that is not QA-clean, must not publish. */
function mayPublish(doc: { count: number | null; qa_clean: boolean }): boolean {
  return typeof doc.count === "number" && doc.count > 0 && doc.qa_clean === true;
}

describe("attach retention internal shape", () => {
  it("packs an unpublished example and names the publish owners", () => {
    const example = JSON.parse(load("../../../docs/guard/examples/attach-retention-internal.example.json"));
    const schema = JSON.parse(load("../../../docs/guard/attach-retention-internal.schema.json"));
    const doc = load("../../../docs/guard/attach-retention-internal.md");

    expect(example.visibility).toBe("internal");
    expect(example.window).toBe("wow");
    expect(example.metric).toBe("callers_week_retained");
    expect(example.key).toBe("callers_week");
    expect(example.channel).toBe("guard");
    expect(example.excludes_internal).toBe(true);
    expect(example.downloads_are_not_the_measure).toBe(true);
    expect(example.count).toBeNull();
    expect(example.qa_clean).toBe(false);
    expect(example.publish).toBe(false);
    expect(example.public_badge).toBe(false);
    expect(example.packed_by).toBe("guard");
    expect(example.owners).toEqual(["revenue", "caller_convert", "data_checker"]);
    expect(example.note).toMatch(/No measured count/);
    expect(mayPublish(example)).toBe(false);

    expect(schema.properties.visibility.const).toBe("internal");
    expect(schema.properties.metric.const).toBe("callers_week_retained");
    expect(schema.properties.key.const).toBe("callers_week");
    expect(schema.properties.channel.const).toBe("guard");
    expect(schema.properties.excludes_internal.const).toBe(true);
    expect(schema.properties.downloads_are_not_the_measure.const).toBe(true);
    expect(schema.properties.public_badge.const).toBe(false);
    expect(schema.properties.publish_gate.const).toBe("count_gt_0_and_qa_clean");
    expect(schema.properties.owners.const).toEqual(["revenue", "caller_convert", "data_checker"]);
    expect(schema.properties.packed_by.const).toBe("guard");
    expect(schema.allOf[0].then.properties.publish.const).toBe(false);
    expect(schema.description).toMatch(/count <= 0/);

    expect(doc).toMatch(/must not expose this scoreboard/);
    expect(doc).toMatch(/less than or equal to 0/);
    expect(doc).toMatch(/QA-clean/);
    expect(doc).toMatch(/Revenue/);
    expect(doc).toMatch(/Caller Convert/);
    expect(doc).toMatch(/Data Checker/);
    expect(doc).toMatch(/week over week/i);
    expect(doc).toMatch(/callers_week/);
    expect(doc).toMatch(/conversion rate/);
    expect(doc).toMatch(/download counts are not the measure/i);
    expect(doc).not.toMatch(BANNED);
    expect(JSON.stringify(example)).not.toMatch(BANNED);
    expect(JSON.stringify(schema)).not.toMatch(BANNED);
  });

  it("refuses publish at a zero count and allows the gate only above zero when the filter is on", () => {
    expect(mayPublish({ count: null, qa_clean: true })).toBe(false);
    expect(mayPublish({ count: 0, qa_clean: true })).toBe(false);
    expect(mayPublish({ count: 1, qa_clean: false })).toBe(false);
    expect(mayPublish({ count: 1, qa_clean: true })).toBe(true);
    const doc = load("../../../docs/guard/attach-retention-internal.md");
    expect(doc).toMatch(/does not invent a count/);
    expect(doc).toMatch(/no badge/i);
  });
});
