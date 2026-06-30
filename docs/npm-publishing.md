# Manual npm Publishing

This repo publishes `okfy-ai` manually. Do not use GitHub Actions, release automation, or local `npm publish --provenance` for npm publishing unless the project explicitly adopts that later.

The npm package is `okfy-ai`. The installed CLI commands are `okfy` and `okfy-ai`.

## What The Publish Script Does

Use the repo script:

```bash
pnpm publish:npm
```

That runs `scripts/publish-npm-readme.mjs`, which:

- runs `pnpm build`
- runs `pnpm test`
- runs `pnpm typecheck`
- temporarily replaces `README.md` with `scripts/npm-readme.md`
- runs `npm publish --access public --ignore-scripts`
- restores the GitHub `README.md` on exit, including failed publish attempts

Edit `scripts/npm-readme.md` when the npm package page needs different or shorter copy than the GitHub README. The GitHub README is not what npm renders during publish.

## Release Checklist

Start from a clean checkout of latest `main`, ideally a temporary worktree so unrelated local files cannot leak into the release.

```bash
tmp="$(mktemp -d /tmp/okfy-release.XXXXXX)"
git fetch origin main --tags --prune
git worktree add --detach "$tmp" origin/main
cd "$tmp"
```

1. Choose the next unpublished version.
2. Update `package.json`.
3. Update `.release-please-manifest.json`.
4. Update npm-facing docs in `scripts/npm-readme.md` when CLI behavior, setup flow, public exports, or package positioning changed.
5. Confirm the release surfaces agree:

```bash
node -p "JSON.stringify({
  package: require('./package.json').version,
  manifest: require('./.release-please-manifest.json')
}, null, 2)"
npm view okfy-ai version dist-tags --json
```

6. Use a writable npm cache:

```bash
export npm_config_cache=/private/tmp/okfy-npm-cache
```

7. Install and run pre-publish checks:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm demo
node scripts/publish-npm-readme.mjs --dry-run
```

The dry run is intentionally the strongest local package-shape check. It builds, runs the full test suite, typechecks, swaps in the npm README, and performs `npm publish --dry-run`.

## npm Login

Check auth early:

```bash
npm whoami
```

If it returns `E401`, use npm web login:

```bash
npm login --auth-type=web --registry=https://registry.npmjs.org
```

If the browser does not open or the CLI output redacts the link, print the full login URL with npm's bundled `npm-profile` library:

```bash
node <<'NODE'
(async () => {
  const { writeFileSync } = require('node:fs');
  const { loginWeb } = require('/usr/local/lib/node_modules/npm/node_modules/npm-profile');

  async function opener(url) {
    console.error(`Open this npm login URL:\n${url}`);
    console.error('Waiting for npm login approval...');
  }

  const result = await loginWeb(opener, {
    registry: 'https://registry.npmjs.org/',
    cache: process.env.npm_config_cache || '/private/tmp/okfy-npm-cache',
    npmSession: `okfy-release-${Date.now()}`,
    npmCommand: 'login',
    authType: 'web',
    userAgent: 'npm manual okfy-ai release',
  });

  if (!result?.token) throw new Error('npm web login did not return a token');
  writeFileSync('/private/tmp/okfy-npm-userconfig', `//registry.npmjs.org/:_authToken=${result.token}\n`, {
    mode: 0o600,
  });
  console.error('Wrote temporary npm auth config to /private/tmp/okfy-npm-userconfig');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
```

Then verify the temporary auth:

```bash
export npm_config_userconfig=/private/tmp/okfy-npm-userconfig
npm --userconfig=/private/tmp/okfy-npm-userconfig whoami
```

Delete `/private/tmp/okfy-npm-userconfig` after publishing. It contains an npm auth token.

## Publishing With MFA

Prefer npm's web MFA flow over numeric OTP codes. `pnpm publish:npm` reruns build, tests, and typecheck before it reaches npm, so a numeric TOTP can expire before publish.

If npm redacts MFA links, create a one-command preload that disables npm's local log redaction for this publish attempt:

```bash
cat >/private/tmp/okfy-unredact-npm.cjs <<'EOF'
const Module = require('node:module');

const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@npmcli/redact') {
    return {
      redact: (value) => value,
      redactLog: (value) => value,
    };
  }
  return originalLoad.apply(this, arguments);
};
EOF
```

Run the publish command in a real TTY. This matters: npm only enters the web-MFA URL flow when stdin and stdout are TTYs. In non-TTY mode it may fail with `EOTP` and no approval link.

```bash
NODE_OPTIONS=--require=/private/tmp/okfy-unredact-npm.cjs \
  npm_config_browser=false \
  npm_config_cache=/private/tmp/okfy-npm-cache \
  npm_config_userconfig=/private/tmp/okfy-npm-userconfig \
  pnpm publish:npm
