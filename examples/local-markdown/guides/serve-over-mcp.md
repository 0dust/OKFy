# Serve Over MCP

After generating an OKF bundle, serve it over stdio MCP:

```bash
npx -y okfy-ai serve ./tmp/okfy-docs --mcp
```

Agents should not read the whole bundle first. The efficient flow is:

```text
bundle_summary -> search_concepts -> read_concept -> get_neighbors -> answer
```

Use `search_concepts` for discovery, `read_concept` for grounded detail, and `get_neighbors` when linked concepts may change the answer.

See [MCP tools](../reference/mcp-tools.md) for tool descriptions.
