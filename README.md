# model-atlas

An open-source model capability catalog and router for Node.js and Electron's headless core. Published as `@spec-kitty/model-atlas` under MIT, © 2026 Spec Kitty, Inc.

Model names do not reliably describe gateway capabilities. A gateway can serve a vision-enabled variant of a text model, reject sampling parameters supported elsewhere, or expose different limits. Hardcoded model tables drift. Model Atlas reads each endpoint's listing, fills gaps from public catalogs, optionally tests capabilities with small real requests, and preserves the evidence behind every decision.

TypeScript, strict mode, ESM only, Node **22+**, zero runtime dependencies. Uses global `fetch`, with injection for tests and custom transports. No browser UI or Electron dependency.

```sh
npm install @spec-kitty/model-atlas
# Before an npm release, install a Git ref; prepare builds declarations and JavaScript:
pnpm add github:spec-kitty/model-atlas#<ref>
```

## Quickstart

```ts
import { createAtlas, modelsDev, openRouterCatalog } from '@spec-kitty/model-atlas';

const atlas = createAtlas({
  providers: [
    {
      id: 'tokenfactory',
      kind: 'openai-compatible',
      baseUrl: 'https://gateway.trytokenfactory.dev/v1',
      ...(process.env.COMPATIBLE_API_KEY ? { apiKey: process.env.COMPATIBLE_API_KEY } : {}),
    },
    { id: 'openrouter', kind: 'openrouter' }, // Public listing; key optional.
  ],
  catalogs: [
    modelsDev({ providerMap: {
      tokenfactory: null,
      anthropic: 'anthropic',
      openai: 'openai',
      fireworks: 'fireworks-ai',
    } }),
    openRouterCatalog(),
  ],
  timeoutMs: 20_000,
  maxResponseBytes: 20 * 1024 * 1024,
  maxAgeMs: 86_400_000,
});

const reports = await atlas.refresh();
const model = atlas.model('tokenfactory', 'kimi-k3');
const vision = atlas.supports('tokenfactory', 'kimi-k3', 'imageInput'); // boolean | undefined
const candidates = atlas.select({
  requires: { imageInput: true, tools: true },
  minContextTokens: 128_000,
  prefer: ['cheapest', 'largestContext'],
});
const evidence = atlas.explain('tokenfactory', 'kimi-k3');
```

## Providers and published data

Each config has `{ id, kind, baseUrl?, apiKey?, headers?, account? }`. `id` is your stable provider identifier, independent of upstream vendor names. IDs must be unique safe identifiers (letters, digits, `.`, `_`, `-`). Provider IDs and catalog IDs have separate namespaces. Headers are request-only; an explicit `apiKey` sets the protocol's auth header. Anthropic's API version is `2023-06-01`.

| Kind | Default listing / base convention | Auth and pagination |
| --- | --- | --- |
| `anthropic` | `https://api.anthropic.com/v1/models?limit=1000`; custom base is the API root | `x-api-key`; follows `has_more` / `last_id` using `after_id` |
| `openai` | `https://api.openai.com/v1/models`; custom base includes `/v1` | Bearer |
| `openai-compatible` | Required `baseUrl` + `/models`, e.g. `https://gateway.example/v1/models` | Bearer; also tries origin + `/model/info`; that optional call's failure is silent |
| `openrouter` | `https://openrouter.ai/api/v1/models`; custom base includes `/api/v1` | Optional Bearer; listing is public |
| `fireworks` | `https://api.fireworks.ai/v1/accounts/{account}/models?pageSize=200`; account defaults to `fireworks` | Bearer; follows `nextPageToken` using `pageToken` |

`baseUrl` can override any provider for tests or proxies. Fireworks probes use `https://api.fireworks.ai/inference/v1/chat/completions` by default; a supplied custom base is also used for probes. For separate custom Fireworks control-plane and inference origins, use a separate `openai-compatible` provider config for inference.

Gateway survey, **verified 1 November 2026** (a dated survey, not a promised current model count):

