import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVE_HERO_CTA_HTML, homeHeroCtaHtml, mountHomePrimaryCta } from "../src/home_primary_cta.ts";

const PAGE = `<!doctype html><style>.btn{border:1px solid #fff}</style><body>${LIVE_HERO_CTA_HTML}</body>`;

test("the live hero has two equal buttons", () => {
  assert.equal(LIVE_HERO_CTA_HTML.includes('class="btn" href="/tools/payment-guard"'), true);
  assert.equal(LIVE_HERO_CTA_HTML.includes('class="btn" href="/desk"'), true);
  assert.equal(LIVE_HERO_CTA_HTML.includes("btn-primary"), false);
});

test("Open Desk is the one primary and Guard stays a button", () => {
  const html = homeHeroCtaHtml();
  assert.match(html, /<a class="btn btn-primary" href="\/desk">Open Desk<\/a>/);
  assert.match(html, /<a class="btn btn-secondary" href="\/tools\/payment-guard">Attach Guard free<\/a>/);
  assert.match(html, /<a class="btn quiet" href="\/desk\/alerts">Get change alerts<\/a>/);
  assert.equal(html.includes("DeskGuard"), false);
  assert.equal(html.toLowerCase().includes("rogue"), false);
  assert.equal(html.toLowerCase().includes("bot vs human"), false);
  assert.equal((html.match(/btn-primary/g) ?? []).length, 1);
});

test("mount replaces the live hero once and can say when it did not", () => {
  const first = mountHomePrimaryCta(PAGE);
  assert.equal(first.replaced, true);
  assert.equal(first.already, false);
  assert.equal(first.html.includes(LIVE_HERO_CTA_HTML), false);
  assert.equal(first.html.includes('data-primary="desk"'), true);
  assert.equal(first.html.includes("home-primary-next-action"), true);
  assert.match(first.html, /@media \(max-width:720px\)/);
  const second = mountHomePrimaryCta(first.html);
  assert.equal(second.already, true);
  assert.equal(second.html, first.html);
  const missed = mountHomePrimaryCta("<html><body>no hero</body></html>");
  assert.equal(missed.replaced, false);
  assert.equal(missed.html.includes("btn-primary"), false);
});
