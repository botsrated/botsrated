# Attach retention (internal)

| | |
|---|---|
| Status | Internal. Not a public page, badge, or API. |
| Spec string | `botsrated-guard-attach-retention-internal/1` |
| Schema | [`attach-retention-internal.schema.json`](attach-retention-internal.schema.json) |
| Example | [`examples/attach-retention-internal.example.json`](examples/attach-retention-internal.example.json) |
| Count definition | [`llms-install.md` → How we count outside attaches](../../llms-install.md#how-we-count-outside-attaches) |

Week-over-week retained outside Guard attaches. Guard packs this shape only. This file does not contain a measured count, and it does not publish one.

## What can be counted later

The count uses the definition already written in that section:

| Piece | Rule |
|---|---|
| Key | Distinct `callers_week` keys (week plus HMAC key) |
| Channel | `guard` |
| Excluded | Rows tagged `internal` (our own probes, tests, and self-calls) |
| Retained | The key shows up again the next week |
| Not the measure | npm or PyPI download counts |
| Not computed | A conversion rate, or any join of these counts into one rate |

`window` is `wow` (week over week). `metric` is `callers_week_retained`. npm or PyPI download counts are not the measure. Counts are not joined into a conversion rate.

`qa_clean` is true only after the Data Checker confirms the row set matches that definition. A false filter must not be published. Guard does not run the filter and does not fill `count` in this change. The example leaves `count` null.

## Publish gate

`publish` may be true only when `count` is an integer greater than 0 and `qa_clean` is true.

The site, the public API, and any badge must not expose this scoreboard when `count` is null, missing, or less than or equal to 0, or when `qa_clean` is false. In those cases `publish` is false.

`public_badge` is false on this shape. This change adds no page, no route, and no badge, and it does not invent a count. There is no public retained-attach figure in this change.

## Owners

| Role | Job |
|---|---|
| Revenue | Primary publish owner |
| Caller Convert | Primary publish owner. The counting section also lands the figure with Caller Convert. |
| Data Checker | Primary publish owner, including the QA-clean filter |
| Live Ops | Digests, as named in the counting section. Not a second public number. |
| Guard | Packs this internal shape and these docs only |

A later public number is those publish owners' number, and only once it is real. Guard does not publish it from this change.

No custody and no balances.
