---
title: Selection
description: The select() API: requirements, exclusions and ordered preferences for deterministic routing.
doc_status: active
updated: 2026-11-08
type: API
kind: Reference
tags: [selection, routing]
authors:
  - human:stijn
  - agent/claude-code
---

# Selection

```ts
const ranked = atlas.select({
  requires: { tools: true, structuredOutput: true },
  providers: ['tokenfactory', 'openrouter'],
  exclude: ['some-model', { provider: 'openrouter', id: 'vendor/model' }],
  minContextTokens: 128_000,
  prefer: [{ provider: 'tokenfactory', id: 'kimi-k3' }, 'cheapest', 'largestContext', 'newest'],
  allowUnknown: false,
});
// Array<{ model, score, reasons: string[], unknown: Capability[] }>
```

False required capabilities always exclude a model. Unknown required capabilities exclude it unless `allowUnknown`; then they appear in `unknown`. Minimum context always requires a known sufficient context limit. Retired models and models past `retiresAt` are excluded; deprecated models rank last regardless of preference. Preferences are compared in order, with provider/ID lexical order as the stable final tie-break. Unknown price/context/date sorts after known values for the relevant preference. `score` is the candidate count minus its zero-based rank, meaningful only within that selection result.
