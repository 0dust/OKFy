---
name: okfy
description: Use when a user wants an agent to use docs through OKFy, set up or verify an OKFy MCP docs source, convert docs websites or local Markdown into OKF bundles, generate activation proof, or answer from an existing OKFy bundle/workspace.
---

# OKFy

## Overview

Use OKFy to turn documentation websites or local Markdown folders into local Open Knowledge Format bundles, then expose them to agents through a read-only MCP server. Prefer `npx -y okfy-ai` in generated commands so clients can launch the published package without a global install.

## Quick Reference

| Goal                                 | Command or action                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Register a docs site and print setup | `npx -y okfy-ai init <name> <url> --client codex --max-pages 100 --max-depth 4`                 |
| Import local Markdown                | `npx -y okfy-ai import ./docs --out ./docs-okf --source-name "Project docs"`                    |
| Prove a source for a task            | `npx -y okfy-ai activate <name-or-bundle> --client codex --task "<task>" --out okfy-activation` |
| Preview readiness and graph          | `npx -y okfy-ai map <name-or-bundle> --out okfy-inspector.html`                                 |
| Diagnose setup                       | `npx -y okfy-ai doctor <name> --client codex`                                                   |
| Serve to MCP                         | `npx -y okfy-ai serve <name-or-bundle> --mcp --auto-refresh`                                    |

## Setup Workflow

1. Choose a short source name such as `stripe`, `clerk`, or `project-docs`.
2. For a docs website, run `npx -y okfy-ai init <name> <url> --client codex --max-pages 100 --max-depth 4`.
3. For local Markdown, run `import`, then `validate`, then serve the generated bundle path. Only add `--force` after the user explicitly approves overwriting the output directory.
4. When the user wants proof before config changes, run `activate` with `--task` matching their real question. The packet includes `okfy-inspector.html`, `okfy-setup.md`, and `okfy-proof.json`.
5. If setup fails or the MCP client cannot see tools, run `doctor` before editing client config by hand.

## MCP Use

When an OKFy MCP server is available, use the tools in this order:

1. `bundle_summary` to inspect validation status, freshness, available sources, and tool expectations.
2. `search_concepts` with the user's task terms. Use `source` filters in multi-source workspaces when the relevant docs source is known.
3. `read_concept` for the most relevant concepts, keeping reads small before expanding.
4. `get_neighbors` when the answer depends on linked concepts, backlinks, prerequisites, or nearby API/reference pages.
5. Cite the source URLs or resource fields surfaced by the concept results.

Start with narrow searches, then broaden only when results are thin. In workspaces, pass both `source` and `id` to `read_concept` when concept ids are ambiguous.

## Workspaces

Serve multiple registered sources through one MCP server when a task spans a stack:

```bash
npx -y okfy-ai serve stripe clerk --mcp --auto-refresh
```

Then filter searches:

```json
{ "query": "checkout sessions", "source": "stripe", "limit": 5 }
```

Use `source` filters whenever the user names the product, API, framework, or docs source. If the user asks across the stack, search the workspace without a filter first, then use per-source reads for precision.

## Safety Rules

- MCP tools are read-only. Auto-refresh is server-side maintenance for registered sources, not an agent-callable write tool.
- Do not use `npx okfy`; use `npx -y okfy-ai` for no-install commands.
- Do not run `serve --mcp` as a normal chatty terminal session. MCP clients launch it as a stdio subprocess.
- Do not bypass crawler safety defaults, private-network protections, or unsafe `--force` guards unless the user explicitly accepts the risk.
- Do not hand-edit client config first when `init`, `activate`, or `doctor` can produce or verify the exact command/config.

## Common Mistakes

| Mistake                            | Fix                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Treating OKFy like a hosted index  | Keep the workflow local: bundle files, MCP stdio, and source URLs remain inspectable. |
| Reading every concept after search | Read the top matches first, then use neighbors to expand only where needed.           |
| Ignoring workspace source names    | Use `source` filters and source-qualified reads for multi-source bundles.             |
| Skipping proof                     | Use `activate --task` when the user needs confidence before wiring MCP.               |
| Debugging config blindly           | Run `doctor <name> --client codex` and follow its next repair command.                |
