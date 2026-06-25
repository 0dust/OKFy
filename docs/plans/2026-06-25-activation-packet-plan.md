---
title: OKFY Activation Packet Implementation Plan
origin: docs/prds/2026-06-25-activation-packet-prd.md
date: 2026-06-25
execution: code
---

# OKFY Activation Packet Implementation Plan

## Scope

Build a new `okfy activate` command that produces a local activation packet for registered sources, local OKF bundles, and workspaces. The packet should reuse the Inspector report model, setup artifact rendering, and bundle search primitives instead of creating a parallel product path.

Do not write client config files. Do not add hosted sharing, embeddings, or `llms.txt` export in this PR.

## Implementation Units

### U1: Activation Model And Packet Builder

Files:

- `src/activation.ts`
- `src/index.ts`
- `tests/activation.test.ts`

Approach:

- Add a packet builder that accepts resolved workspace records, an Inspector report, selected client, MCP command data, and output paths.
- Generate a deterministic proof object from the selected records:
  - summary from Inspector readiness and sources
  - query derived from the first readable concept
  - search results using `BundleSearch`
  - read result for the strongest concept
  - neighbors for the read concept when links exist
- Generate setup Markdown with command, artifacts, first prompt, readiness, and file list.
- Export public activation types and builders from `src/index.ts`.

Test scenarios:

- Local bundle activation proof includes summary, search, read, citation URL, and neighbor data.
- Workspace activation proof preserves source names and source-scoped refs.
- Setup Markdown includes the selected client, command, first prompt, and packet files.

### U2: Setup Artifact Reuse

Files:

- `src/setup.ts`
- `tests/setup.test.ts`

Approach:

- Extract a reusable client artifact renderer that can receive an explicit server name, Codex server name, and serve command.
- Keep existing `renderClientArtifacts` behavior unchanged for `init` and `doctor`.
- Support activation commands for local bundle paths without forcing `--auto-refresh`.

Test scenarios:

- Existing source-name setup artifacts remain byte-compatible.
- Explicit activation artifacts render Codex TOML/CLI and generic JSON around an arbitrary serve command.

### U3: CLI Command

Files:

- `src/cli.ts`
- `tests/source-cli.test.ts`

Approach:

- Add `okfy activate [targets...]`.
- Reuse `resolveCliTargets` so target semantics match `map` and `serve`.
- Add options: `--all`, `--client`, `--out`, `--force`, and `--json`.
- Write files atomically after validation/proof generation succeeds.
- Refuse non-empty output dirs unless `--force` is present.

Test scenarios:

- Local bundle activation writes the three expected files and prints the output path.
- Registered workspace activation writes client-specific setup and source-aware proof.
- Missing targets and non-empty output dirs fail without partial packets.

### U4: Inspector Setup Block

Files:

- `src/inspector.ts`
- `src/inspector-html.ts`
- `tests/inspector-html.test.ts`

Approach:

- Extend `InspectorReport` with optional activation setup metadata.
- Render an "Agent Setup" section only when activation metadata is present.
- Keep normal `okfy map` output unchanged except for accepting the optional field.

Test scenarios:

- Normal Inspector still renders the existing shell and embedded JSON.
- Activation Inspector renders command, first prompt, and generated packet file names.
- HTML escaping continues to cover activation text.

### U5: Public Docs And Package Surface

Files:

- `README.md`
- `docs/mcp-clients.md`
- `examples/README.md`
- `scripts/npm-readme.md`
- `tests/public-surface.test.ts`
- `dist/*`

Approach:

- Lead with `activate` as the fastest first-run proof loop.
- Keep `map` as the lower-level Inspector command.
- Update shipped npm README and public-surface assertions.
- Rebuild `dist`.

Test scenarios:

- Public docs mention `npx -y okfy-ai activate`.
- `npm pack --dry-run --json` includes the updated docs and built output.

## Verification

- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `npm pack --dry-run --json`
- One CLI smoke command against `examples/bundles/stripe-checkout-small`
- `git diff --check`
