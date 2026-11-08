---
title: Quickstart
description: Install the package, configure providers and catalogs, and query capabilities.
doc_status: active
updated: 2026-11-08
type: Guide
kind: Tutorial
tags: [quickstart]
authors:
  - human:stijn
  - agent/claude-code
---

# Quickstart

```sh
npm install @spec-kitty/model-atlas
# Before an npm release, install a Git ref; prepare builds declarations and JavaScript:
pnpm add github:spec-kitty/model-atlas#<ref>
```

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

Next: [providers](../integrations/providers.md), [selection](../api/selection.md), [claims and precedence](../architecture/claims-and-precedence.md).
