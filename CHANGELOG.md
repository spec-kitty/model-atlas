# Changelog

## Unreleased

- Add `listingParams` for listing-only query parameters (e.g. Nebius `verbose=true`).
- Read combined `architecture.modality` strings when modality arrays are absent; map `embedding`/`embeddings` output modalities and models.dev `type: "embedding"` to embeddings support.
- Report optional enrichment failures as sanitized refresh warnings; keep PDF support unknown without explicit evidence.
- Treat future source timestamps as stale and warn on snapshot restore; identify probe cache failures with `capability: 'cache'`.
- Cancel body readers and late responses from injected fetch implementations after timeout; redact common URL/form and base64 secret encodings.
- Resolve the DeepSeek review with per-finding dispositions and additional boundary, persistence, catalog and transport tests.
- Require parameter-specific evidence for reasoning and structured-output rejections; accepted invalid JSON stays inconclusive, and echoed request fields no longer identify rejected parameters.
- Validate reasoning effort arrays, probe default levels for empty published lists, and preserve unknown effort lists after isolated rejections.
- Attempt forced tool choice when support is unknown, with one retry without it on a choice-specific rejection; route explicit default Fireworks bases to inference.
- Preserve full endpoint paths in provenance and exclude catalog edit dates from release-date ranking.
- Add regression coverage for probe errors, normalization, source concurrency, selection, and catalog secret sanitization.

## 0.1.0

- Initial TypeScript ESM release, Node 22+, with no runtime dependencies.
- Anthropic, OpenAI, OpenAI-compatible/LiteLLM, OpenRouter and Fireworks listing support with defensive per-entry normalization and pagination.
- models.dev and OpenRouter catalogs with conservative canonical matching and ambiguity reporting.
- Auditable claim precedence, caller overrides, opt-in capability/effort probes, and deterministic model selection.
- Versioned offline snapshots, source freshness, optional persistence sink, and bounded requests with sanitized errors.
- Fixture-only tests, MIT licensing policy gate, Node 22/24 CI, and a separate live gateway smoke script.
