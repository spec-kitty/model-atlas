# DeepSeek review dispositions — 1 November 2026

Reviewed current source at `43bd34a`, including that commit's changes. IDs below follow the original bullet order within each section; severity headings identify the reviewer's grouping, not an endorsed severity assessment. Every bullet, including self-retracted observations and test gaps, has a disposition.

**Accepted** means a reproducible issue or missing useful test, addressed here. **Already fixed** means the relevant behavior was corrected by `43bd34a`. **Rejected** means the alleged defect is absent, behavior is intentional, or the stated test already exists. No implementation changes were made for rejected/already-fixed findings.

Six code findings accepted (B1/B2 partially, M2/M7/M13/M24); two already fixed; 53 rejected code observations. Test gaps: 36 accepted, two rejected. Total: 99 bullets, 42 accepted, two already fixed, 55 rejected.

## Blockers (reviewer's grouping)

| ID | Finding | Disposition | Reason / resolution |
| --- | --- | --- | --- |
| B1 | Empty/malformed listing success; silent `/model/info` errors | Accepted (partial) | Optional enrichment failures now return sanitized `RefreshReport.warnings`; valid empty listings still replace old data and malformed entries already increment `skipped` individually. |
| B2 | Timeout does not stop fetch/reader; unhandled late rejection | Accepted (partial) | Native fetch already receives an aborted signal and `Promise.race` observes late rejection; injected fetch could ignore abort, so timeout now cancels its reader and late responses. |
| B3 | Malformed effort aborts probe batch and loses persistence | Rejected | The supplied mixed batch returns both reports and persists the successful claim; efforts and stored claims are validated, and `runProbe()` catches request/config failures, so no poisoned-rebuild path is demonstrated. |

## Major (reviewer's grouping)

| ID | Finding | Disposition | Reason / resolution |
| --- | --- | --- | --- |
| M1 | Absent non-sampling `supported_parameters` become false | Rejected | `normalize()` already emits absence-based false only for temperature/topP/topK/seed; the quoted condition itself disproves the finding. |
| M2 | PDF absence becomes false despite unknown-without-evidence promise | Accepted | Removed PDF absence-based false; explicit `pdf` and explicit PDF booleans still establish support/rejection. |
| M3 | `catalogMatch.method` says exact when canonical alias wins | Rejected | `rebuild()` sorts exact-ID candidates ahead of canonical aliases, so any exact match guarantees an exact winner. |
| M4 | Largest-context and ordered preference sorting invert | Rejected | Negated context puts largest first and unknown last; ordered preferences intentionally dominate later preferences, as the reviewer concludes. |
| M5 | Minimum context zero excludes unknown context | Rejected | A minimum always requires known sufficient context, including zero; README explicitly specifies this. |
| M6 | Free or partial zero-price override rejected | Rejected | Numeric zero passes validation and a currency plus one price has two keys, so both supplied examples are valid. |
| M7 | Future snapshot source timestamp stays fresh | Accepted | Restore warns about future source timestamps and `isStale()` treats them as stale; old evidence remains readable and ordinary age limits still apply at read time. |
| M8 | Snapshot provider maps accept arbitrary providers/null | Rejected | Offline catalogs require persisted mappings; validated strings and intentional null/global-lookup semantics need no configured-catalog allowlist. |
| M9 | Tool-choice message does not trigger retry | Already fixed | `43bd34a` added parameter-specific parsing and forced-choice fallback; the quoted `tool_choice is not supported` message matches that parser. |
| M10 | Anthropic structured probes use `output_config.format` | Rejected | Native Anthropic protocol mapping is intentional and documented; sending an OpenAI-only parameter would defeat protocol support. |
| M11 | Image refusal/empty text yields false | Rejected | The specified probe contract explicitly makes a wrong textual reply false; missing/non-string replies remain inconclusive. |
| M12 | Base URL query parameters are transmitted | Rejected | Caller-configured gateway queries are intentionally transmitted and sanitized from retained data; the persistence rule does not prohibit request queries. |
| M13 | Encoded secret echoes evade redaction | Accepted | Added form encoding, lowercase percent escapes, base64 and base64url variants alongside literal/URI encoding; arbitrary obfuscation remains outside this bounded sanitizer. |
| M14 | Pagination retains page-size parameters and only tracks cursors | Rejected | `searchParams.set` replaces each cursor, page size should persist, and the 100-page cap already applies independently to each source. |
| M15 | OpenRouter ID without slash becomes empty provider | Rejected | `'gpt-4o'.split('/')[0]` is `'gpt-4o'`, not empty; vendor inference for unqualified IDs would contradict conservative matching. |
| M16 | READY plus deprecation date retains losing active claim | Rejected | Later deprecated evidence intentionally wins while `explain()` preserves both observed claims. |
| M17 | Expiration status is not recomputed between refreshes | Rejected | Claims record observation-time evidence; `select()` independently checks `retiresAt` against current time and excludes expired models. |
| M18 | Rebuild mutates source claims and duplicates catalogs | Rejected | Source rows and merged claims are already `structuredClone` copies; repeated rebuilds leave source snapshots and catalog claim counts unchanged. |
| M19 | Last matching catalog overwrites `catalogMatch` | Rejected | README explicitly defines last successful match; full match results and all competing claims remain available through `explain()`. |
| M20 | Malformed source timestamp is permanently fresh | Rejected | Snapshot restore already rejects malformed dates and refresh produces ISO timestamps; the supplied `garbage` source is discarded and therefore stale. |
| M21 | Unknown model can be probed | Rejected | Explicit probing does not require listing membership; successful probes can introduce models and HTTP 404 remains inconclusive. |
| M22 | Rejected effort creates empty effort list / denies reasoning | Already fixed | `43bd34a` preserves unknown lists and only updates known lists; rejecting an effort never emits `capabilities.reasoning: false`. |
| M23 | Intermediate and final rebuilds are redundant | Rejected | Intermediate reasoning rebuilds expose updated efforts to later requests; the final rebuild also applies other capabilities, so removing either wholesale changes batch behavior. |
| M24 | Cache failure incorrectly attributed to first capability | Accepted | Persistence failures now append a report with `capability: 'cache'`, including empty batches, without discarding in-memory results. |

