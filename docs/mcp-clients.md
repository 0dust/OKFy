# MCP Client Setup

okfy is meant to be launched by your agent as a local stdio MCP server. The default setup uses `npx -y okfy-ai`, so Claude, Codex, Cursor, or another MCP client can run okfy without a global install:

```bash
npx -y okfy-ai add stripe https://docs.stripe.com/checkout --max-pages 100 --max-depth 4
npx -y okfy-ai serve stripe --mcp --auto-refresh
```

MCP stdio means the client starts okfy as a local subprocess, sends JSON-RPC on stdin, and reads JSON-RPC responses on stdout. okfy logs and refresh progress belong on stderr so the MCP protocol stays clean.

## Registered Source Workflow

Use registered sources for third-party docs sites that should stay fresh over time:

```bash
npx -y okfy-ai add stripe https://docs.stripe.com/checkout --max-pages 100 --max-depth 4
npx -y okfy-ai sources
npx -y okfy-ai check stripe
npx -y okfy-ai update stripe
npx -y okfy-ai remove stripe
npx -y okfy-ai serve stripe --mcp --auto-refresh
```

By default, okfy stores sources in `~/.okfy`. Override that with `OKFY_HOME` when you want CI isolation, a project-local cache, or a disposable test home:

```text
$OKFY_HOME/
  sources/
    stripe/
      source.json
      state.json
      bundle/
        index.md
        ...
```

`source.json` stores the seed URL, crawl options, refresh policy, and bundle location. `state.json` stores freshness status, last successful refresh time, validation summary, refresh-in-progress state, and the latest refresh error if one exists.

This is local-first. There is no OKFY cloud registry, account, central cache, hosted ranking, or cloud refresh worker. Refreshes run on your machine by rerunning the stored crawl configuration.

Default refresh mode is `stale-while-refresh`: if the cached bundle is stale, MCP tools keep serving the current bundle while okfy refreshes in the background. Use blocking mode when you want stale sources refreshed before search/read/list tool calls answer:

```bash
npx -y okfy-ai serve stripe --mcp --auto-refresh --refresh-mode blocking
```

Use `--refresh-mode off` when MCP serving should never trigger network fetches. You can still refresh explicitly with `npx -y okfy-ai update stripe`.

## Existing Bundle Paths

The existing crawl/import workflow still works for one-off snapshots and project-local bundles:

```bash
npx -y okfy-ai crawl https://docs.stripe.com/checkout --out ./stripe-checkout-okf --max-pages 25
npx -y okfy-ai validate ./stripe-checkout-okf
npx -y okfy-ai serve ./stripe-checkout-okf --mcp
```

Local Markdown import still works too:

```bash
npx -y okfy-ai import ./docs --out ./docs-okf --source-name "Project docs" --force
npx -y okfy-ai validate ./docs-okf
npx -y okfy-ai serve ./docs-okf --mcp
```

Direct bundle paths do not use source auto-refresh. Use `add` plus `serve <source> --mcp --auto-refresh` when you want okfy to track freshness for a website source.

## Claude Code

Add a registered source as a local stdio server:

```bash
claude mcp add --transport stdio stripe-okf -- npx -y okfy-ai serve stripe --mcp --auto-refresh
claude mcp list
```

Open Claude Code and check status:

```text
/mcp
```

Project-scoped config, saved as `.mcp.json` at project root:

```json
{
  "mcpServers": {
    "stripe-okf": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh"]
    }
  }
}
```

Use `OKFY_HOME` in the server env when the source cache is not in the default `~/.okfy`:

```json
{
  "mcpServers": {
    "stripe-okf": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh"],
      "env": {
        "OKFY_HOME": "/absolute/path/to/.okfy"
      }
    }
  }
}
```

Example prompt:

```text
Use the stripe-okf MCP server. Search for Checkout Sessions, read the most relevant concepts, inspect neighbors if needed, and explain the minimum backend flow with source URLs.
```

Expected tool-call sequence:

```text
ToolSearch or MCP server discovery
bundle_summary
search_concepts({ "query": "Checkout Sessions", "limit": 5 })
read_concept({ "id": "<best-result-id>" })
get_neighbors({ "id": "<best-result-id>", "depth": 1 })
final answer with cited resource fields
```

Troubleshooting:

- `spawn npx ENOENT`: install Node.js >=20 and ensure `npx` is on `PATH`.
- Server pending: run `/mcp`; approve project-scoped `.mcp.json` if prompted.
- Unknown source name: run `npx -y okfy-ai sources` and confirm the source exists in the same `OKFY_HOME`.
- Stale source: run `npx -y okfy-ai check stripe`; use `update stripe` for an immediate refresh.
- Output too large: lower `--max-result-chars`, or ask the agent to search before reading concepts.
- Already installed globally: use `"command": "okfy"` and args `["serve", "stripe", "--mcp", "--auto-refresh"]`.

## Claude Desktop Or Cursor

