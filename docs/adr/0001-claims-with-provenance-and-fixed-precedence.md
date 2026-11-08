---
title: Claims with provenance and fixed precedence
description: Claims with provenance and fixed precedence.
doc_status: active
updated: 2026-11-08
type: ADR
kind: ADR
tags: [claims]
authors:
  - human:stijn
  - agent/claude-code
---

# Claims with provenance and fixed precedence

## Status

Accepted

## Context

Gateways publish inconsistent, partial and sometimes wrong capability data. Hardcoded tables drift, and silently merged values hide why a routing decision was made.

## Decision

Every field is a set of claims `{ value, source, via, at }`. The winning claim follows a fixed order: override > probe > endpoint > catalog > default. `null` and missing mean unknown, never false. Losing claims stay available through `explain()`.

## Consequences

Decisions are auditable. Consumers must handle `undefined` (unknown) as distinct from `false`. See [claims and precedence](../architecture/claims-and-precedence.md).
