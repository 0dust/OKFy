# Examples

## Preview With Inspector

Preview what your agent will know from any registered source or local OKF bundle:

```bash
npx -y okfy-ai map stripe --out okfy-inspector.html
npx -y okfy-ai map examples/bundles/okfy-docs --out okfy-inspector.html
```

The Inspector is local static HTML for checking readiness, source freshness, citation URLs, concept relationships, and the MCP sequence before asking an agent to use the bundle.

## bundles/okfy-docs

Purpose: committed offline OKF bundle used by `okfy demo`.

Source command:

```bash
npx -y okfy-ai import examples/local-markdown --out /tmp/okfy-docs --source-name "okfy docs" --force --stable-timestamps
npx -y okfy-ai validate /tmp/okfy-docs
```

Expected concept count:

```text
6
```

Expected validation status:

```text
valid
```

Suggested agent questions:

- Search for crawler security defaults, read the relevant concepts, and cite the source resource.
- Read the MCP setup concept and explain the stdio config.
- Find importer concepts and list supported input formats.

## bundles/stripe-checkout-small

Purpose: small curated Stripe Checkout sample for launch demos when live crawling is flaky. The generated OKF bundle is committed so package users can inspect it without the repo-only source fixture.

Try it:

```bash
npx -y okfy-ai validate examples/bundles/stripe-checkout-small
npx -y okfy-ai map examples/bundles/stripe-checkout-small --out stripe-inspector.html
```

Expected concept count:

```text
4
```

Expected validation status:

```text
valid
```

Suggested agent questions:

- Search for Checkout Sessions, read the strongest match, and explain required server parameters.
- Find webhook-related concepts and summarize fulfillment safety notes.
- Use neighbors to move from the quickstart to the API reference and webhook concepts.

## local-markdown

Purpose: deterministic offline input for `okfy import`.

Source command:

```bash
okfy import ./examples/local-markdown --out ./tmp/okfy-docs --force --stable-timestamps
```

Expected concept count:

```text
6
```

Expected validation status:

```text
valid
```

Validate:

```bash
okfy validate ./tmp/okfy-docs
okfy inspect ./tmp/okfy-docs
okfy map ./tmp/okfy-docs --out okfy-inspector.html
```

Serve through MCP:

```bash
okfy serve ./tmp/okfy-docs --mcp
```

Suggested agent questions:

- Search for import workflow concepts, read the best match, and explain how to convert a local Markdown folder into OKF.
- Find concepts tagged `mcp`, read the MCP tools concept, and describe the expected tool-call sequence.
- Read the bundle summary, then identify which concepts are most useful for a first-time okfy user.
