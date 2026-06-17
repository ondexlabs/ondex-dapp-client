# Publishing

The npm token must never be committed. GitHub Actions releases should use npm Trusted Publishing by default.

Current status:

- `@ondex/dapp-client@0.1.0` was published from `ondexlabs/ondex-dapp-client` tag `v0.1.0` on 2026-06-17.
- The first publish used a temporary npm token with `bypass_2fa: true`.
- Trusted Publishing is configured for GitHub Actions, and `.github/workflows/publish.yml` is OIDC-only.
- Temporary npm tokens used for the first publish should be revoked in npm.

## Repository model

- The main Ondex product can stay in the private GitHub repo under `lucholabs`.
- This SDK should be published from a separate public repo under `ondexlabs`, using `ondexlabs/ondex-dapp-client`.
- The npm package is scoped to the npm org as `@ondex/dapp-client`.
- Publish from the public repo so npm provenance, repository links, issues, and docs all point to a public source.

## Local publish

1. Put the real npm token in `.env.publish`.
2. The token must have package/scope read-write access and must either bypass 2FA for write actions or be used with an interactive one-time password.
3. Make sure `.npmrc.publish` exists. It is ignored by git and uses `NPM_TOKEN`.
4. Load the token and publish:

```bash
set -a
source .env.publish
set +a
pnpm install
npm pack --dry-run --cache /private/tmp/ondex-npm-cache
pnpm publish --access public
```

## Trusted Publishing

The npm package settings for `@ondex/dapp-client` should stay configured as:

```text
Provider: GitHub Actions
Organization or user: ondexlabs
Repository: ondex-dapp-client
Workflow filename: publish.yml
Environment name: empty
Allowed actions: npm publish
```

The workflow grants `id-token: write` and does not require `NODE_AUTH_TOKEN` or an `NPM_TOKEN` GitHub Actions secret.

## Token-Based Publish Fallback

Use this only for emergency releases or if Trusted Publishing is not configured.

1. Add an npm granular access token as a repository secret named `NPM_TOKEN`.
2. The token must be allowed to publish packages under the `@ondex` scope and must have "Bypass two-factor authentication" enabled for write actions. Otherwise npm will reject the non-interactive workflow with an OTP error.
3. Verify the token metadata before rerunning a release:

```bash
set -a
source .env.publish
set +a
NPM_CONFIG_USERCONFIG=.npmrc.publish npm token list --json
```

The selected token should report `bypass_2fa: true`.

4. Push a tag such as `v0.1.1`.

Do not paste npm or GitHub tokens into issues, commits, pull requests, logs, or chat.
