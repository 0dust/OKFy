# MCP Client Setup

okfy exposes OKF bundles through a local stdio MCP server:

```bash
okfy serve ./tmp/okfy-docs --mcp
```

Shell examples assume `npm install -g okfy-ai`, then the `okfy` CLI command.

MCP config examples use `npx -y okfy-ai` by default. That is normal for stdio MCP servers because the MCP client can launch the npm package without requiring a global install.

Use stdio for local bundles. MCP stdio means the client launches a local command as a subprocess, sends JSON-RPC messages on stdin, and reads JSON-RPC responses on stdout. okfy logs should go to stderr.

## Prepare a Bundle

Offline fixture:

```bash
okfy import ./examples/local-markdown --out ./tmp/okfy-docs --force
okfy validate ./tmp/okfy-docs
okfy inspect ./tmp/okfy-docs
```

Expected output:

```text
Concepts: 9
Validation: valid
Broken links: 0
```

Docs-site crawl:

```bash
okfy crawl https://docs.stripe.com/checkout --out ./stripe-checkout-okf --max-pages 25
okfy validate ./stripe-checkout-okf
okfy serve ./stripe-checkout-okf --mcp
```

## Claude Code

Add okfy as a local stdio server:

```bash
claude mcp add --transport stdio okfy-docs -- okfy serve ./tmp/okfy-docs --mcp
claude mcp list
```

No-install equivalent:

```bash
claude mcp add --transport stdio okfy-docs -- npx -y okfy-ai serve ./tmp/okfy-docs --mcp
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
    "okfy-docs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "./tmp/okfy-docs", "--mcp"]
    }
  }
}
```

Example prompt:

```text
Use the okfy-docs MCP server. Search for local Markdown import, read the best matching concept, inspect its neighbors, then explain the workflow with citations.
```

Expected tool-call sequence:

```text
ToolSearch or MCP server discovery
bundle_summary
search_concepts({ "query": "local Markdown import", "limit": 5 })
read_concept({ "id": "<best-result-id>" })
get_neighbors({ "id": "<best-result-id>", "depth": 1 })
read_concept({ "id": "<neighbor-id>", "max_chars": 4000 })
final answer with cited resource fields
```

Troubleshooting:

- `spawn npx ENOENT`: install Node.js >=20 and ensure `npx` is on `PATH`.
- Server pending: run `/mcp`; approve project-scoped `.mcp.json` if prompted.
- Empty tools: run `okfy validate ./tmp/okfy-docs`; invalid bundles should fail before serving.
- Output too large: lower `--max-result-chars`, or ask the agent to search before reading concepts.
- Wrong bundle path: use an absolute path in config if client starts from another working directory.
- Already installed globally: use `"command": "okfy"` and args `["serve", "./tmp/okfy-docs", "--mcp"]`.

## Claude Desktop

Claude Desktop uses MCP server JSON. Add this entry to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "okfy-docs": {
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "/absolute/path/to/okfy/tmp/okfy-docs", "--mcp"]
    }
  }
}
```

Exact command represented by the config:

```bash
npx -y okfy-ai serve /absolute/path/to/okfy/tmp/okfy-docs --mcp
```

Restart Claude Desktop after editing config.

Example prompt:

```text
Use okfy-docs. Find concepts about MCP tools, read the relevant concept, then tell me which tool to call first when answering a docs question.
```

Expected tool-call sequence:

```text
bundle_summary
search_concepts({ "query": "MCP tools" })
read_concept({ "id": "<mcp-tools-id>" })
answer with cited resource fields
```

Troubleshooting:

- Desktop cannot find `npx`: replace `"command": "npx"` with full path from `which npx`.
- Server exits immediately: run exact command in terminal and fix bundle validation errors.
- No okfy tools visible: restart Claude Desktop after config changes.
- Relative path fails: use absolute bundle path.
- Already installed globally: use `"command": "okfy"` and args `["serve", "/absolute/path/to/okfy/tmp/okfy-docs", "--mcp"]`.

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
[mcp_servers.okfy_docs]
command = "npx"
args = ["-y", "okfy-ai", "serve", "./tmp/okfy-docs", "--mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 60
enabled = true
```

Exact command represented by the config:

```bash
npx -y okfy-ai serve ./tmp/okfy-docs --mcp
```

CLI alternative:

```bash
codex mcp add okfy_docs -- okfy serve ./tmp/okfy-docs --mcp
codex mcp --help
```

No-install CLI alternative:

```bash
codex mcp add okfy_docs -- npx -y okfy-ai serve ./tmp/okfy-docs --mcp
codex mcp --help
```

In Codex TUI, inspect active servers:

```text
/mcp
```

Example prompt:

```text
Use the okfy_docs MCP server. Search for the concept about progressive disclosure, read it, then explain how okfy keeps agent context small.
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
- Server startup timeout: increase `startup_timeout_sec` if first `npx` install is slow.
- Tool timeout: increase `tool_timeout_sec` for large bundles.
- Relative path wrong: set `cwd` or use absolute bundle path.
- Need current server list: run `/mcp` in TUI.
- Already installed globally: use `command = "okfy"` and `args = ["serve", "./tmp/okfy-docs", "--mcp"]`.

## Generic MCP stdio

Use this JSON for clients that accept Claude-style `mcpServers` config:

```json
{
  "mcpServers": {
    "okfy-docs": {
      "command": "npx",
      "args": ["-y", "okfy-ai", "serve", "./tmp/okfy-docs", "--mcp"],
      "env": {}
    }
  }
}
```

Exact command:

```bash
npx -y okfy-ai serve ./tmp/okfy-docs --mcp
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
Use okfy-docs. Search for OKF bundle structure, read the most relevant concepts, and explain the generated files.
```

Troubleshooting:

- stdout has logs: okfy must write only MCP JSON-RPC messages to stdout; logs belong on stderr.
- Client cannot start process: use absolute `command` path and absolute bundle path.
- `tools/list` empty: confirm `okfy serve` was started with `--mcp`.
- Search returns weak matches: run `okfy inspect` and verify titles, descriptions, and tags were generated.
- Agent reads too much: ask it to call `search_concepts` first and `read_concept` with `max_chars`.
- Already installed globally: use `"command": "okfy"` and args `["serve", "./tmp/okfy-docs", "--mcp"]`.

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
1. Start with bundle_summary for scope.
2. Use search_concepts for discovery.
3. Read only top matching concepts.
4. Use get_neighbors when relationship context matters.
5. Cite resource fields from read_concept output.
```
