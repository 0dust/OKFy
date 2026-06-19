# okfy-ai

Turn docs into agent-readable Open Knowledge Format v0.1-conformant bundles, then serve them to Claude, Codex, Cursor, or any MCP client.

## Use With Agents

Create a registered source and print a client-ready setup preview:

```bash
npx -y okfy-ai init stripe https://docs.stripe.com/checkout --client generic --max-pages 100 --max-depth 4
```

`init` prints the MCP launch command, client config, and a first prompt. It does not write client config files by default. The generated launch command will look like `npx -y okfy-ai serve stripe --mcp --auto-refresh`.

The MCP server uses the cached local bundle immediately. When the source is stale, `--auto-refresh` refreshes it according to the source policy while exposing freshness metadata through `bundle_summary`.

Add the source-backed server to an MCP client:

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

Ask your agent:

```text
Use the stripe-okf MCP server. Search for Checkout Sessions, read the most relevant concepts, inspect neighbors if needed, and explain the minimum backend flow with source URLs.
```

## Client Setup

Claude Code:

```bash
npx -y okfy-ai init stripe https://docs.stripe.com/checkout --client claude-code
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

Claude Desktop, Cursor, and other `mcpServers` clients can use the JSON config above. More setup: https://github.com/0dust/OKFy/blob/main/docs/mcp-clients.md

If setup is not working, run:

```bash
npx -y okfy-ai doctor stripe --client codex
```

`doctor` checks the registered source, bundle validity, freshness, `npx` availability, generated command shape, MCP tool visibility, and JSON-RPC-clean stdout, then tells you the next repair command or config edit.

## Multi-Source Workspaces

Register several docs sources and expose them through one source-aware MCP server:

```bash
npx -y okfy-ai add stripe https://docs.stripe.com/checkout --max-pages 100 --max-depth 4
npx -y okfy-ai add clerk https://clerk.com/docs --max-pages 100 --max-depth 4
npx -y okfy-ai doctor stripe clerk --client codex
npx -y okfy-ai serve stripe clerk --mcp --auto-refresh
```

For project-local docs, import each Markdown folder into its own OKF bundle and serve the bundle paths together:

```bash
npx -y okfy-ai import ./docs/api --out ./okf/api-docs --source-name "API docs" --force
npx -y okfy-ai import ./docs/product --out ./okf/product-docs --source-name "Product docs" --force
npx -y okfy-ai serve ./okf/api-docs ./okf/product-docs --mcp
```

In local bundle workspaces, source filters use the bundle directory names, such as `api-docs` and `product-docs`.

Codex config for the registered-source workspace:

```toml
[mcp_servers.stripe_clerk_okf]
command = "npx"
args = ["-y", "okfy-ai", "serve", "stripe", "clerk", "--mcp", "--auto-refresh"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Workspace `bundle_summary` reports totals plus per-source validation, freshness, refresh progress, and refresh errors. Search and list tools accept a `source` filter, and duplicate concept ids can be read with `{ "source": "stripe", "id": "guides/quickstart" }`.

## Keep Sources Fresh

Registered sources are the local-first workflow for third-party docs sites that change over time:

```bash
npx -y okfy-ai add stripe https://docs.stripe.com/checkout --max-pages 100 --max-depth 4
npx -y okfy-ai sources
npx -y okfy-ai check stripe
npx -y okfy-ai doctor stripe
npx -y okfy-ai update stripe
npx -y okfy-ai remove stripe
npx -y okfy-ai serve stripe --mcp --auto-refresh
npx -y okfy-ai serve stripe clerk --mcp --auto-refresh
```

If you want registration plus client-specific setup artifacts, use `npx -y okfy-ai init stripe https://docs.stripe.com/checkout --client generic --max-pages 100 --max-depth 4`.

By default, okfy stores registered sources under `~/.okfy`. Set `OKFY_HOME` to use a different local cache for CI, tests, or per-project isolation.

Freshness is age-based. A registered bundle is fresh when it exists, validates, and was successfully refreshed within its configured max age. The default mode is `stale-while-refresh`: if the bundle is stale, MCP search and read tools keep serving the current cached bundle while a background refresh runs.

Use blocking mode when you want the server to refresh before answering tool calls:

```bash
npx -y okfy-ai serve stripe --mcp --auto-refresh --refresh-mode blocking
```

Use `--refresh-mode off` when MCP serving should never trigger network fetches; you can still run `npx -y okfy-ai update stripe` manually.

## Create Bundles

The original crawl/import path still works for one-off snapshots and project-local bundles.

Docs website snapshot:

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

Serve an existing bundle path when you already manage the bundle yourself:

```bash
npx -y okfy-ai serve ./docs-okf --mcp
```

Direct bundle paths, including local bundle workspaces, do not use source auto-refresh.

## Optional CLI Install

You do not need global install for MCP configs. `npx -y okfy-ai ...` is usually better because the MCP client can launch okfy directly.

Install only if you want shorter local commands:

```bash
npm install -g okfy-ai
okfy demo
```

`okfy-ai` is the npm package name. `okfy` is the installed CLI command.

Requires Node.js 20+.

After installing, this MCP config is equivalent:

```json
{
  "mcpServers": {
    "stripe-okf": {
      "command": "okfy",
      "args": ["serve", "stripe", "--mcp", "--auto-refresh"]
    }
  }
}
```

## Demo

```bash
npx -y okfy-ai demo
```

## No-Install MCP Config

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

## CLI Commands

```bash
okfy init <name> <url>
okfy doctor <name> [more-names...]
okfy add <name> <url>
okfy sources
okfy check <name-or-bundle>
okfy update <name>
okfy remove <name>
okfy crawl <url> --out <dir>
okfy import <path> --out <dir>
okfy validate <bundle>
okfy inspect <bundle>
okfy serve <name-or-bundle> [more-source-names...] --mcp
okfy demo
```

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `bundle_summary` | Show bundle or workspace stats, validation status, and source freshness when available. |
| `search_concepts` | Search concept previews by query, optional source, type, or tags. |
| `read_concept` | Read one concept body, frontmatter, links, backlinks, and source. |
| `get_neighbors` | Traverse outbound links and backlinks around a concept. |
| `list_types` | List concept types and counts, optionally filtered by workspace source. |
| `list_tags` | List tags and counts, optionally filtered by workspace source. |

## What okfy Generates

```text
registered docs source or Markdown folder
  -> local OKF bundle: Markdown files + YAML frontmatter + links
  -> MCP server: search_concepts, read_concept, get_neighbors
  -> source-backed agent answers
```

Each non-reserved source page or Markdown file becomes one OKF concept in v0.1. `index.md` and `log.md` are reserved files, not concepts, and generated indexes are plain Markdown. Concept counts, search, graph links, types, tags, and `read_concept` exclude reserved files.

Validation errors are limited to OKF conformance: malformed or missing concept frontmatter, missing `type`, or invalid reserved-file structure. Broken internal links and missing indexes are warnings.

## Security Defaults

- Crawls respect `robots.txt` by default.
- Crawls stay same-origin by default.
- Page count, depth, response size, and concurrency are capped.
- Private network URL literals and redirects to private targets are rejected by default for URL crawls.
- Preflight DNS-resolved private targets are rejected before fetch; fetch-time DNS is not IP-pinned.
- `--force` refuses unsafe output directories such as `.`, `/`, the home dir, repo root, input path, input parent, and symlink output dirs unless an explicit dangerous override is provided.
- HTML and Markdown are treated as text. Scripts are not executed.
- MCP tools are read-only in v0.1.

## Links

- GitHub: https://github.com/0dust/OKFy
- MCP client setup: https://github.com/0dust/OKFy/blob/main/docs/mcp-clients.md
- OKF: https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf

## License

MIT.
