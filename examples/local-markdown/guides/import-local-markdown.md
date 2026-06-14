# Import Local Markdown

Use `okfy import` when docs already live in a local project checkout, wiki export, Obsidian vault, or static-site source folder.

```bash
npx -y okfy-ai import ./examples/local-markdown --out ./tmp/okfy-docs --force
npx -y okfy-ai validate ./tmp/okfy-docs
```

Expected result:

```text
Concepts: 6
Validation: valid
Broken links: 0
```

The importer preserves headings, code blocks, and Markdown links. It infers tags from paths and headings, then writes one OKF concept per input file.

Next: [Serve Over MCP](serve-over-mcp.md).
