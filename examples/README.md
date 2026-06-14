# Examples

## bundles/okfy-docs

Purpose: committed offline OKF bundle used by `okfy demo`.

Source command:

```bash
pnpm okfy import examples/local-markdown --out examples/bundles/okfy-docs --source-name "okfy docs" --force --stable-timestamps
```

Expected concept count:

```text
9
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

Purpose: small curated Stripe Checkout sample for launch demos when live crawling is flaky.

Source command:

```bash
pnpm okfy import test-fixtures/stripe-checkout-html --out examples/bundles/stripe-checkout-small --source-name "Stripe Checkout sample" --force --stable-timestamps
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
npx -y okfy-ai import ./examples/local-markdown --out ./tmp/okfy-docs --force --stable-timestamps
```

Expected concept count:

```text
9
```

Expected validation status:

```text
valid
```

Validate:

```bash
npx -y okfy-ai validate ./tmp/okfy-docs
npx -y okfy-ai inspect ./tmp/okfy-docs
```

Serve through MCP:

```bash
npx -y okfy-ai serve ./tmp/okfy-docs --mcp
```

Suggested agent questions:

- Search for import workflow concepts, read the best match, and explain how to convert a local Markdown folder into OKF.
- Find concepts tagged `mcp`, read the MCP tools concept, and describe the expected tool-call sequence.
- Read the bundle summary, then identify which concepts are most useful for a first-time okfy user.
