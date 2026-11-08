---
title: Adopt the DocKitty documentation convention
description: Adopt the DocKitty documentation convention.
doc_status: active
updated: 2026-11-08
type: ADR
kind: ADR
tags: [docs, governance]
authors:
  - human:stijn
  - agent/claude-code
---

# Adopt the DocKitty documentation convention

## Status

Accepted

## Context

Documentation lived in one long README plus two loose files in `docs/`, with no metadata, which made it hard for humans and agents to navigate and kept it out of the Spec Kitty ecosystem.

## Decision

Documentation follows the [DocKitty](https://github.com/spec-kitty/doc-kitty) convention: a repo-root `docs/` tree of canonical sections, `README.md` as section index with frontmatter, and an authored section registry in `docs/_meta/sections.yaml`. The project is initialised with Spec Kitty (`.kittify/`).

## Consequences

The README becomes a short entry point. New docs need frontmatter (`title`, `description`, `doc_status`, `updated`, `type`, `kind`). The tree can be rendered by the DocKitty toolkit later without moving files.
