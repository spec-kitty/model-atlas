---
title: Providers and published data
description: Supported provider kinds, their listing endpoints and auth, and what each gateway publishes.
doc_status: active
updated: 2026-11-08
type: Integration
kind: Reference
tags: [providers, gateways]
authors:
  - human:stijn
  - agent/claude-code
---

# Providers and published data

Each config has `{ id, kind, baseUrl?, apiKey?, headers?, account?, listingParams? }`. `id` is your stable provider identifier, independent of upstream vendor names. IDs must be unique safe identifiers (letters, digits, `.`, `_`, `-`). Provider IDs and catalog IDs have separate namespaces. Headers are request-only; an explicit `apiKey` sets the protocol's auth header. Anthropic's API version is `2023-06-01`.

| Kind | Default listing / base convention | Auth and pagination |
| --- | --- | --- |
| `anthropic` | `https://api.anthropic.com/v1/models?limit=1000`; custom base is the API root | `x-api-key`; follows `has_more` / `last_id` using `after_id` |
| `openai` | `https://api.openai.com/v1/models`; custom base includes `/v1` | Bearer |
| `openai-compatible` | Required `baseUrl` + `/models`, e.g. `https://gateway.example/v1/models` | Bearer; also tries origin + `/model/info`; that optional call's failure is silent |
| `openrouter` | `https://openrouter.ai/api/v1/models`; custom base includes `/api/v1` | Optional Bearer; listing is public |
| `fireworks` | `https://api.fireworks.ai/v1/accounts/{account}/models?pageSize=200`; account defaults to `fireworks` | Bearer; follows `nextPageToken` using `pageToken` |

`listingParams` adds query parameters to the listing request only, never to `/model/info` or probes; for example Nebius Token Factory publishes modalities only with `{ verbose: 'true' }`. Values must be strings; anything else fails the source before a request. They are not treated as secrets and are not redacted, so put credentials in `apiKey` or `headers`.

`baseUrl` can override any provider for tests or proxies. Fireworks probes use `https://api.fireworks.ai/inference/v1/chat/completions` by default, including when `baseUrl` explicitly names the default control plane (`https://api.fireworks.ai/v1`). Other custom bases are also used for probes. For separate custom Fireworks control-plane and inference origins, use a separate `openai-compatible` provider config for inference.

Gateway survey, **verified 1 November 2026** (a dated survey, not a promised current model count):

| Provider | Listing | What it publishes |
| --- | --- | --- |
| [Anthropic](https://platform.claude.com/docs/en/api/models/list) | `/v1/models` | Full `capabilities` tree: image/PDF input, structured output, thinking types and effort levels; limits and lifecycle; no pricing |
| [OpenRouter](https://openrouter.ai/docs/api-reference/models/get-models) | Public `/api/v1/models` — 452 models in the survey | Modalities, `supported_parameters`, limits, prices including cache tiers, expiry |
| [TokenFactory](https://gateway.trytokenfactory.dev/v1/models) / [LiteLLM](https://docs.litellm.ai/docs/proxy/model_info) | `/v1/models`, optional `/model/info` | OpenRouter fields plus flat capabilities; `/model/info` `supports_*` flags are null because they are not configured |
| [Fireworks](https://docs.fireworks.ai/api-reference/list-models) | `/v1/accounts/{account}/models` | `supportsImageInput`, `supportsTools`, `contextLength`, `defaultSamplingParams`, `deprecationDate` |
| [OpenAI](https://platform.openai.com/docs/api-reference/models/list) | `/v1/models` | `id`, `object`, `created`, `owned_by` only |

Normalization detects **each entry's shape**, regardless of configured kind, and merges all recognized fields within that entry. TokenFactory's modalities and flat flags both contribute claims. LiteLLM nulls create no claims; its generic `supported_openai_params` is not treated as model-specific evidence. Invalid entries are counted in refresh reports; invalid optional values are ignored. Unknown fields are discarded.

Two documented defaults are the only assumptions: models on an `anthropic` provider support tools (`source: 'default'`), and IDs beginning `text-embedding-` get an embeddings default. No other capability is inferred from model names. Generic `file` input and models.dev's `attachment` flag do not establish PDF support; PDF remains unknown without explicit evidence. The combined OpenRouter-style `architecture.modality` string (`text+image->text`) is read when the separate modality arrays are absent. An `embedding` or `embeddings` output modality, or models.dev's `type: "embedding"`, establishes embeddings support; its absence does not establish rejection. An explicit `pdf` modality establishes support; PDF's absence from a modality list does not establish rejection. Other absent modalities in a valid explicit modality list are false; missing sampling parameters in an explicit `supported_parameters` list are false. Missing non-sampling parameters remain unknown.
