---
title: Security and operational boundaries
description: Credential handling, request limits, untrusted-data rules and network scope.
doc_status: active
updated: 2026-11-08
type: Security
kind: Reference
tags: [security, credentials]
authors:
  - human:stijn
  - agent/claude-code
---

# Security and operational boundaries

- Keys/custom auth headers live only in private request configuration. The library never logs them or persists them. Reports never contain raw upstream errors; successful normalized strings are scrubbed for configured secrets (literal, URL/form-encoded, base64 and base64url forms) and full HTTP URLs. This is not detection of arbitrary obfuscation or transformations. Arbitrary response properties are never retained. Only endpoint hostnames are stored.
- Every request has a deadline (default 20 seconds, including body reads) and a streamed byte cap (default 20 MiB), independent of `Content-Length`. Redirects are rejected to prevent forwarding credentials to another origin. Pagination is capped at 100 pages and repeated cursors are rejected.
- All fetched JSON is untrusted data. Shapes, booleans, finite nonnegative limits/prices, dates and claim fields are validated. Nulls remain unknown. HTML, prompts and upstream instructions are never executed.
- Only explicitly configured base URLs are contacted, plus the two fixed public catalogs and the compatible endpoint's `/model/info`. Do not accept arbitrary untrusted endpoint configs in a server without your own outbound-network policy. Configure header credentials instead of URL userinfo, which is stripped from requests. Query parameters can be used for a gateway but are never persisted.
- Injected transports must protect credentials too. Their exception text is discarded. Snapshots represent caller-supplied evidence, not signed attestations. Model evidence can become stale or simply be wrong; opt-in probes provide additional evidence, not guarantees.
