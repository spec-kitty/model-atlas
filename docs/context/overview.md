---
title: Overview
description: What model-atlas is, the problem it solves, and its design constraints.
doc_status: active
updated: 2026-11-08
type: Context
kind: Explanation
tags: [overview, product]
authors:
  - human:stijn
  - agent/claude-code
---

# Overview

An open-source model capability catalog and router for Node.js and Electron's headless core. Published as `@spec-kitty/model-atlas` under MIT, © 2026 Spec Kitty, Inc.

Model names do not reliably describe gateway capabilities. A gateway can serve a vision-enabled variant of a text model, reject sampling parameters supported elsewhere, or expose different limits. Hardcoded model tables drift. Model Atlas reads each endpoint's listing, fills gaps from public catalogs, optionally tests capabilities with small real requests, and preserves the evidence behind every decision.

TypeScript, strict mode, ESM only, Node **22+**, zero runtime dependencies. Uses global `fetch`, with injection for tests and custom transports. No browser UI or Electron dependency.

## Who it is for

- Node.js services and Electron headless cores that route requests across several model gateways.
- Agent tooling (for example spec-kitty profiles or an MCP server, see [plans](../plans/README.md)) that needs evidence-backed answers to "which model can do X?".

## Non-goals

- No browser UI, no Electron dependency, no billing estimates.
- No inference of capabilities from model names beyond the two documented defaults.
