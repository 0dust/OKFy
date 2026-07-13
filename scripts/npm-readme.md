# okfy-ai

Give coding agents searchable, source-linked documentation—locally.

OKFy converts documentation websites and Markdown folders into typed, linked Markdown bundles, then serves them to Claude, Codex, Cursor, and other MCP clients. Knowledge and source references stay inspectable and Git-diffable; no hosted index, embedding service, or LLM API key is required.

## Quickstart

Register documentation and generate client setup:

```bash
npx -y okfy-ai init stripe https://docs.stripe.com/checkout --client generic
```

`init` crawls the source into a local bundle, prints the MCP launch configuration, and gives you a first prompt. It does not edit client configuration.

Ask your agent:

```text
Using the Stripe documentation, explain the minimum Checkout Sessions
backend flow. Read the relevant concepts, follow related documentation
when needed, and include every source reference used.
```

The agent searches first, reads only the relevant concepts, follows linked documentation when necessary, and returns the original sources.

## Why OKFy

- Plain Markdown concepts that humans can inspect and Git can diff.
- Source URLs and provenance retained in retrieval results.
- Local, deterministic lexical search with no embedding API.
- Read-only MCP tools for progressive search, reading, and traversal.
- Registered website sources that can refresh when stale.
- Multi-source workspaces for a complete project stack.

## Connect An MCP Client

The registered source is served with:

```bash
npx -y okfy-ai serve stripe --mcp --auto-refresh
```

Claude Code:

```bash
claude mcp add --transport stdio stripe-okf -- npx -y okfy-ai serve stripe --mcp --auto-refresh
```

Codex:

```toml
[mcp_servers.stripe_okf]
command = "npx"
args = ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Claude Desktop, Cursor, and other `mcpServers` clients:

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

Full setup guidance: https://github.com/0dust/OKFy/blob/main/docs/mcp-clients.md

If setup fails:

```bash
npx -y okfy-ai doctor stripe --client codex
```

## Multi-Source Workspaces

Serve the documentation behind a project through one source-aware MCP server:

```bash
npx -y okfy-ai add stripe https://docs.stripe.com/checkout
npx -y okfy-ai add clerk https://clerk.com/docs
npx -y okfy-ai doctor stripe clerk --client codex
npx -y okfy-ai serve stripe clerk --mcp --auto-refresh
```

Project-local Markdown can join the same workflow:

```bash
npx -y okfy-ai import ./docs/api --out ./okf/api-docs --source-name "API docs"
npx -y okfy-ai import ./docs/product --out ./okf/product-docs --source-name "Product docs"
npx -y okfy-ai serve ./okf/api-docs ./okf/product-docs --mcp
```

Search and read tools accept a `source` filter when concepts overlap. `bundle_summary` reports workspace totals plus per-source validity, freshness, refresh progress, and errors.

## Keep Sources Fresh

Registered sources live under `~/.okfy`. The default `stale-while-refresh` mode serves the current valid bundle while stale documentation refreshes in the background.

```bash
npx -y okfy-ai sources
npx -y okfy-ai check stripe
npx -y okfy-ai update stripe
npx -y okfy-ai serve stripe --mcp --auto-refresh
```

Use `--refresh-mode blocking` to wait for refresh or `--refresh-mode off` to prevent network fetching while serving.

## Create Explicit Bundles

Website snapshot:

```bash
npx -y okfy-ai crawl https://docs.stripe.com/checkout --out ./stripe-checkout-okf --max-pages 25
npx -y okfy-ai validate ./stripe-checkout-okf
```

Local Markdown:

```bash
npx -y okfy-ai import ./docs --out ./docs-okf --source-name "Project docs"
npx -y okfy-ai validate ./docs-okf
npx -y okfy-ai serve ./docs-okf --mcp
```

MCP clients start `serve --mcp` as a subprocess; do not run it as a normal interactive terminal command.

Add `--force` only when you explicitly intend to replace an existing non-empty output bundle.

## MCP Tools

- `bundle_summary`: validity, size, and source freshness.
- `search_concepts`: concept previews by query, source, type, or tags.
- `read_concept`: body, metadata, links, backlinks, and source.
- `get_neighbors`: outbound links and backlinks around a concept.
- `list_types`: concept types and counts.
- `list_tags`: tags and counts.

MCP tools are read-only; refresh is server-side maintenance, not an agent-callable write tool.

Programmatic MCP integrations can use the stable public surface:

```ts
import { createMcpServer, type ServeOptions } from "okfy-ai/mcp";
```

Programmatic imports remain compatible with the `okfy-ai` root surface. New setup-only code can import pure artifact helpers from `okfy-ai/setup`.

## Inspect And Share

Create a local static HTML Inspector for relationships, warnings, freshness, and source URLs:

```bash
npx -y okfy-ai map stripe --out okfy-inspector.html
```

Use `--json` when CI or tests need the same Inspector report model without writing HTML.

Create a shareable setup snapshot when useful:

```bash
npx -y okfy-ai activate stripe --client codex --out okfy-activation
```

It contains `okfy-inspector.html`, `okfy-setup.md`, and `okfy-proof.json`. Activation does not write client config files by default. Preview what your agent will know before sharing or applying the generated setup.

## Optional CLI Install

You do not need global install for MCP configs. `npx -y okfy-ai ...` is normally enough.

```bash
npm install -g okfy-ai
okfy demo
```

`okfy-ai` is the npm package name. `okfy` is the installed CLI command. Node.js 20+ is required.

## Security Defaults

- Crawls respect `robots.txt` and stay same-origin by default.
- Page count, depth, response size, and concurrency are capped.
- Private network URL literals and redirects to private targets are rejected by default.
- Preflight DNS-resolved private targets are rejected before fetch; fetch-time DNS is not IP-pinned.
- Unsafe force-output directories are rejected unless explicitly overridden.
- HTML and Markdown are treated as text; scripts are not executed.
- MCP tools are read-only.

Project documentation, examples, commands, and limits: https://github.com/0dust/OKFy

License: MIT