| Provider | Listing | What it publishes |
| --- | --- | --- |
| [Anthropic](https://platform.claude.com/docs/en/api/models/list) | `/v1/models` | Full `capabilities` tree: image/PDF input, structured output, thinking types and effort levels; limits and lifecycle; no pricing |
| [OpenRouter](https://openrouter.ai/docs/api-reference/models/get-models) | Public `/api/v1/models` — 452 models in the survey | Modalities, `supported_parameters`, limits, prices including cache tiers, expiry |
| [TokenFactory](https://gateway.trytokenfactory.dev/v1/models) / [LiteLLM](https://docs.litellm.ai/docs/proxy/model_info) | `/v1/models`, optional `/model/info` | OpenRouter fields plus flat capabilities; `/model/info` `supports_*` flags are null because they are not configured |
| [Fireworks](https://docs.fireworks.ai/api-reference/list-models) | `/v1/accounts/{account}/models` | `supportsImageInput`, `supportsTools`, `contextLength`, `defaultSamplingParams`, `deprecationDate` |
| [OpenAI](https://platform.openai.com/docs/api-reference/models/list) | `/v1/models` | `id`, `object`, `created`, `owned_by` only |

Normalization detects **each entry's shape**, regardless of configured kind, and merges all recognized fields within that entry. TokenFactory's modalities and flat flags both contribute claims. LiteLLM nulls create no claims; its generic `supported_openai_params` is not treated as model-specific evidence. Invalid entries are counted in refresh reports; invalid optional values are ignored. Unknown fields are discarded.

Two documented defaults are the only assumptions: models on an `anthropic` provider support tools (`source: 'default'`), and IDs beginning `text-embedding-` get an embeddings default. No other capability is inferred from model names. Generic `file` input and models.dev's `attachment` flag do not establish PDF support; PDF remains unknown without explicit evidence. Absent modalities in a valid explicit modality list are false (except ambiguous `file`/PDF); missing sampling parameters in an explicit `supported_parameters` list are false. Missing non-sampling parameters remain unknown.

## Claims and precedence

```ts
type SourceKind = 'override' | 'probe' | 'endpoint' | 'catalog' | 'default';
interface Claim<T> {
  value: T;
  source: SourceKind;
  via: string; // e.g. 'tokenfactory:/models', 'models.dev', 'probe:imageInput'
  at: string;  // ISO observation timestamp
}
```

Per field: **override > probe > endpoint > catalog > default**. `null` and missing values mean unknown, never false. Equal-precedence claims use the newest observation timestamp, then later insertion. Refresh jobs commit in configured order; within a listing, later entries/fields win ties. LiteLLM enrichment follows the primary listing. Pricing and lifecycle are atomic claim values; limits, capabilities and reasoning arrays are separate fields.

`ModelRecord` contains `provider`, `id`, optional `displayName`, `capabilities`, `reasoning.efforts` / `thinkingModes`, `limits.contextTokens` / `maxInputTokens` / `maxOutputTokens`, optional `pricing`, `lifecycle`, and `catalogMatch`. It also exposes `releasedAt`, a claim derived from the upstream creation/release date (models.dev `last_updated` is a fallback), used by the `newest` preference. A refresh timestamp is never used to infer model age.

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

## Catalog matching

- `modelsDev({ providerMap? })` reads [models.dev/api.json](https://models.dev/api.json).
- `openRouterCatalog({ providerMap? })` reads [OpenRouter's public listing](https://openrouter.ai/api/v1/models) through the same normalizer as endpoint entries.

Catalogs enrich **listed or explicitly overridden/probed models**; they do not invent models available on your endpoint. Configure OpenRouter as a provider if you also want its models as routing candidates.

A non-null provider mapping restricts lookup to that catalog provider and exact model ID; a miss stays a miss. A null/absent mapping enables global exact-ID or explicit `canonical_model_id` matching. Global matching succeeds only when all matches identify **one distinct canonical model**. Without an explicit canonical ID, provider-qualified catalog keys identify distinct models. No fuzzy matching, vendor-prefix stripping, punctuation rewriting, or similarity guesses.

Same-canonical aliases prefer an exact ID, then lexical catalog key. `catalogMatch` records the last successful catalog match and method (`exact`, `provider-mapped`, `canonical`); `explain().catalogMatches` lists every catalog's match, miss or ambiguity with candidate keys. Losing catalog claims remain auditable. Provider mappings survive offline snapshots.

## Opt-in probes

**Probes never run automatically.** They make real billable requests, sequentially, with `max_tokens: 64`. They test acceptance/behavior of a minimal request, not every possible combination of options.

```ts
await atlas.probe('tokenfactory', 'kimi-k3', [
  'imageInput', 'tools', 'structuredOutput', 'temperature', 'topP',
  { capability: 'reasoning', efforts: ['low', 'high', 'max'] },
]);
```

OpenAI-compatible providers use `/chat/completions`; Anthropic uses native `/v1/messages`, image source blocks, tools, `output_config.format` for JSON schema, and adaptive thinking with `output_config.effort`. String `'reasoning'` tests published effort levels, or `low`, `medium`, `high` if none are known.

| Probe | Evidence |
| --- | --- |
| `imageInput` | Embedded PNG containing blue **7381** and a red circle; asks for the number. Reply containing `7381` → true; wrong reply or HTTP 400/422 → false |
| `tools` | One `ping` tool; required choice when tool choice is known supported (or on Anthropic). Returned `ping` call → true; HTTP 400 → false; no call → inconclusive |
| `structuredOutput` | Minimal JSON schema. Accepted, parseable JSON → true; malformed JSON or HTTP 400/422 → false. This does not validate arbitrary schemas |
| `temperature`, `topP` | Sends the parameter. Accepted → true; HTTP 400 naming that parameter → false; unrelated rejection → inconclusive |
| Reasoning efforts | Tests each level. Accepted levels are added, HTTP 400/422 removes the tested level from the effort list. One rejected level does not establish that reasoning as a whole is unavailable |

HTTP 401/403/429/5xx, network failures, timeouts, invalid envelopes and oversized responses produce **no new claim**, only sanitized error reports. Earlier evidence remains. Probe reports are `{ capability, effort?, ok, value?, error? }`; `ok: true, value: false` means a conclusive negative result, not a transport failure. Reasoning claims preserve observed effort-list changes and their `probe:reasoning:<level>` provenance; untested published efforts remain in the list.

## Selection

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

## Refresh, snapshots and cache

```ts
await atlas.refresh({ providers: ['tokenfactory'], catalogs: [] });
const allModels = atlas.models();
const providerModels = atlas.models('tokenfactory');
const stale = atlas.isStale('provider:tokenfactory');
const snapshot = atlas.toSnapshot();
// Persist JSON.stringify(snapshot) using your application's storage.
const offline = createAtlas({ snapshot: JSON.parse(JSON.stringify(snapshot)) });
```

Read methods are synchronous. Sources refresh independently; each report is `{ source, ok, models, skipped, error? }`. Source names are `provider:<id>` and `catalog:<id>`. Omitting a refresh filter refreshes all configured sources of that type; `[]` refreshes none. A failed source preserves its previous successful data and timestamp. A successful source replaces its listing, removing delisted models unless explicit overrides/probe history retain them. Concurrent `refresh()` and `probe()` operations on one atlas serialize; independent sources within a refresh run concurrently. Failures do not abort other sources.

`isStale(source)` accepts a qualified name or unambiguous bare ID; missing sources are stale. A bare ID that names both a provider and a catalog resolves to the provider. Default `maxAgeMs` is one day. Staleness does not automatically refresh or exclude models.

Snapshots have `version: 1`, `createdAt`, normalized `sources` with last-successful timestamps and endpoint **hostnames**, and `additions` containing overrides/probes. No provider config or credentials are serialized. Restoring a snapshot validates and reconstructs known fields; malformed source/model records are skipped with `snapshotWarnings`. Unknown versions produce an empty atlas and a warning. To refresh/probe after offline restore, supply provider configs again.

`cache: { save(snapshot) }` optionally persists after refresh/probe; it may return a promise. A save failure is reported without discarding in-memory changes. Load through the `snapshot` option. Synchronous `setOverride()` does not invoke asynchronous storage; persist `toSnapshot()` afterward, or at the next refresh/probe. `now: () => Date` and `fetch` are injectable.

## Security and operational boundaries

- Keys/custom auth headers live only in private request configuration. The library never logs them or persists them. Reports never contain raw upstream errors; successful normalized strings are scrubbed for configured secrets and full HTTP URLs. Arbitrary response properties are never retained. Only endpoint hostnames are stored.
- Every request has a deadline (default 20 seconds, including body reads) and a streamed byte cap (default 20 MiB), independent of `Content-Length`. Redirects are rejected to prevent forwarding credentials to another origin. Pagination is capped at 100 pages and repeated cursors are rejected.
- All fetched JSON is untrusted data. Shapes, booleans, finite nonnegative limits/prices, dates and claim fields are validated. Nulls remain unknown. HTML, prompts and upstream instructions are never executed.
- Only explicitly configured base URLs are contacted, plus the two fixed public catalogs and the compatible endpoint's `/model/info`. Do not accept arbitrary untrusted endpoint configs in a server without your own outbound-network policy. Configure header credentials instead of URL userinfo, which is stripped from requests. Query parameters can be used for a gateway but are never persisted.
- Injected transports must protect credentials too. Their exception text is discarded. Snapshots represent caller-supplied evidence, not signed attestations. Model evidence can become stale or simply be wrong; opt-in probes provide additional evidence, not guarantees.

## Development and live smoke test

```sh
npm ci
npm run build
npm run typecheck
npm test
COMPATIBLE_API_KEY=... node scripts/smoke.mjs --probe
```

Tests use Node's built-in runner, `--experimental-strip-types`, fixture JSON and injected fetch only; no network. TypeScript 5.9 rewrites source `.ts` imports to `.js` in `dist` and emits type declarations. CI checks Node 22 and 24; actions are pinned to SHAs. The licensing test enforces the canonical MIT text and sole holder **Spec Kitty, Inc.**

The separate smoke script loads TokenFactory, public OpenRouter and models.dev, prints source counts and the TokenFactory capability table, asserts 12 specified vision values, and optionally probes `glm-5.3` (false) and `kimi-k3` (true). It reads only `COMPATIBLE_API_KEY` from the environment; it never prints it. Live model counts and catalog matches can change independently of this package.
