# Releasing

okfy publishes `okfy-ai` to npm manually. Do not use or add GitHub Actions release automation for npm publishing unless the project explicitly adopts that later.

For the step-by-step npm release procedure, use [Manual npm Publishing](./npm-publishing.md).

## Normal Flow

1. Merge changes to `main` using Conventional Commit prefixes such as `fix:`, `feat:`, and `docs:`.
2. Bump the release surfaces on the release branch before publishing:
   - `package.json`
   - `.release-please-manifest.json`
   - `scripts/npm-readme.md` when npm-facing docs changed
3. Publish manually with `pnpm publish:npm` from a clean checkout of latest `main`.
4. Verify the registry and fresh `npx` installs.

## Publish Helper

The local `pnpm publish:npm` script calls `scripts/publish-npm-readme.mjs`. That helper rebuilds, tests, typechecks, temporarily swaps in the npm README, publishes, and restores the GitHub README on exit.

The npm package page renders `scripts/npm-readme.md`, not the GitHub README.
