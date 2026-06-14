<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.png">
    <img src="assets/logo-light.png" alt="okfy logo: hand-drawn OKFY knowledge blocks" width="520">
  </picture>

  <p><strong>Open Knowledge Format for AI agents.</strong></p>

  <p>Turn docs into agent-readable knowledge bundles.</p>

  <p>
    OKF bundles | MCP server | local-first | no LLM key | Git-diffable context
  </p>

  <p>
    <a href="https://www.npmjs.com/package/okfy-ai"><img alt="npm package okfy-ai 0.1.3" src="https://img.shields.io/badge/npm-okfy--ai%400.1.3-2f7d5b?logo=npm"></a>
    <a href="https://github.com/0dust/OKFy/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/0dust/OKFy/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://github.com/0dust/OKFy/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-3f3a36"></a>
    <img alt="Node 20 plus" src="https://img.shields.io/badge/node-20%2B-4b5563">
    <img alt="MCP stdio" src="https://img.shields.io/badge/MCP-stdio-5f5a4f">
  </p>

  <p>
    <a href="#use-with-agents">Use with agents</a> |
    <a href="#create-a-bundle">Create a bundle</a> |
    <a href="#optional-cli-install">CLI install</a> |
    <a href="#why-okf">Why OKF</a> |
    <a href="docs/mcp-clients.md">More clients</a>
  </p>
</div>

---

Agents are bad at reading docs when the only options are "paste everything" or "trust a hidden vector index".