## Minor (reviewer's grouping)

| ID | Finding | Disposition | Reason |
| --- | --- | --- | --- |
| N1 | String length capped at 2048 | Rejected | Intentional input bound; malformed IDs are counted as skipped and no arbitrary-length identifier contract exists. |
| N2 | String arrays capped at 256 entries | Rejected | Intentional bound on untrusted metadata; oversized optional evidence stays unknown. |
| N3 | Negative prices rejected | Rejected | Pricing intentionally uses finite nonnegative USD amounts; credits are outside this model. |
| N4 | Invalid month/day accepted by date parser | Rejected | The provided `2026-13-45` fails the finite `Date.parse` check. |
| N5 | Zero token limit rejected | Rejected | `number(0)` and `Number.isSafeInteger(0)` both return true. |
| N6 | Pricing currency/key-count validation | Rejected | Currency-only claims are invalid; currency plus a zero price is valid, as the reviewer concludes. |
| N7 | Override/probe additions retain unbounded history | Rejected | Full override/probe history is an explicit API promise; silently pruning it would lose audit evidence. |
| N8 | Equal timestamp uses last insertion | Rejected | Last-insertion tie-breaking is intentional and documented. |
| N9 | Raw ID precedence across providers | Rejected | `model_name`, then `id`, then supported Fireworks `name` fallback matches the required provider formats. |
| N10 | Image-only modality list denies text input | Rejected | Absence from an explicit valid list is negative evidence for ordinary modalities. |
| N11 | Missing `top_provider` produces undefined output limit | Rejected | `object()` and `addClaim()` safely ignore the absent optional value. |
| N12 | Per-token price conversion and empty string | Rejected | Conversion multiplies by one million and already rejects blank strings. |
| N13 | OpenRouter supported efforts array | Rejected | `cleanValue()` validates and deduplicates supported effort arrays. |
| N14 | Anthropic thinking false becomes reasoning false | Rejected | Explicit false is valid capability evidence. |
| N15 | Anthropic effort supported-key extraction | Rejected | Only child entries with `supported: true` become effort levels. |
| N16 | Arbitrary lifecycle strings retained | Rejected | `cleanValue()` only accepts active/deprecated/retired. |
| N17 | Flat capability booleans | Rejected | Boolean validation already rejects malformed optional flags. |
| N18 | LiteLLM null support flags | Rejected | Nulls are skipped rather than converted to false. |
| N19 | LiteLLM input/output token limits | Rejected | Separate validated limits and the documented output fallback are correct; fixture coverage verifies them. |
| N20 | Fireworks image/tool flags | Rejected | Explicit validated support booleans map correctly. |
| N21 | Fireworks embedding kind | Rejected | `EMBEDDING_MODEL` is explicit embedding evidence. |
| N22 | Fireworks default sampling parameters | Rejected | Present valid numeric defaults establish sampling support, including zero. |
| N23 | Fireworks READY lifecycle | Rejected | READY establishes active status; subsequent explicit lifecycle evidence can supersede it. |
| N24 | Fireworks deprecation date | Rejected | A valid deprecation date establishes deprecated status. |
| N25 | Fireworks deprecated/retired/deleted state | Rejected | Explicit state mapping correctly distinguishes deprecated from retired/deleted. |
| N26 | Anthropic tools default | Rejected | This is one of the two explicitly allowed defaults. |
| N27 | `text-embedding-` default | Rejected | This is the other explicitly allowed default. |
| N28 | models.dev capability booleans | Rejected | Published reasoning/tool/structured-output/temperature booleans map directly. |
| N29 | models.dev modality mapping | Rejected | Shared modality normalization is correct apart from PDF absence, fixed under M2. |
| N30 | models.dev limit mapping | Rejected | Context/input/output limits map to their distinct validated fields. |
| N31 | models.dev pricing units | Rejected | Published per-million-token amounts correctly use factor one. |
| N32 | models.dev release date | Rejected | `release_date` correctly establishes release time; edit dates are already excluded. |
| N33 | models.dev reasoning options | Rejected | Effort values and other thinking-mode types are recorded separately. |
| N34 | Canonical ID retention | Rejected | Explicit canonical strings are validated and sanitized before retention. |

