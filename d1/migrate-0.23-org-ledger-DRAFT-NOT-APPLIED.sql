-- DRAFT-NOT-APPLIED. Lead applies this file to D1 database botsrated-data.
-- Additive only: CREATE IF NOT EXISTS. No ALTER, no money columns, no balance.
-- Do not edit usage_events. receipt_sha256 is kept indefinitely.
-- locator stays NOT NULL in this draft. Nulling a locator after a raw receipt
-- is pruned needs a later migration; this slice does not prune.

CREATE TABLE IF NOT EXISTS org_receipt_refs (
  id TEXT PRIMARY KEY,              -- 'orr_' + hex
  org_id TEXT NOT NULL,             -- = sub_id (v0), same as usage_events
  agent_id TEXT, key_id TEXT,       -- from resolveOrgAuth (org key path); NULL on brs_ plan path
  source TEXT NOT NULL,             -- policy_check | desk_rollup (first slice); preflight_attributed reserved, not emitted
  host TEXT NOT NULL,
  receipt_kind TEXT NOT NULL,       -- unpaid_probe | mcp_probe
  receipt_id TEXT NOT NULL,         -- 20 hex
  locator TEXT NOT NULL,            -- allowlisted query only: host=&day=  |  mcp=&day=&s=
  receipt_sha256 TEXT,              -- full sha256(canonical JSON), so a saved copy can be matched after a raw part is pruned
  measured_at TEXT,                 -- receipt ts
  usage_event_id TEXT,              -- the ue_ row this ref was written with (NULL for desk_rollup)
  at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS orr_dedupe ON org_receipt_refs(org_id, source, receipt_id);
CREATE INDEX IF NOT EXISTS orr_org_at ON org_receipt_refs(org_id, at);
CREATE INDEX IF NOT EXISTS orr_org_host ON org_receipt_refs(org_id, host, at);
