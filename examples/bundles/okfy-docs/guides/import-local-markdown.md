---
type: "Documentation Page"
title: "Import Local Markdown"
description: "Import Markdown, MDX, and Obsidian vault notes through the same local command while preserving portable metadata and relationships."
resource: "guides/import-local-markdown.md"
tags:
  - "guides"
  - "import"
  - "local"
timestamp: "2026-06-14T00:00:00.000Z"
---
# Import Local Markdown

Use `okfy import` for local Markdown, MDX, static-site sources, or Obsidian vaults. The same command recognizes Obsidian knowledge semantics automatically, with no extra flags needed.

```bash
okfy import ./examples/local-markdown --out ./tmp/okfy-docs --force
okfy validate ./tmp/okfy-docs
```

Expected result:

```text
Concepts: 6
Validation: valid
Broken links: 0
```

The importer preserves headings, code blocks, and Markdown links. It infers tags from paths and headings, then writes one OKF concept per supported text file.

## Obsidian Knowledge Semantics

Obsidian knowledge semantics are recognized automatically. Use the same `okfy import` command with no new flags and without installing or running Obsidian:

```bash
okfy import ./my-vault --out ./tmp/vault-okf --force
```

For Markdown and MDX notes, okfy:

- uses valid source `title`, `description`, and `type` properties, and uses `aliases` when resolving note identity
- merges source and inline tags with inferred tags, while ignoring tag-like text in code, HTML, and MDX expressions
- retains other safe YAML properties but owns the generated `resource` and `timestamp`
- removes the source YAML block and writes one canonical OKF frontmatter block
- converts uniquely resolved wikilinks—including aliases, slugged heading targets, and portable block anchors—into relative Markdown links
- turns resolved note embeds into relationship links without copying the embedded note's content
- leaves recognized image, audio, video, and PDF attachment embeds readable without creating concepts or attempting to parse the attachment

Missing and ambiguous targets are never guessed. Their original Obsidian references remain readable and surface `unresolved_wikilink` or `ambiguous_wikilink` warnings. Missing headings and block IDs surface `missing_wikilink_fragment`. Warnings do not fail the import or make an otherwise valid bundle invalid; inspect them with `okfy validate`, Inspector, or `bundle_summary`.

This is knowledge-semantic conversion, not full Obsidian rendering or sync. Canvas, Bases, PDFs, images, audio, video, callouts, highlights, comments, tasks, Dataview fields, presentation-only embed dimensions, writes back to the vault, embedded-note transclusion, and semantic/vector search are outside the supported scope.

Next: [Serve Over MCP](./serve-over-mcp.md).