Claude Desktop and Cursor use MCP server JSON. Add this entry to `claude_desktop_config.json`, `.cursor/mcp.json`, or any client that accepts `mcpServers` JSON:

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

Exact command represented by the config:

```bash
npx -y okfy-ai serve stripe --mcp --auto-refresh
```

Blocking refresh variant:

```json
{
  "mcpServers": {
    "stripe-okf": {
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh", "--refresh-mode", "blocking"]
    }
  }
}
```

Restart the client after editing config.

Example prompt:

```text
Use stripe-okf. Find concepts about MCP tools, read the relevant concept, then tell me which source URL supports the answer.
```

Troubleshooting:

- Desktop cannot find `npx`: replace `"command": "npx"` with the full path from `which npx`.
- Server exits immediately: run the exact command in a terminal and fix source or bundle validation errors.
- No okfy tools visible: restart the client after config changes.
- Source cache elsewhere: add `"env": { "OKFY_HOME": "/absolute/path/to/.okfy" }`.
- Already installed globally: use `"command": "okfy"` and args `["serve", "stripe", "--mcp", "--auto-refresh"]`.

## Codex

Codex supports stdio MCP servers through `config.toml`.

User config path:

```text
~/.codex/config.toml
```

Trusted project config path:

```text
.codex/config.toml
```

Add:

```toml
[mcp_servers.stripe_okf]
command = "npx"
args = ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

If you need a non-default source cache:

```toml
[mcp_servers.stripe_okf]
command = "npx"
args = ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh"]
env = { OKFY_HOME = "/absolute/path/to/.okfy" }
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Exact command represented by the config:

```bash
npx -y okfy-ai serve stripe --mcp --auto-refresh
```

CLI alternative:

```bash
codex mcp add stripe_okf -- npx -y okfy-ai serve stripe --mcp --auto-refresh
codex mcp --help
```

In Codex TUI, inspect active servers:

```text
/mcp
```

Example prompt:

```text
Use the stripe_okf MCP server. Search for the concept about progressive disclosure, read it, then explain how okfy keeps agent context small.
```

Expected tool-call sequence:

```text
MCP server initialization
bundle_summary
search_concepts({ "query": "progressive disclosure agent context" })
read_concept({ "id": "<best-result-id>", "max_chars": 6000 })
get_neighbors({ "id": "<best-result-id>", "depth": 1 })
final answer with citations
```

Troubleshooting:

- Config ignored: project `.codex/config.toml` loads only for trusted projects; use user config if unsure.
- Server startup timeout: increase `startup_timeout_sec` if first `npx` install or first source load is slow.
- Tool timeout: increase `tool_timeout_sec` for large bundles or blocking refresh mode.
- Source not found: check `OKFY_HOME` and run `npx -y okfy-ai sources`.
- Need current server list: run `/mcp` in TUI.
- Already installed globally: use `command = "okfy"` and `args = ["serve", "stripe", "--mcp", "--auto-refresh"]`.

## Generic MCP Stdio

Use this JSON for clients that accept Claude-style `mcpServers` config:

```json
{
  "mcpServers": {
    "stripe-okf": {
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh"],
      "env": {}
    }
  }
}
```

Exact command:

```bash
npx -y okfy-ai serve stripe --mcp --auto-refresh
```

For a direct bundle path instead of a registered source:

```json
{
  "mcpServers": {
    "docs-okf": {
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "./docs-okf", "--mcp"],
      "env": {}
    }
  }
}
```

Expected protocol flow:

```text
client starts subprocess
client sends initialize
server returns capabilities and instructions
client sends initialized
client calls tools/list
agent calls bundle_summary
agent calls search_concepts
agent calls read_concept
agent optionally calls get_neighbors
agent answers with resource citations
```

Example prompt:

```text
Use stripe-okf. Search for OKF bundle structure, read the most relevant concepts, and explain the generated files.
```

Troubleshooting:

- stdout has logs: okfy must write only MCP JSON-RPC messages to stdout; logs belong on stderr.
- Client cannot start process: use absolute `command` path, and set `OKFY_HOME` when using a non-default source cache.
- `tools/list` empty: confirm `okfy serve` was started with `--mcp`.
- Search returns weak matches: run `npx -y okfy-ai inspect <bundle>` for bundle paths or `npx -y okfy-ai check <source>` for registered sources.
- Agent reads too much: ask it to call `search_concepts` first and `read_concept` with `max_chars`.
- Already installed globally: use `"command": "okfy"` and args `["serve", "stripe", "--mcp", "--auto-refresh"]`.

## Available okfy MCP Tools

```text
search_concepts(query, type?, tags?, limit?)
read_concept(id, max_chars?)
get_neighbors(id, depth?)
list_types()
list_tags()
bundle_summary()
```

Recommended answering pattern:

```text
1. Start with bundle_summary for scope, validation, and freshness metadata.
2. Use search_concepts for discovery.
3. Read only top matching concepts.
4. Use get_neighbors when relationship context matters.
5. Cite resource fields from read_concept output.
```
