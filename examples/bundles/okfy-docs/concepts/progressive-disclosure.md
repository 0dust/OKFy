---
type: "Documentation Page"
title: "Progressive Disclosure"
description: "Progressive disclosure means an agent starts with small previews and only loads full concept content when needed. For okfy, the default pattern is: This keeps prompt context smalle"
resource: "concepts/progressive-disclosure.md"
tags:
  - "concepts"
  - "progressive"
  - "disclosure"
timestamp: "2026-06-14T00:00:00.000Z"
---
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
