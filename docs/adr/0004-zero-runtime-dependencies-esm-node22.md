---
title: Zero runtime dependencies, ESM-only, Node 22+
description: Zero runtime dependencies, ESM-only, Node 22+.
doc_status: active
updated: 2026-11-08
type: ADR
kind: ADR
tags: [packaging]
authors:
  - human:stijn
  - agent/claude-code
---

# Zero runtime dependencies, ESM-only, Node 22+

## Status

Accepted

## Context

The library targets Node services and Electron headless cores where supply-chain surface and bundle size matter.

## Decision

Strict TypeScript, ESM only, Node 22+, global `fetch` with injection, no runtime dependencies.

## Consequences

Small attack surface and simple installs; CommonJS consumers must use dynamic import. Testing relies on injected fetch and fixtures.
