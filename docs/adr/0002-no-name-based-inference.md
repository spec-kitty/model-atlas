---
title: No capability inference from model names
description: No capability inference from model names.
doc_status: active
updated: 2026-11-08
type: ADR
kind: ADR
tags: [claims, catalogs]
authors:
  - human:stijn
  - agent/claude-code
---

# No capability inference from model names

## Status

Accepted

## Context

Model names do not reliably describe what a gateway variant supports; fuzzy matching produces confident wrong answers.

## Decision

Only two documented defaults exist (Anthropic models support tools; `text-embedding-*` IDs get embeddings). Catalog matching is exact or explicitly canonical; ambiguity is reported, never guessed.

## Consequences

More fields stay unknown until an endpoint, catalog, probe or override supplies evidence. See [catalog matching](../integrations/catalogs.md).
