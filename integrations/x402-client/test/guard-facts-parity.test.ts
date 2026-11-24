// Python and TypeScript must read the same facts and reach the same reasons for the same preflight body.
// The cases live in integrations/fixtures/guard-facts-parity.json and are also run by
// integrations/python-core/tests/test_guard_facts_parity.py.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateFacts, guardFactsFrom, policies } from "../src/payment-guard";

const DOC = JSON.parse(readFileSync(new URL("../../fixtures/guard-facts-parity.json", import.meta.url), "utf8"));

describe("guard facts parity with Python", () => {
  it.each(DOC.cases)("$name", (row: (typeof DOC.cases)[number]) => {
    const facts = guardFactsFrom(row.body, DOC.host);
    expect([...facts.knownPayTos].sort()).toEqual(row.known_pay_tos);
    expect(facts.listingPayTo ?? null).toEqual(row.listing_pay_to);
    expect(facts.quotesByNetwork ?? null).toEqual(row.quotes_by_network);
    for (const name of ["warn", "strict"] as const) {
      const reasons = evaluateFacts(facts, row.request, DOC.paid_url, policies[name]);
      expect(reasons.map((r) => [r.code, r.effect])).toEqual(row[name]);
    }
  });
});
