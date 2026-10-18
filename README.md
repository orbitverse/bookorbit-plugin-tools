# BookOrbit Plugin Tools

Shared build and signed-release tools for Orbitverse BookOrbit plugins. Installed from an exact Git commit; not published to npm.

```sh
pnpm exec bookorbit-plugin-tools build
pnpm exec bookorbit-plugin-tools check-release
pnpm exec bookorbit-plugin-tools sign-release
```

Run in a plugin repository containing `src/index.ts`, `package.json` (version), and `release.json` (`repository`, `type`, `publicKey`). Use `--directory PATH` to target another directory.

Build embeds the project license, any root `NOTICE`, licenses/notices from bundled dependencies, and a versioned source link in the standalone file. A bundled package without a license file fails the build, except for the retained upstream ISC notice for `boolbase@1.0.0`, whose npm archive omits it ([source](https://github.com/fb55/boolbase/blob/master/LICENSE)).

Build writes and validates `dist/index.mjs` and `dist/plugin.json`. Signing reads those checked bytes and writes the signed update manifest and `SHA256SUMS`; it requires `PLUGIN_SIGNING_KEY`. `check-release` verifies any existing version and writes `release`/`version` to `GITHUB_OUTPUT` in Actions.

Each plugin keeps its signing key, protected release environment and publishing workflow. This package contains no runtime plugin code and never publishes a release.

Run `pnpm install --frozen-lockfile` and `pnpm check` to test.

AGPL-3.0-only.
