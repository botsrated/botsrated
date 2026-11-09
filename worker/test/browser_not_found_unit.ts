import assert from "node:assert/strict";
import { test } from "node:test";
import { browserNotFoundResponse, notFoundFor, wantsBrowserNotFound } from "../src/browser_not_found.ts";

const LIVE_JSON = {
  beta: true,
  service: "BotsRated",
  error: {
    code: "not_found",
    message: "No route GET /this-page-does-not-exist-audit.",
    hint: "See /openapi.json or /llms.txt for the list of routes.",
    charged: false,
    charged_note: "x402 settles only on a 2xx answer, so this response was not charged.",
  },
};

function req(path: string, headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(`https://botsrated.com${path}`, { method, headers });
}

function jsonNotFound(): Response {
  return new Response(JSON.stringify(LIVE_JSON), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
}

test("a browser document navigation gets HTML and status 404", async () => {
  const request = req("/this-page-does-not-exist-audit", {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "sec-fetch-dest": "document",
  });
  assert.equal(wantsBrowserNotFound(request), true);
  const res = notFoundFor(request, jsonNotFound);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("x-robots-tag"), "noindex");
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /script-src/);
  const html = await res.text();
  assert.equal(html.includes("<h1>Page not found</h1>"), true);
  assert.equal(html.includes('href="/"'), true);
  assert.equal(html.includes('href="/tools/payment-guard"'), true);
  assert.equal(html.includes(">Guard</a>"), true);
  assert.equal(html.includes('href="/desk"'), true);
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("onclick"), false);
  assert.equal(html.startsWith("{"), false);
});

test("HEAD stays 404 with an empty HTML response", async () => {
  const res = browserNotFoundResponse(req("/missing", { accept: "text/html" }, "HEAD"));
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "");
});

test("programmatic clients keep the JSON body", async () => {
  const cases = [
    req("/this-page-does-not-exist-audit", { accept: "application/json" }),
    req("/this-page-does-not-exist-audit", { accept: "*/*" }),
    req("/this-page-does-not-exist-audit"),
    req("/this-page-does-not-exist-audit", { accept: "application/json, text/html" }),
    req("/v1/no-such-route", { accept: "text/html,application/xhtml+xml" }),
    req("/mcp", { accept: "text/html" }),
    req("/.well-known/nope", { accept: "text/html" }),
    req("/missing.json", { accept: "text/html" }),
    req("/missing?format=json", { accept: "text/html" }),
    req("/missing", { accept: "text/html" }, "POST"),
  ];
  for (const request of cases) {
    assert.equal(wantsBrowserNotFound(request), false, request.url);
    const res = notFoundFor(request, jsonNotFound);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), LIVE_JSON);
  }
});

test("the HTML page escapes the path and drops the query", async () => {
  const res = browserNotFoundResponse(req("/<script>alert(1)</script>?token=secret", { accept: "text/html" }));
  const html = await res.text();
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("&lt;script&gt;"), true);
  assert.equal(html.includes("token=secret"), false);
  assert.equal(html.includes("secret"), false);
});
