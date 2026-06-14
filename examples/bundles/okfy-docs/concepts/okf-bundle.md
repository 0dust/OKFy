---
type: "Concept"
title: "OKF Bundle Structure"
description: "An Open Knowledge Format bundle is a directory of Markdown files with YAML frontmatter. Minimum valid concept: Useful generated fields include title, description, resource, tags, a"
resource: "concepts/okf-bundle.md"
tags:
  - "concepts"
  - "okf"
  - "bundle"
  - "structure"
  - "concept"
  - "title"
timestamp: "2026-06-14T00:00:00.000Z"
---
# OKF Bundle Structure

An Open Knowledge Format bundle is a directory of Markdown files with YAML frontmatter.

Minimum valid concept:

```md
---
type: Concept
---

# Concept title
```

Useful generated fields include `title`, `description`, `resource`, `tags`, and `timestamp`.

okfy keeps output file-based so humans can inspect it, Git can diff it, and MCP clients can read only the concepts they need.

Related: [Progressive Disclosure](./progressive-disclosure.md).
