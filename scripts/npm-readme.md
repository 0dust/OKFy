# okfy-ai

Turn docs into agent-readable Open Knowledge Format bundles.

## Install

Run without installing:

```bash
npx -y okfy-ai demo
```

Or install globally:

```bash
npm install -g okfy-ai
okfy demo
```

`okfy-ai` is the npm package name. `okfy` is the installed CLI command.

Requires Node.js 20+.

## Quick Start

Convert a docs site into an OKF bundle:

```bash
okfy crawl https://docs.stripe.com/checkout --out ./stripe-checkout-okf --max-pages 25
okfy validate ./stripe-checkout-okf
okfy inspect ./stripe-checkout-okf
```

Without installing, replace `okfy` with `npx -y okfy-ai`.

Serve it to an MCP client:

```bash
okfy serve ./stripe-checkout-okf --mcp
```

## Local Markdown

```bash
okfy import ./docs --out ./docs-okf --source-name "Project docs" --force
okfy validate ./docs-okf
okfy serve ./docs-okf --mcp
```

## MCP Config

```json
{
  "mcpServers": {
    "docs-okf": {
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "./docs-okf", "--mcp"]
    }
  }
}
```

This `npx -y okfy-ai` form is normal for MCP configs because the client can launch okfy without a global install. If you installed globally, this equivalent config also works:

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

Ask your agent:

```text
Use the docs-okf MCP server. Search for the relevant topic, read the best matching concepts, inspect neighbors if needed, and answer with source URLs.
```

## CLI Commands

```bash
okfy crawl <url> --out <dir>
okfy import <path> --out <dir>
okfy validate <bundle>
okfy inspect <bundle>
okfy serve <bundle> --mcp
okfy demo
```

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `bundle_summary` | Show bundle stats and validation status. |
| `search_concepts` | Search concept previews by query, type, or tags. |
| `read_concept` | Read one concept body, frontmatter, links, backlinks, and source. |
| `get_neighbors` | Traverse outbound links and backlinks around a concept. |
| `list_types` | List concept types and counts. |
| `list_tags` | List tags and counts. |

## What okfy Generates

```text
docs site or Markdown folder
  -> OKF bundle: Markdown files + YAML frontmatter + links
  -> MCP server: search_concepts, read_concept, get_neighbors
  -> source-backed agent answers
```

Each source page or Markdown file becomes one OKF concept in v0.1. Generated bundles are plain files, so they can be opened, reviewed, diffed, committed, and served locally.

## Security Defaults

- Crawls respect `robots.txt` by default.
- Crawls stay same-origin by default.
- Page count, depth, response size, and concurrency are capped.
- Private network targets are rejected by default for URL crawls.
- HTML and Markdown are treated as text. Scripts are not executed.
- MCP tools are read-only in v0.1.

## Links

- GitHub: https://github.com/0dust/OKFy
- MCP client setup: https://github.com/0dust/OKFy/blob/main/docs/mcp-clients.md
- OKF: https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf

## License

MIT.
