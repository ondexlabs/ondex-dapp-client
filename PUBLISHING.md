# Publishing

The npm token must never be committed. Use one of these two paths.

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

## GitHub Actions publish

1. Create the public repo as `ondexlabs/ondex-dapp-client`.
2. Add an npm granular access token as a repository secret named `NPM_TOKEN`.
3. The token must be allowed to publish packages under the `@ondex` scope and must have "Bypass two-factor authentication" enabled for write actions. Otherwise npm will reject the non-interactive workflow with an OTP error.
4. Push a tag such as `v0.1.0`.

Do not paste npm or GitHub tokens into issues, commits, pull requests, logs, or chat.
