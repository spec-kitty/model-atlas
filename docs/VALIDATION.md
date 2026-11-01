# Validation — 1 November 2026

## Local checks

- `npm ci`: passed, including the `prepare` build.

- Node 22.23.4: `npm run build`, `npm run typecheck`, `npm test` — passed, 36 tests.
- Node 24.22.2: `npm run build`, `npm run typecheck`, `npm test` — passed, 36 tests.
- Node 22/24 binaries obtained through isolated `npm exec --package=node@<major>` environments. System Node is 25.2.1.
- `npm pack --dry-run`: passed; package contains JavaScript/declarations under `dist`, README, canonical LICENSE, and package metadata, with no fixtures, credentials or development files.
- `pnpm add git+file:///Users/robert/model-atlas#<commit>` in a temporary consumer: passed; Git dependency preparation ran the build, and importing the public ESM package worked.
- External TypeScript ESM consumer compiled against emitted declarations with strict checking and no `skipLibCheck`.
- `git diff --check`: passed.
- LICENSE and all original fixtures remain unchanged.

Unit tests use fixture JSON and injected fetch only. No test contacts a live endpoint. CI has the same build/typecheck/test checks on Node 22 and 24, with the requested action SHAs.

## Independent review follow-up

- Node 25.2.1: `npm run build`, `npm run typecheck`, `npm test` — passed, 48 tests.
- Accepted Kimi findings 1–6 and 8; accepted GLM findings 1–6 for the reasoning/structured-output, tool-choice, routing, input-validation, and coverage issues described in the changelog.
- Rejected Kimi finding 7: pagination faults invalidate listing completeness. Committing partial pages would replace the previous listing and remove models on unfetched pages; the existing atomic failure behavior preserves prior data and its timestamp.
- Rejected the image-probe portion of GLM finding 1: the task explicitly specifies HTTP 400/422 as a negative image result. That behavior remains unchanged.
- Added assertions for all listed coverage gaps, including future retirement dates, OpenRouter output limits, default effort probes, catalog secret echoes, source concurrency, explicit model preferences, and Fireworks inference paths.
- Live smoke output below is from initial implementation; this follow-up used mocked transports only.

## Live smoke

Ran **once**, with `--probe`, using the existing `COMPATIBLE_API_KEY` from the authorized local environment file. The credential was passed to the child process environment; it was never printed or written. Exit code: **0**.

```text
provider:tokenfactory: OK, models=12, skipped=0
provider:openrouter: OK, models=452, skipped=0
catalog:models.dev: OK, models=8940, skipped=0
┌─────────┬───────────────────────────────────────────┬────────┬───────┬───────────┬─────────┬──────────────┐
│ (index) │ model                                     │ vision │ tools │ reasoning │ context │ visionSource │
├─────────┼───────────────────────────────────────────┼────────┼───────┼───────────┼─────────┼──────────────┤
│ 0       │ 'deepseek-v4.1-flash-1017'                │ false  │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 1       │ 'deepseek-v4.1-flash-1017-uncensored-fp8' │ true   │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 2       │ 'glm-5.3'                                 │ false  │ true  │ true      │ 262144  │ 'endpoint'   │
│ 3       │ 'glm-5.3-flash'                           │ true   │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 4       │ 'glm-5.3-flash-uncensored-fp8'            │ true   │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 5       │ 'glm-5.3-uncensored-fp8'                  │ false  │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 6       │ 'kimi-k3'                                 │ true   │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 7       │ 'kimi-k3-abliterated'                     │ true   │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 8       │ 'minimax-m3.1-flash'                      │ true   │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 9       │ 'nemotron-3-super'                        │ false  │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 10      │ 'nemotron-3-ultra'                        │ false  │ true  │ true      │ 1048576 │ 'endpoint'   │
│ 11      │ 'nemotron-3.5-lightning'                  │ false  │ true  │ true      │ 1048576 │ 'endpoint'   │
└─────────┴───────────────────────────────────────────┴────────┴───────┴───────────┴─────────┴──────────────┘
Vision ground truth: 12/12 passed
Probe glm-5.3: imageInput=false; expected=false
Probe kimi-k3: imageInput=true; expected=true
Smoke: PASS
```

## Implementation choices and known limits

- Anthropic probes use native `output_config.format` / `output_config.effort` instead of OpenAI-only `response_format` / `reasoning_effort`, to support the required native messages protocol.
- Added a `releasedAt` claim to support the `newest` ranking preference without treating refresh time as model age.
- Optional `cache.save` is a persistence sink; load through `snapshot`. Synchronous overrides are persisted explicitly or on the next refresh/probe.
- Pricing/lifecycle are atomic claims; tiered prices and alternative cache durations are outside the specified data model. Cheapest ranking uses equal input/output token volume.
- Structured probes check parseable JSON, not arbitrary JSON-schema conformance. Tool probes without a returned tool call remain inconclusive. Rejection of one reasoning effort does not mark all reasoning unsupported.
- All provider kinds and catalogs have mocked fixture coverage. Live verification covered TokenFactory, public OpenRouter, models.dev, and the two requested TokenFactory vision probes; no live Anthropic/OpenAI/Fireworks calls were made.
- Snapshots retain current successful listing evidence plus override/probe history, not every historical listing. Explicit override/probe records can retain a model after it disappears from a listing.

## Added file manifest

```text
.github/workflows/ci.yml
.gitignore
package.json
package-lock.json
tsconfig.json
tsconfig.test.json
src/index.ts
src/types.ts
src/atlas.ts
src/catalogs.ts
src/normalize.ts
src/sources.ts
src/transport.ts
src/probes.ts
src/probe-image.ts
src/selection.ts
src/snapshot.ts
test/helpers.ts
test/license.test.ts
test/normalizers.test.ts
test/atlas.test.ts
test/probes.test.ts
test/transport.test.ts
scripts/smoke.mjs
README.md
CHANGELOG.md
docs/VALIDATION.md
```
