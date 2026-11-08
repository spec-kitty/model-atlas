---
title: Probes are opt-in and never automatic
description: Probes are opt-in and never automatic.
doc_status: active
updated: 2026-11-08
type: ADR
kind: ADR
tags: [probes]
authors:
  - human:stijn
  - agent/claude-code
---

# Probes are opt-in and never automatic

## Status

Accepted

## Context

Probes give the strongest evidence but make real, billable requests against user credentials.

## Decision

Probes run only when the caller calls `probe()`, sequentially, with `max_tokens: 64`. Transport failures and auth/rate-limit errors produce no claim.

## Consequences

No surprise spend. Probe evidence must be refreshed deliberately. See [opt-in probes](../api/probes.md).
