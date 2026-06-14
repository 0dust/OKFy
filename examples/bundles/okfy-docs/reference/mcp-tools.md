---
type: "API Reference"
title: "MCP Tools"
description: "okfy exposes these readonly MCP tools: | Tool | Purpose | | | | | searchconcepts | Find concept previews by query, type, or tags. | | readconcept | Read one concept body, frontmatt"
resource: "reference/mcp-tools.md"
tags:
  - "reference"
  - "mcp"
  - "tools"
timestamp: "2026-06-14T00:00:00.000Z"
---
# MCP Tools

okfy exposes these read-only MCP tools:

| Tool | Purpose |
| --- | --- |
| `search_concepts` | Find concept previews by query, type, or tags. |
| `read_concept` | Read one concept body, frontmatter, links, backlinks, and source resource. |
| `get_neighbors` | Traverse outbound links and backlinks around a concept. |
| `list_types` | Show concept types and counts. |
| `list_tags` | Show tags and counts. |
| `bundle_summary` | Show bundle title, concept count, type distribution, connected concepts, and validation status. |

Expected question-answer flow:

```text
bundle_summary
search_concepts
read_concept
get_neighbors
read_concept
answer with citations
```

Related: [Progressive Disclosure](../concepts/progressive-disclosure.md).
