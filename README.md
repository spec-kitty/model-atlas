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

## Documentation

Full documentation lives in [`docs/`](./docs/README.md), following the [DocKitty](https://github.com/spec-kitty/doc-kitty) convention:

- [Overview](./docs/context/overview.md) and [glossary](./docs/context/glossary.md)
- [Providers](./docs/integrations/providers.md) and [catalog matching](./docs/integrations/catalogs.md)
- [Claims and precedence](./docs/architecture/claims-and-precedence.md); [refresh, snapshots and cache](./docs/architecture/refresh-snapshots-cache.md)
- [Selection](./docs/api/selection.md) and [opt-in probes](./docs/api/probes.md)
- [Security boundaries](./docs/security/boundaries.md)
- [Development and smoke test](./docs/guides/development.md)
- [Decision records](./docs/adr/README.md) and [roadmap](./docs/plans/roadmap.md)

## License

MIT © 2026 Spec Kitty, Inc. See [LICENSE](./LICENSE).
