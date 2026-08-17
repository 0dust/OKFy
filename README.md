<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.png">
    <img src="assets/logo-light.png" alt="okfy logo: hand-drawn OKFY knowledge blocks" width="520">
  </picture>

  <p><strong>Open Knowledge Format for AI agents.</strong></p>

  <p>Give coding agents searchable, source-linked documentation—locally.</p>

  <p>
    Plain Markdown | read-only MCP | no LLM key | no hosted index
  </p>

  <p>
    <a href="https://www.npmjs.com/package/okfy-ai"><img alt="npm package okfy-ai 0.3.5" src="https://img.shields.io/badge/npm-okfy--ai%400.3.5-2f7d5b?logo=npm"></a>
    <a href="https://github.com/0dust/OKFy/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/0dust/OKFy/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://github.com/0dust/OKFy/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-3f3a36"></a>
    <img alt="Node 20 plus" src="https://img.shields.io/badge/node-20%2B-4b5563">
    <img alt="MCP stdio" src="https://img.shields.io/badge/MCP-stdio-5f5a4f">
    <a href="https://bundledex.net/bundles/okfy/"><img alt="BundleDex" src="https://bundledex.net/badge/okfy.svg"></a>
  </p>

  <p>
    <a href="#quickstart">Quickstart</a> |
    <a href="#why-okfy">Why OKFy</a> |
    <a href="#connect-your-agent">Connect your agent</a> |
    <a href="#project-stack-workspaces">Workspaces</a> |
    <a href="#create-a-bundle">Create a bundle</a> |
    <a href="docs/mcp-clients.md">Client guides</a>
  </p>
</div>

---

Agents often receive too much documentation at once or depend on retrieval that a team cannot inspect and version.

OKFy turns documentation websites and Markdown folders into [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) v0.1-conformant bundles: typed, linked Markdown that you can inspect and Git can diff. Its local MCP server lets Claude, Codex, Cursor, and other agents search the bundle, read only the relevant concepts, follow relationships, and return the original source references.

![okfy terminal demo](assets/demo.gif)

## Quickstart

Register a documentation source and generate setup for your agent:

```bash
npx -y okfy-ai init stripe https://docs.stripe.com/checkout --client codex
```

`init` crawls the source into a local bundle, prints the MCP configuration, and gives you a first prompt. It does not edit your agent configuration.

After adding the printed configuration, ask:

```text
Using the Stripe documentation, explain the minimum Checkout Sessions
backend flow. Read the relevant concepts, follow related documentation
when needed, and include every source reference used.
```

The agent follows a small, inspectable retrieval path:

```text
question
  -> search_concepts: find relevant pages
  -> read_concept: read only the strongest matches
  -> get_neighbors: follow related documentation when needed
  -> answer with original source references
```

No embedding service or LLM API key is required. Website sources are cached under `~/.okfy` and can refresh when stale.

The bundled offline example produces this deterministic search result:

```text
query: "serve docs over MCP"
1. guides/serve-over-mcp       resource: guides/serve-over-mcp.md
2. home                        resource: index.md
3. guides/import-local-markdown resource: guides/import-local-markdown.md
```

Website crawls retain URLs; local imports retain file resources like those above.

## Why OKFy

OKFy is useful when the knowledge behind an agent answer must remain visible and portable.

| Approach                   | Trade-off                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Paste an entire docs site  | Simple, but consumes context and makes retrieval implicit.                                                     |
| Hosted documentation index | Convenient, but the indexed content and ranking are outside your project.                                      |
| `llms.txt`                 | A useful entry point, but usually remains one document or a list of documents.                                 |
| OKFy                       | Typed, linked Markdown on disk, deterministic lexical search, visible source references, and local MCP access. |

An OKF bundle is ordinary files:

```text
docs website or Markdown folder
  -> typed Markdown concepts with links and source references
  -> deterministic validation and search
  -> read-only MCP tools
  -> source-backed agent answers
```

