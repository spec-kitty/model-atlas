---
title: Opt-in probes
description: Billable capability probes: what each probe sends and which evidence it produces.
doc_status: active
updated: 2026-11-08
type: API
kind: Reference
tags: [probes]
authors:
  - human:stijn
  - agent/claude-code
---

# Opt-in probes

**Probes never run automatically.** They make real billable requests, sequentially, with `max_tokens: 64`. They test acceptance/behavior of a minimal request, not every possible combination of options.

```ts
await atlas.probe('tokenfactory', 'kimi-k3', [
  'imageInput', 'tools', 'structuredOutput', 'temperature', 'topP',
  { capability: 'reasoning', efforts: ['low', 'high', 'max'] },
]);
```

OpenAI-compatible providers use `/chat/completions`; Anthropic uses native `/v1/messages`, image source blocks, tools, `output_config.format` for JSON schema, and adaptive thinking with `output_config.effort`. String `'reasoning'` tests published effort levels, or `low`, `medium`, `high` if the list is absent or empty. Explicit effort arrays must contain 1–32 tokens matching `[a-z][a-z0-9_-]{0,31}`; invalid input returns an error report without a request.

| Probe | Evidence |
| --- | --- |
| `imageInput` | Embedded PNG containing blue **7381** and a red circle; asks for the number. Reply containing `7381` → true; wrong reply or HTTP 400/422 → false |
| `tools` | One `ping` tool; required choice unless tool choice is known unsupported. A 400/422 naming `tool_choice` retries once without forced choice. Returned `ping` call → true; other HTTP 400 → false; no call → inconclusive |
| `structuredOutput` | Minimal JSON schema. Accepted, parseable JSON → true; HTTP 400/422 naming `response_format` (Anthropic: `output_config.format`) → false; malformed JSON or unrelated rejections → inconclusive. This does not validate arbitrary schemas |
| `temperature`, `topP` | Sends the parameter. Accepted → true; HTTP 400 naming that parameter → false; unrelated rejection → inconclusive |
| Reasoning efforts | Tests each level. Accepted levels are added; HTTP 400/422 naming `reasoning_effort` (Anthropic: `output_config.effort` or `effort`) removes the tested level from a known effort list. Rejection without a known list leaves it unknown. Unrelated errors, including thinking-budget errors, are inconclusive |

HTTP 401/403/429/5xx, network failures, timeouts, invalid envelopes and oversized responses produce **no new claim**, only sanitized error reports. Earlier evidence remains. Probe reports are `{ capability, effort?, ok, value?, error? }`; `ok: true, value: false` means a conclusive negative result, not a transport failure. Reasoning claims preserve observed effort-list changes and their `probe:reasoning:<level>` provenance; untested published efforts remain in the list.

Parameter-specific rejections use structured error parameters or messages beginning with a recognized parameter rejection. Echoed request fields are ignored. One rejected effort does not establish that reasoning as a whole is unavailable.
