---
title: Atlas options
description: Reference for createAtlas() options and environment variables.
doc_status: active
updated: 2026-11-08
type: Configuration
kind: Reference
tags: [configuration]
authors:
  - human:stijn
  - agent/claude-code
---

# Atlas options

| Option | Default | Meaning |
|---|---|---|
| `providers` | `[]` | Provider configs `{ id, kind, baseUrl?, apiKey?, headers?, account? }` — see [providers](../integrations/providers.md) |
| `catalogs` | `[]` | `modelsDev()` / `openRouterCatalog()` — see [catalogs](../integrations/catalogs.md) |
| `timeoutMs` | `20000` | Per-request deadline, including body reads |
| `maxResponseBytes` | 20 MiB | Streamed response byte cap |
| `maxAgeMs` | `86400000` | Age after which a source is stale (no automatic refresh) |
| `snapshot` | — | Restore a previous `toSnapshot()` result |
| `cache` | — | `{ save(snapshot) }` persistence sink |
| `fetch`, `now` | globals | Injectable transport and clock |

## Environment

The library reads no environment variables itself; pass keys explicitly. The smoke script reads only `COMPATIBLE_API_KEY`.