- **Inspectable:** open every concept and see exactly what the agent can read.
- **Git-diffable:** review knowledge changes like code changes.
- **Source-linked:** retrieval results retain website URLs or local file resources and provenance.
- **Progressive:** agents search first, then read only relevant concepts and neighbors.
- **Local-first:** bundles and refresh state stay on your machine.

## Connect Your Agent

The command printed by `init` serves the cached source through MCP:

```bash
npx -y okfy-ai serve stripe --mcp --auto-refresh
```

### Codex

Add to `~/.codex/config.toml` or trusted project configuration:

```toml
[mcp_servers.stripe_okf]
command = "npx"
args = ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

### Claude Code

```bash
claude mcp add --transport stdio stripe-okf -- npx -y okfy-ai serve stripe --mcp --auto-refresh
```

### Claude Desktop, Cursor, and other MCP clients

```json
{
  "mcpServers": {
    "stripe-okf": {
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh"]
    }
  }
}
```

See [docs/mcp-clients.md](docs/mcp-clients.md) for client-specific paths, troubleshooting, and the official agent skill in [skills/okfy/SKILL.md](skills/okfy/SKILL.md).

If setup fails, run:

```bash
npx -y okfy-ai doctor stripe --client codex
```

`doctor` checks source state, bundle validity, freshness, `npx`, generated configuration, MCP tool visibility, and JSON-RPC-clean stdout.

## Project Stack Workspaces

Most coding tasks cross more than one documentation source. Serve several registered sources through one source-aware MCP server:

```bash
npx -y okfy-ai add stripe https://docs.stripe.com/checkout
npx -y okfy-ai add clerk https://clerk.com/docs
npx -y okfy-ai doctor stripe clerk --client codex
npx -y okfy-ai serve stripe clerk --mcp --auto-refresh
```

Search results preserve their source. Agents can filter ambiguous searches:

```json
{ "query": "checkout sessions", "source": "stripe", "limit": 5 }
```

Duplicate concept IDs can be read with source-aware disambiguation:

```json
{ "source": "stripe", "id": "guides/quickstart" }
```

Use `bundle_summary` at the start of a workspace session to see totals, per-source validity, freshness, refresh progress, and errors. Use `--all` only when every registered source in the current `OKFY_HOME` belongs in the agent's context.

Project-local documentation works the same way:

```bash
npx -y okfy-ai import ./docs/api --out ./okf/api-docs --source-name "API docs"
npx -y okfy-ai import ./docs/product --out ./okf/product-docs --source-name "Product docs"
npx -y okfy-ai serve ./okf/api-docs ./okf/product-docs --mcp
```

## Keep Sources Fresh

Registered website sources store crawl policy and refresh state under `~/.okfy`. The default `stale-while-refresh` mode serves the current valid bundle immediately while refreshing stale documentation in the background.

```bash
npx -y okfy-ai sources
npx -y okfy-ai check stripe
npx -y okfy-ai update stripe
npx -y okfy-ai serve stripe --mcp --auto-refresh
```

Use blocking refresh when answers must wait for the newest crawl:

```bash
npx -y okfy-ai serve stripe --mcp --auto-refresh --refresh-mode blocking
```

Use `--refresh-mode off` to prevent MCP serving from fetching the network. Manual `update` remains available.

There is no OKFY account, cloud registry, hosted ranking service, or cloud refresh worker.

## Create A Bundle

Use the lower-level commands when you want an explicit snapshot rather than a registered source.

Website documentation:

```bash
npx -y okfy-ai crawl https://docs.stripe.com/checkout --out ./stripe-checkout-okf --max-pages 25
npx -y okfy-ai validate ./stripe-checkout-okf
npx -y okfy-ai inspect ./stripe-checkout-okf
```

Local Markdown:

```bash
npx -y okfy-ai import ./docs --out ./docs-okf --source-name "Project docs"
npx -y okfy-ai validate ./docs-okf
```

### Import Obsidian Vaults

Obsidian knowledge semantics are recognized automatically by the existing local import path. Point `okfy import` at a vault or folder exactly as you would any Markdown source; there is no Obsidian flag, plugin, separate command, or requirement for the Obsidian app:

```bash
npx -y okfy-ai import ./my-vault --out ./vault-okf --source-name "Team vault" --force
npx -y okfy-ai validate ./vault-okf
```

For Markdown and MDX notes, okfy preserves these knowledge-bearing conventions:

- Source YAML `title`, `description`, and `type` override inferred values when they are non-empty strings. `aliases` and `tags` accept a string or string array; source and inline tags augment inferred tags and are deduplicated case-insensitively. Incompatible recognized values emit `invalid_frontmatter_property` and fall back instead of partially applying. Malformed YAML is a document-level import error. Other safe YAML properties are retained deterministically; okfy owns `resource` and `timestamp`.
- The source YAML block is removed from the body and merged into the single generated OKF frontmatter block.
- Inline Obsidian tags are collected from prose, including nested tags such as `#product/setup`. Tokens inside fenced code, inline code, HTML, or MDX expressions are left literal.
- A uniquely resolved `[[note]]`, `[[note|label]]`, `[[note#Heading|label]]`, or `[[note#^block-id]]` becomes a relative Markdown link. Heading targets are slugged and block IDs become portable anchors, so graph links and backlinks work in the generated bundle.
- A resolved note embed such as `![[Shared Context]]` becomes a relationship link; the target note's contents are not copied into the source note. Recognized image, audio, video, and PDF attachment embeds such as `![[diagram.png|600]]` remain readable Obsidian references and do not create concepts or warnings.

