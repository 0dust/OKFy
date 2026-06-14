# Progressive Disclosure

Progressive disclosure means an agent starts with small previews and only loads full concept content when needed.

For okfy, the default pattern is:

```text
search_concepts returns bounded previews
read_concept returns one concept
get_neighbors returns linked context
```

This keeps prompt context smaller than pasting full docs or loading an entire Markdown folder.

Related: [Serve Over MCP](../guides/serve-over-mcp.md).
