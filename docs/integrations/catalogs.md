---
title: Catalog matching
description: How public catalogs (models.dev, OpenRouter) enrich listed models without guessing.
doc_status: active
updated: 2026-11-08
type: Integration
kind: Reference
tags: [catalogs, matching]
authors:
  - human:stijn
  - agent/claude-code
---

# Catalog matching

- `modelsDev({ providerMap? })` reads [models.dev/api.json](https://models.dev/api.json).
- `openRouterCatalog({ providerMap? })` reads [OpenRouter's public listing](https://openrouter.ai/api/v1/models) through the same normalizer as endpoint entries.

Catalogs enrich **listed or explicitly overridden/probed models**; they do not invent models available on your endpoint. Configure OpenRouter as a provider if you also want its models as routing candidates.

A non-null provider mapping restricts lookup to that catalog provider and exact model ID; a miss stays a miss. A null/absent mapping enables global exact-ID or explicit `canonical_model_id` matching. Global matching succeeds only when all matches identify **one distinct canonical model**. Without an explicit canonical ID, provider-qualified catalog keys identify distinct models. No fuzzy matching, vendor-prefix stripping, punctuation rewriting, or similarity guesses.

Same-canonical aliases prefer an exact ID, then lexical catalog key. `catalogMatch` records the last successful catalog match and method (`exact`, `provider-mapped`, `canonical`); `explain().catalogMatches` lists every catalog's match, miss or ambiguity with candidate keys. Losing catalog claims remain auditable. Provider mappings survive offline snapshots.
