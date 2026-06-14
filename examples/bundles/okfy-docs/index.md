# okfy docs

* [OKF Bundle Structure](concepts/okf-bundle.md) - An Open Knowledge Format bundle is a directory of Markdown files with YAML frontmatter. Minimum valid concept: Useful generated fields include title, description, resource, tags, a
* [Progressive Disclosure](concepts/progressive-disclosure.md) - Progressive disclosure means an agent starts with small previews and only loads full concept content when needed. For okfy, the default pattern is: This keeps prompt context smalle
* [Import Local Markdown](guides/import-local-markdown.md) - Use okfy import when docs already live in a local project checkout, wiki export, Obsidian vault, or staticsite source folder. Expected result: The importer preserves headings, code
* [Serve Over MCP](guides/serve-over-mcp.md) - After generating an OKF bundle, serve it over stdio MCP: Agents should not read the whole bundle first. The efficient flow is: Use searchconcepts for discovery, readconcept for gro
* [okfy Local Markdown Fixture](home.md) - This fixture models a small docs folder that can be imported into OKF without network access. Start with Import Local Markdown, then read Serve Over MCP. Key topics: OKF bundle str
* [MCP Tools](reference/mcp-tools.md) - okfy exposes these readonly MCP tools: | Tool | Purpose | | | | | searchconcepts | Find concept previews by query, type, or tags. | | readconcept | Read one concept body, frontmatt
