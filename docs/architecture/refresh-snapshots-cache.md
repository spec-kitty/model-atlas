---
title: Refresh, snapshots and cache
description: Source refresh semantics, staleness, offline snapshots and the persistence sink.
doc_status: active
updated: 2026-11-08
type: Architecture
kind: Reference
tags: [refresh, snapshot, cache]
authors:
  - human:stijn
  - agent/claude-code
---

# Refresh, snapshots and cache

```ts
await atlas.refresh({ providers: ['tokenfactory'], catalogs: [] });
const allModels = atlas.models();
const providerModels = atlas.models('tokenfactory');
const stale = atlas.isStale('provider:tokenfactory');
const snapshot = atlas.toSnapshot();
// Persist JSON.stringify(snapshot) using your application's storage.
const offline = createAtlas({ snapshot: JSON.parse(JSON.stringify(snapshot)) });
```

Read methods are synchronous. Sources refresh independently; each report is `{ source, ok, models, skipped, error?, warnings? }`. Optional `/model/info` enrichment failures produce sanitized `warnings` while the primary listing still succeeds; `skipped` counts malformed entries. Source names are `provider:<id>` and `catalog:<id>`. Omitting a refresh filter refreshes all configured sources of that type; `[]` refreshes none. A failed source preserves its previous successful data and timestamp. A successful source replaces its listing, removing delisted models unless explicit overrides/probe history retain them. Concurrent `refresh()` and `probe()` operations on one atlas serialize; independent sources within a refresh run concurrently. Failures do not abort other sources.

`isStale(source)` accepts a qualified name or unambiguous bare ID; missing sources and sources dated in the future are stale. Future snapshot timestamps also produce a `snapshotWarnings` entry, retaining their evidence for offline reads. A bare ID that names both a provider and a catalog resolves to the provider. Default `maxAgeMs` is one day. Staleness does not automatically refresh or exclude models.

Snapshots have `version: 1`, `createdAt`, normalized `sources` with last-successful timestamps and endpoint **hostnames**, and `additions` containing overrides/probes. No provider config or credentials are serialized. Restoring a snapshot validates and reconstructs known fields; malformed source/model records are skipped with `snapshotWarnings`. Unknown versions produce an empty atlas and a warning. To refresh/probe after offline restore, supply provider configs again.

`cache: { save(snapshot) }` optionally persists after refresh/probe; it may return a promise. A save failure is reported without discarding in-memory changes. Probe batches append `{ capability: 'cache', ok: false, error: 'Cache save failed' }` on persistence failure, including empty batches; capability consumers must handle this additional report kind. Load through the `snapshot` option. Synchronous `setOverride()` does not invoke asynchronous storage; persist `toSnapshot()` afterward, or at the next refresh/probe. `now: () => Date` and `fetch` are injectable.