```

When npm prints a URL like this, open it and approve:

```text
https://www.npmjs.com/auth/cli/<id>
```

The publish process keeps polling. Wait for:

```text
+ okfy-ai@<version>
```

If a fully verified publish reaches npm but fails with `EOTP` because it was not run in a TTY, do not rerun the whole release blindly. Either rerun `pnpm publish:npm` in a TTY, or, if the exact same commit has already passed the full pre-publish checks, use a publish-only README-swap wrapper in a TTY:

```bash
cat >/private/tmp/okfy-publish-web-mfa.cjs <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const githubReadme = path.join(root, 'README.md');
const npmReadme = path.join(root, 'scripts', 'npm-readme.md');
const backupReadme = '/private/tmp/okfy-readme-github-backup.md';

function restore() {
  if (fs.existsSync(backupReadme)) {
    fs.copyFileSync(backupReadme, githubReadme);
    fs.rmSync(backupReadme, { force: true });
  }
}

process.on('exit', restore);
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restore();
  process.exit(143);
});

fs.copyFileSync(githubReadme, backupReadme);
fs.copyFileSync(npmReadme, githubReadme);
const result = spawnSync('npm', ['publish', '--access', 'public', '--ignore-scripts'], {
  stdio: 'inherit',
  shell: false,
  env: process.env,
});
restore();
process.exit(result.status ?? 1);
NODE

NODE_OPTIONS=--require=/private/tmp/okfy-unredact-npm.cjs \
  npm_config_browser=false \
  npm_config_cache=/private/tmp/okfy-npm-cache \
  npm_config_userconfig=/private/tmp/okfy-npm-userconfig \
  node /private/tmp/okfy-publish-web-mfa.cjs
```

That wrapper exists only to avoid another long test run after the same commit has already passed `node scripts/publish-npm-readme.mjs --dry-run` and a failed real publish attempt. It must still be run in a TTY so npm can print the MFA approval URL.

## Post-Publish Verification

Verify the registry, not just local files:

```bash
npm view okfy-ai version dist-tags --json
```

Then use fresh temp directories and npm caches:

```bash
mkdir -p /private/tmp/okfy-verify
cd /private/tmp/okfy-verify
npm_config_cache=/private/tmp/okfy-verify-cache npx -y okfy-ai@<version> --version
npm_config_cache=/private/tmp/okfy-verify-cache npx -y okfy-ai@latest --version
npm_config_cache=/private/tmp/okfy-verify-cache npx -y okfy-ai@<version> --help
```

The version printed by both `@<version>` and `@latest` must match the published package version.

To confirm the npm package page README matches the repo source:

```bash
npm view okfy-ai@<version> readme > /private/tmp/okfy-published-readme.md
cmp -s /private/tmp/okfy-published-readme.md scripts/npm-readme.md
```

## Cleanup

Remove temporary auth and helper files:

```bash
rm -f \
  /private/tmp/okfy-npm-userconfig \
  /private/tmp/okfy-unredact-npm.cjs \
  /private/tmp/okfy-publish-web-mfa.cjs \
  /private/tmp/okfy-readme-github-backup.md
rm -rf \
  /private/tmp/okfy-npm-cache \
  /private/tmp/okfy-verify \
  /private/tmp/okfy-verify-cache
```

Remove the temporary worktree when done:

```bash
cd /Users/0dust/Documents/Experiments/okfy
git worktree remove --force "$tmp"
git worktree prune
```

## Common Failure Modes

- `E401` from `npm whoami`: login is not active; run the web login flow above.
- `EOTP` without an approval link: publish was probably not run in a TTY. Rerun in a TTY so npm can enter web-MFA flow.
- Redacted MFA URL: use the `/private/tmp/okfy-unredact-npm.cjs` preload.
- Numeric OTP expires: prefer the web MFA URL. The full publish script runs checks before npm publish, so a TOTP can age out.
- `You cannot publish over the previously published versions`: bump to the next unpublished patch version.
- `npx ... --version` prints an old version: verify `package.json`, `.release-please-manifest.json`, and the npm registry dist-tag, then publish a new version if the old version was already published.
- npm package page shows stale docs: update `scripts/npm-readme.md`, not just `README.md`, then publish a new version.
- Local `npm publish --provenance` is not supported outside supported CI providers; do not add provenance to the manual local publish path.
