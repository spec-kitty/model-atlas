---
title: Glossary
description: Domain vocabulary used across model-atlas.
doc_status: active
updated: 2026-11-08
type: Context
kind: Glossary
tags: [glossary]
authors:
  - human:stijn
  - agent/claude-code
---

# Glossary

- **Provider** — a configured endpoint (`id`, `kind`, `baseUrl`, …) whose model listing is read. Provider IDs are yours, independent of vendor names.
- **Catalog** — a public, read-only source (models.dev, OpenRouter) that enriches models already listed or overridden.
- **Claim** — one piece of evidence `{ value, source, via, at }` for one field of one model.
- **Source kind** — `override`, `probe`, `endpoint`, `catalog`, `default`; also the precedence order.
- **Probe** — an opt-in, billable minimal request that tests one capability.
- **Override** — a caller-supplied claim with the highest precedence.
- **Snapshot** — a versioned, credential-free serialization of the atlas for offline use.
- **Unknown** — `null` or missing; never treated as `false`.
- **Selection** — deterministic ranking of candidate models by requirements and ordered preferences.
