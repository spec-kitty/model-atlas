---
title: Development and live smoke test
description: Build, typecheck and test locally, and run the live gateway smoke check.
doc_status: active
updated: 2026-11-08
type: Guide
kind: How-To
tags: [development, testing]
authors:
  - human:stijn
  - agent/claude-code
---

# Development and live smoke test

```sh
npm ci
npm run build
npm run typecheck
npm test
COMPATIBLE_API_KEY=... node scripts/smoke.mjs --probe
```

Tests use Node's built-in runner, `--experimental-strip-types`, fixture JSON and injected fetch only; no network. TypeScript 5.9 rewrites source `.ts` imports to `.js` in `dist` and emits type declarations. CI checks Node 22 and 24; actions are pinned to SHAs. The licensing test enforces the canonical MIT text and sole holder **Spec Kitty, Inc.**

The separate smoke script loads TokenFactory, public OpenRouter and models.dev, prints source counts and the TokenFactory capability table, asserts 12 specified vision values, and optionally probes `glm-5.3` (false) and `kimi-k3` (true). It reads only `COMPATIBLE_API_KEY` from the environment; it never prints it. Live model counts and catalog matches can change independently of this package.