## Test gaps

New public-API coverage is in [review-regressions.test.ts](../test/review-regressions.test.ts); transport cases are in [transport.test.ts](../test/transport.test.ts). Existing coverage was checked in [atlas.test.ts](../test/atlas.test.ts), [normalizers.test.ts](../test/normalizers.test.ts), and [probes.test.ts](../test/probes.test.ts). Accepted gaps require tests only, not changes to correct implementation behavior.

| ID | Allegedly missing case | Disposition | Evidence / added assertion |
| --- | --- | --- | --- |
| G1 | Valid empty listing removes prior data | Rejected | Existing `partial refresh failure...` test explicitly returns `data: []` and checks delisting; added all-malformed-entry coverage separately. |
| G2 | Cheapest with partial versus complete prices | Accepted | Partial price sorts after complete prices, including complete zero prices. |
| G3 | Unconfigured probe provider | Accepted | Error report returned without any request. |
| G4 | Invalid override field/value | Accepted | Both throw their specified errors without adding a model. |
| G5 | Malformed snapshot `at` and `isStale` | Accepted | Invalid source is skipped, warns, and is stale; no new malformed-date implementation fix was needed. |
| G6 | Empty provider refresh filter | Accepted | Empty provider/catalog filters return no reports and make no requests. |
| G7 | Version-one snapshot missing arrays | Accepted | Restores an empty atlas with no warnings and missing sources are stale. |
| G8 | OpenAI custom base URL | Accepted | Exact custom listing URL is asserted. |
| G9 | Anthropic `has_more` without `last_id` | Accepted | Source fails atomically and retains prior snapshot. |
| G10 | Fireworks numeric `nextPageToken` | Accepted | Source fails atomically and retains prior snapshot. |
| G11 | models.dev provider with array `models` | Accepted | Malformed provider is skipped and counted. |
| G12 | OpenRouter catalog non-array `data` | Accepted | Catalog refresh fails. |
| G13 | Structured output parses but violates schema | Accepted | Parseable JSON is accepted under the documented schema-validation limitation. |
| G14 | Tool call with wrong function name | Accepted | Remains inconclusive. |
| G15 | Image number embedded in longer reply | Accepted | Reply containing `7381` succeeds under the specified contract. |
| G16 | Explicit temperature parameter with HTTP 5xx | Accepted | Remains inconclusive even with parameter-specific error metadata. |
| G17 | Duplicate reasoning efforts | Accepted | Stored supported efforts are deduplicated; explicit duplicate requests still run separately, contrary to the review's request-deduplication assertion. |
| G18 | Published effort value is non-array | Accepted | Listing and snapshot paths discard malformed effort claims before probing; default efforts run without exceptions, so no implementation fix was needed. |
| G19 | Snapshot null provider mapping | Accepted | JSON round-trip preserves null/global lookup. |
| G20 | Snapshot canonical ID | Accepted | JSON round-trip preserves endpoint canonical ID and matching. |
| G21 | Snapshot catalog key | Accepted | JSON round-trip preserves qualified key and matching. |
| G22 | `explain()` for additions-only model | Rejected | Existing probe-history snapshot test creates its model only by probing and inspects its explanation; new tests also assert additions-only provenance. |
| G23 | Stable `models()` order | Accepted | Out-of-order insertion produces deterministic provider/ID ordering. |
| G24 | String exclusion across providers | Accepted | ID-only exclusion removes both providers' matching IDs. |
| G25 | Unknown runtime capability requirement | Accepted | Excludes by default; is reported unknown with `allowUnknown`. |
| G26 | Unknown runtime preference string | Accepted | No preference effect; deterministic provider/ID tie-break remains. |
| G27 | Successful response with null body | Accepted | Safely reports invalid JSON. |
| G28 | NaN content length | Accepted | Valid small body succeeds and streamed bytes still enforce the cap. |
| G29 | Negative content length | Accepted | Valid small body succeeds and streamed bytes still enforce the cap. |
| G30 | Body `getReader()` throws | Accepted | Reports sanitized network failure. |
| G31 | HTTP failure with invalid JSON | Accepted | Exposes only HTTP status and no parameter. |
| G32 | HTTP failure with empty text body | Accepted | Exposes only HTTP status and no parameter. |
| G33 | HTTP failure with null body | Accepted | Exposes only HTTP status and no parameter. |
| G34 | HTTP failure with JSON array body | Accepted | Exposes only HTTP status and no parameter. |
| G35 | HTTP failure with JSON string body | Accepted | Exposes only HTTP status and no parameter. |
| G36 | HTTP failure with JSON numeric body | Accepted | Exposes only HTTP status and no parameter. |
| G37 | HTTP failure with JSON boolean body | Accepted | Exposes only HTTP status and no parameter. |
| G38 | HTTP failure with JSON null body | Accepted | Exposes only HTTP status and no parameter. |

## Validation and compatibility

- `npm run build`, `npm run typecheck`, `npm test`, and `git diff --check` pass; 63 tests, all with mocked network responses.
- Refresh reports may now contain `warnings`; probe report capability types now include `'cache'` for batch persistence failures. Consumers with exhaustive capability handling must account for that report kind.
- PDF absence now leaves capability unknown; existing explicit PDF booleans remain authoritative. Existing snapshots retain their recorded claims until refreshed.
- Future source timestamps remain stored as evidence but are stale while in the future; snapshots are caller-supplied evidence, not authenticated attestations.
- Timeout cleanup can cancel a returned body stream; an injected fetch that never resolves and ignores abort cannot be forcibly stopped by JavaScript.
