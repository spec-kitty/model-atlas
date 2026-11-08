<!-- spec-kitty:orientation -->
**Spec Kitty v4.0.0rc8** — project: model-atlas (healthy)

Two usage patterns:
- **Full mission** (spec → plan → tasks → implement → review → merge):
  trigger: "spec out", "create a mission", "write a spec", "plan this"
  → run `/spec-kitty.specify` (slash-command agents), `$spec-kitty-specify` (codex), `/skill:spec-kitty-specify` (pi) or `/spec-kitty-specify` (antigravity, letta, vibe)
- **Lightweight dispatch** (ad-hoc fix, question, or advice — no mission created):
  trigger: "hey spec kitty", "use spec kitty to", "spec kitty <anything>"
  → **ALWAYS run `spec-kitty dispatch "<request verbatim>"` — do NOT answer directly.**
  If you know the right profile, pass it to skip routing:
  `spec-kitty dispatch "<request verbatim>" --profile <profile-id>`
  Reason: `spec-kitty dispatch` loads governance context, routes the request,
  and opens the Op. Skipping it produces ungoverned, untracked responses.
  After finishing the work, close the Op with the command printed in the capsule
  (`spec-kitty profile-invocation complete --invocation-id <id> --outcome <done|failed|abandoned>`).
<!-- /spec-kitty:orientation -->

## Documentation

All documentation is in `docs/`, written in the **DocKitty** convention
(https://github.com/spec-kitty/doc-kitty). Start at [`docs/README.md`](./docs/README.md).
Sections are declared in [`docs/_meta/sections.yaml`](./docs/_meta/sections.yaml).

Rules:
- Every page carries frontmatter: `title`, `description`, `doc_status`, `updated`, `type`, `kind`.
- `README.md` is the section index (`kind: Hub`); filenames are lowercase kebab-case.
- Plans describe the future, ADRs record the past (immutable, `NNNN-title.md`), architecture describes the present.
- Keep the root `README.md` short; put detail in `docs/`.

## Development

`npm ci && npm run build && npm run typecheck && npm test`. Tests use fixtures and
injected fetch only — never call live endpoints from tests. Never print or persist API keys.