Resolution is conservative. Missing or ambiguous references are not guessed: okfy leaves the original wikilink readable and reports `unresolved_wikilink` or `ambiguous_wikilink`. A link to a missing heading or block reports `missing_wikilink_fragment`. These diagnostics are warnings—the import still completes and a structurally valid bundle remains valid. When converting a wikilink would otherwise lose warning provenance, generated bundles persist that provenance in a versioned `okfy-import-diagnostics.json` manifest so `validate`, Inspector, and MCP report the same warning. The CLI prints a warning summary; validation, Inspector, and `bundle_summary` expose the detailed semantic warnings. Import-time results also include `invalid_frontmatter_property` warnings.

The same behavior is available programmatically without an Obsidian option:

```ts
import { importLocal, type DocumentDiagnostic, type ImportResult } from "okfy-ai";

const result: ImportResult = await importLocal({
  inputPath: "./my-vault",
  outDir: "./vault-okf",
  sourceName: "Team vault",
  force: true
});

const diagnostics: DocumentDiagnostic[] = result.diagnostics;
```

This support models note identity, classification, and relationships. It does not parse Canvas, Bases, PDFs, images, audio, video, callouts, highlights, comments, tasks, Dataview fields, or presentation-only embed dimensions; write back to the vault; expand embedded note contents; or add semantic/vector search.

Serve an existing bundle path when you already manage the bundle yourself:

```bash
npx -y okfy-ai serve ./docs-okf --mcp
```

Direct bundle paths are explicit snapshots and do not use source auto-refresh. MCP clients start it as a subprocess; do not run `serve --mcp` as a normal interactive terminal command.

Add `--force` only when you explicitly intend to replace an existing non-empty output bundle.

## MCP Tools

| Tool              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `bundle_summary`  | Report bundle or workspace validity, size, and source freshness. |
| `search_concepts` | Find concept previews by query, source, type, or tags.           |
| `read_concept`    | Read a concept body, metadata, links, backlinks, and source.     |
| `get_neighbors`   | Traverse outbound links and backlinks around a concept.          |
| `list_types`      | List concept types and counts.                                   |
| `list_tags`       | List tags and counts.                                            |

