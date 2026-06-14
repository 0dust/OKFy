# Releasing

okfy uses release-please to prepare releases and a GitHub Actions release workflow to publish the npm package.

## Normal Flow

1. Merge changes to `main` using Conventional Commit prefixes such as `fix:`, `feat:`, and `docs:`.
2. Release Please opens or updates a release PR.
3. Review and merge the release PR when ready.
4. Release Please creates the `vX.Y.Z` tag and GitHub Release.
5. The `Release` workflow verifies, packs, and publishes `okfy-ai` to npm.

## Required Secret

Add this repository secret:

```text
NPM_TOKEN
```

The token must have publish access for `okfy-ai`.

## Manual Dry Run

Run the `Release` workflow manually with `dry_run=true`. It builds, tests, and packs, but does not publish.

## Manual Publish

Manual publish is available only through the `Release` workflow with `dry_run=false`. Prefer the normal release-please path.
