# Contributing to okfy

okfy turns docs sites, local knowledge folders, and Markdown vaults into Open Knowledge Format bundles, then serves those bundles as queryable MCP memory.

## Ways to Contribute

- Add or improve importers for docs platforms, static site generators, or local knowledge formats.
- Improve deterministic OKF generation, validation, search, graph traversal, or MCP behavior.
- Add fixtures for real docs sites that are public, crawlable, and useful for agent memory demos.
- Improve documentation that helps users run `okfy crawl`, `okfy import`, `okfy validate`, and `okfy serve`.

## Development Setup

okfy targets Node.js 20 or newer, ESM, TypeScript, and pnpm.

```bash
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
```

Run the full command set before opening a pull request. Keep CLI output deterministic when possible so generated OKF bundles are reviewable in Git.

## Design Principles

- Deterministic by default: no required LLM key, no hidden network calls during validation, stable filenames, stable YAML key ordering.
- Respect sources: keep source URLs or file paths in generated concepts, respect robots.txt by default for web crawling, and avoid full web-scale crawling.
- Keep context small: MCP tools should let agents search, preview, read, and traverse concepts on demand instead of loading entire bundles.
- Prefer portable OKF: avoid project-specific extensions that make bundles harder for other OKF consumers to read.
- Make failures actionable: validation and crawler errors should explain the exact file, URL, or link that needs attention.

## Issues

Use the issue templates:

- Bug report: broken behavior, incorrect output, failed validation, bad MCP response, or regression.
- Feature request: new command behavior, validation rule, graph/search improvement, or integration.
- Importer request: support for a new docs platform, file format, folder layout, or knowledge source.

For importer requests, include one public sample source and the shape of the OKF bundle you expect.

## Pull Requests

Good pull requests are small, reproducible, and test-backed. Include:

- What changed and why.
- Commands run locally.
- User-visible behavior before and after.
- Relevant fixture links, source URLs, or sample bundles.

When changing generated output, include focused fixture updates and explain why the diff is expected.

## Dependencies

Add dependencies only when they clearly improve correctness, portability, or maintainability. Keep the CLI fast to install and usable through `npx -y okfy-ai`.

## Security and Responsible Crawling

Do not add behavior that bypasses robots.txt, authentication, paywalls, rate limits, or access controls. Do not commit private docs, credentials, tokens, cookies, or proprietary knowledge bundles.

Report security concerns privately through the repository security contact when available. If a private channel is unavailable, open a minimal public issue that avoids exploit details and ask a maintainer to establish a private channel.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