`okfy` converts documentation websites and local Markdown folders into [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundles: typed Markdown files with frontmatter, source URLs, internal links, backlinks, and a read-only MCP server.

Use it when you want Claude, Codex, Cursor, or another MCP-capable agent to search your docs, read only the relevant pages, traverse neighbors, and cite sources without dumping the whole docs site into context.

![okfy terminal demo](assets/demo.gif)

## Use With Agents

okfy is meant to sit behind your coding agent as a local MCP server. You create an OKF bundle once, then Claude, Codex, Cursor, or any MCP client can search and read that bundle on demand.

Create a bundle from a docs site:

```bash
npx -y okfy-ai crawl https://docs.stripe.com/checkout --out ./stripe-checkout-okf --max-pages 25
npx -y okfy-ai validate ./stripe-checkout-okf
```

Then connect it to your agent.

### Claude Code

```bash
claude mcp add --transport stdio stripe-okf -- npx -y okfy-ai serve ./stripe-checkout-okf --mcp
```

### Claude Desktop Or Cursor

Add this to `claude_desktop_config.json`, `.cursor/mcp.json`, or any client that accepts `mcpServers` JSON:

```json
{
  "mcpServers": {
    "stripe-okf": {
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "./stripe-checkout-okf", "--mcp"]
    }
  }
}
```

### Codex

Add this to `~/.codex/config.toml` or a trusted project config:

```toml
[mcp_servers.stripe_okf]
command = "npx"
args = ["-y", "okfy-ai", "serve", "./stripe-checkout-okf", "--mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Now ask:

```text
Use the stripe-okf MCP server. Search for Checkout Sessions, read the most relevant concepts, inspect neighbors if needed, and explain the minimum backend flow with source URLs.
```

More setup details: [docs/mcp-clients.md](docs/mcp-clients.md).

## Create A Bundle

Docs website:

```bash
npx -y okfy-ai crawl https://docs.stripe.com/checkout --out ./stripe-checkout-okf --max-pages 25
npx -y okfy-ai validate ./stripe-checkout-okf
npx -y okfy-ai inspect ./stripe-checkout-okf
```

Local Markdown:

```bash
npx -y okfy-ai import ./docs --out ./docs-okf --source-name "Project docs" --force
npx -y okfy-ai validate ./docs-okf
```

The MCP command always serves an existing bundle:

```bash
npx -y okfy-ai serve ./docs-okf --mcp
```

Do not run `serve --mcp` as a normal interactive terminal session. MCP clients start it as a subprocess and communicate over stdin/stdout.

## Optional CLI Install

You do not need global install for MCP configs. `npx -y okfy-ai ...` is usually better because the MCP client can launch okfy directly.

Install only if you want shorter local commands:

```bash
npm install -g okfy-ai
okfy demo
```

`okfy-ai` is the npm package name. `okfy` is the installed CLI command.

Package: [okfy-ai on npm](https://www.npmjs.com/package/okfy-ai)

Requires Node.js 20+.

After installing, this MCP config is equivalent:

```json
{
  "mcpServers": {
    "docs-okf": {
      "command": "okfy",
      "args": ["serve", "./docs-okf", "--mcp"]
    }
  }
}
```

## Demo

```bash
npx -y okfy-ai demo
```

The offline demo validates the bundled OKF fixture and prints a ready MCP config.

Expected shape:

```text
OKF bundle valid
Concepts: 9
Links: 15
Broken links: 0
MCP config:
```

## What You Get

```text
docs site or Markdown folder
  -> OKF bundle: Markdown files + YAML frontmatter + links
  -> MCP server: search_concepts, read_concept, get_neighbors
  -> source-backed agent answers
```

| Output | Why it matters |
| --- | --- |
| Plain Markdown concepts | Humans can read, review, diff, and commit the knowledge. |
| OKF frontmatter | Agents get type, title, description, tags, source, and timestamp. |
| Links and backlinks | Agents can traverse related docs instead of reading everything. |
| MCP stdio server | Local clients can search and read the bundle with no hosted index. |
| Deterministic validation | Broken links and malformed bundles fail before agents use them. |

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `bundle_summary` | Show bundle stats and validation status. |
| `search_concepts` | Search concept previews by query, type, or tags. |
| `read_concept` | Read one concept body, frontmatter, links, backlinks, and source. |
| `get_neighbors` | Traverse outbound links and backlinks around a concept. |
| `list_types` | List concept types and counts. |
| `list_tags` | List tags and counts. |

The server is read-only in v0.1. `okfy serve --mcp` writes MCP JSON-RPC to stdout, so launch it through an MCP client rather than as a normal terminal command.

## Bundle Format

```md
---
type: "Guide"
title: "Import Local Markdown"
description: "Convert a local Markdown folder into an OKF bundle."
resource: "guides/import-local-markdown.md"
tags:
  - "okfy"
  - "import"
timestamp: "2026-06-14T00:00:00.000Z"
---

# Import Local Markdown

Run `okfy import <path> --out <dir>`.
```

Each source page or file becomes one concept in v0.1. Folder indexes are generated so humans and agents can navigate the bundle.

## Why OKF

Most RAG systems hide knowledge inside an index. That can work, but it is hard to inspect, review, or ship with a repo.

OKF keeps knowledge as typed, linked Markdown files:

- humans can read it
- Git can diff it
- agents can search, read, and traverse it through MCP
- teams can keep source URLs and provenance visible

`llms.txt` is a useful entry point. OKF is a fuller bundle: one concept per file, typed frontmatter, internal links, backlinks, and progressive disclosure for agents.

## Security Defaults

- Crawls respect `robots.txt` by default.
- Crawls stay same-origin by default.
- Page count, depth, response size, and concurrency are capped.
- Private network targets are rejected by default for URL crawls.
- HTML and Markdown are treated as text. Scripts are not executed.
- MCP tools are read-only in v0.1.

## Commands

```bash
okfy crawl <url> --out <dir>
okfy import <path> --out <dir>
okfy validate <bundle>
okfy inspect <bundle>
okfy serve <bundle> --mcp
okfy demo
```

Common options:

```bash
okfy crawl https://docs.example.com --out ./docs-okf --max-pages 100 --max-depth 4
okfy import ./docs --out ./docs-okf --source-name "Project docs" --force
okfy validate ./docs-okf --json
okfy serve ./docs-okf --mcp --max-result-chars 12000
```

## Examples

- [examples/local-markdown](examples/local-markdown): offline input fixture.
- [examples/bundles/okfy-docs](examples/bundles/okfy-docs): committed OKF bundle used by `okfy demo`.
- [examples/bundles/stripe-checkout-small](examples/bundles/stripe-checkout-small): small saved Stripe Checkout sample.
- [examples/README.md](examples/README.md): commands, expected counts, validation status, and suggested agent questions.

## Run From Source

Use this path when developing okfy itself:

```bash
git clone https://github.com/0dust/OKFy.git
cd OKFy
pnpm install
pnpm build
pnpm demo
```

Before sending a PR:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm demo
```

Keep generated OKF output deterministic so bundle diffs stay reviewable.

## Current Limits

- No GitHub repo URL importer yet. Use a local checkout or docs folder.
- One source page or file becomes one concept.
- HTML cleanup quality varies by docs site.
- MCP support is stdio-first.
- Search is deterministic lexical search, not embeddings.

## Roadmap

- GitHub repo import.
- Docusaurus, Mintlify, and MkDocs adapters.
- Heading-based concept splitting for long pages.
- Optional LLM enrichment for better descriptions and tags.
- More real-world example bundles.

## License

MIT. See [LICENSE](LICENSE).