The MCP server exposes read-only tools. Auto-refresh is server-side source maintenance, not an agent-callable write tool.

Programmatic MCP integrations can import the stable public surface:

```ts
import { createMcpServer, type ServeOptions } from "okfy-ai/mcp";
```

Programmatic imports remain compatible with the `okfy-ai` root surface. New setup-only code can import pure artifact helpers such as `serveCommand` and `renderClientArtifacts` from `okfy-ai/setup`.

## Inspect And Share A Bundle

Generate a local static HTML Inspector when you want to browse relationships, validation warnings, freshness, and source URLs:

```bash
npx -y okfy-ai map stripe --out okfy-inspector.html
```

Use `--json` when CI or tests need the same Inspector report model without writing HTML.

For a shareable setup snapshot, activation writes the Inspector, client configuration, and a deterministic retrieval transcript:

```bash
npx -y okfy-ai activate stripe --client codex --out okfy-activation
```

The folder includes `okfy-inspector.html`, `okfy-setup.md`, and `okfy-proof.json`. Activation does not write client config files by default. Preview what your agent will know, then paste or share the generated setup when useful.

## Bundle Format

Each non-reserved source page or file becomes a concept:

```md
---
type: "Guide"
title: "Import Local Markdown"
description: "Convert a local Markdown folder into an OKF bundle."
resource: "guides/import-local-markdown.md"
tags: ["okfy", "import"]
timestamp: "2026-06-14T00:00:00.000Z"
---

# Import Local Markdown

Run `okfy import <path> --out <dir>`.
```

`index.md` and `log.md` are reserved OKF files rather than concepts. Validation rejects missing `type` metadata and malformed reserved files; broken links, missing indexes, and optional-field problems are warnings.

## Optional CLI Install

You do not need global install for MCP configs. `npx -y okfy-ai ...` lets an MCP client launch OKFy directly.

```bash
npm install -g okfy-ai
okfy demo
```

`okfy-ai` is the npm package name. `okfy` is the installed CLI command. Requires Node.js 20+.

## Security Defaults

- Crawls respect `robots.txt` and stay same-origin by default.
- Page count, depth, response size, and concurrency are capped.
- Private network URL literals and redirects to private targets are rejected by default.
- Preflight DNS-resolved private targets are rejected before fetch; fetch-time DNS is not IP-pinned.
- `--force` rejects unsafe output directories unless an explicit dangerous override is provided.
- HTML and Markdown are treated as text; scripts are not executed.
- MCP tools are read-only.

## Commands

```text
okfy init <name> <url>
okfy doctor <name> [more-names...]
okfy add <name> <url>
okfy sources
okfy check <name-or-bundle>
okfy update <name>
okfy remove <name> --yes
okfy crawl <url> --out <dir>
okfy import <path> --out <dir>
okfy validate <bundle>
okfy inspect <bundle>
okfy activate <name-or-bundle> [more-source-names...] --client codex --out okfy-activation
okfy map <name-or-bundle> [more-source-names...] --out okfy-inspector.html
okfy serve <name-or-bundle> [more-source-names...] --mcp
okfy demo
```

## Current Limits

- One source page or file becomes one concept; heading-based splitting is not implemented.
- HTML cleanup quality varies by documentation site.
- Website registration is the auto-refresh path; local imports are explicit snapshots.
- MCP support is stdio-first.
- Search is deterministic lexical search, not embeddings.
- GitHub repository URLs do not have a dedicated importer; use a local checkout or docs folder.

## Development

```bash
git clone https://github.com/0dust/OKFy.git
cd OKFy
pnpm install
pnpm build
pnpm demo
```

Before a pull request, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm demo`.

Examples live in [examples/](examples/), including the offline bundle used by `okfy demo`.

## License

MIT. See [LICENSE](LICENSE).
