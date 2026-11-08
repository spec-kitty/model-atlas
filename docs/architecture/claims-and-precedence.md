---
title: Claims and precedence
description: How capability evidence is recorded as claims and how competing claims are resolved.
doc_status: active
updated: 2026-11-08
type: Architecture
kind: Explanation
tags: [claims, provenance]
authors:
  - human:stijn
  - agent/claude-code
---

# Claims and precedence

```ts
type SourceKind = 'override' | 'probe' | 'endpoint' | 'catalog' | 'default';
interface Claim<T> {
  value: T;
  source: SourceKind;
  via: string; // e.g. 'tokenfactory:/v1/models', 'models.dev', 'probe:imageInput'
  at: string;  // ISO observation timestamp
}
```

Per field: **override > probe > endpoint > catalog > default**. `null` and missing values mean unknown, never false. Equal-precedence claims use the newest observation timestamp, then later insertion. Refresh jobs commit in configured order; within a listing, later entries/fields win ties. LiteLLM enrichment follows the primary listing. Pricing and lifecycle are atomic claim values; limits, capabilities and reasoning arrays are separate fields.

`ModelRecord` contains `provider`, `id`, optional `displayName`, `capabilities`, `reasoning.efforts` / `thinkingModes`, `limits.contextTokens` / `maxInputTokens` / `maxOutputTokens`, optional `pricing`, `lifecycle`, and `catalogMatch`. It also exposes `releasedAt`, a claim derived from the upstream creation/release date, used by the `newest` preference. Catalog edit dates (`last_updated`) and refresh timestamps are never used to infer model age. Endpoint `via` values include the request pathname, including any base path, without query parameters.

Capabilities:

```text
textInput imageInput pdfInput audioInput videoInput
textOutput imageOutput embeddings
tools toolChoice parallelToolCalls structuredOutput reasoning streaming
temperature topP topK seed
```

Prices use USD per million tokens: `inputPerMTok`, `outputPerMTok`, `cacheReadPerMTok`, `cacheWritePerMTok`. OpenRouter and LiteLLM per-token prices are converted; models.dev prices already use these units. Zero is a valid price. Tiered prices and separate one-hour cache-write prices are not represented; the base published tier is used. `cheapest` requires both input and output prices and compares their sum, assuming equal input/output volume. This is a ranking heuristic, not a billing estimate.

```ts
atlas.setOverride('tokenfactory', 'kimi-k3', 'capabilities.tools', true);
atlas.setOverride('tokenfactory', 'kimi-k3', 'limits.contextTokens', 262_144);
const explanation = atlas.explain('tokenfactory', 'kimi-k3');
// { model, claims: { 'capabilities.tools': [allClaims, ...], ... }, catalogMatches }
```

Overrides are validated, can introduce a model, and survive refresh/snapshot restoration. A null override is a no-op. `explain()` retains every competing claim from the current successful source listings, plus the full override/probe history. Successful refresh replaces that source's previous listing, so this is not an archival history of every refresh. Returned read objects are detached copies.
