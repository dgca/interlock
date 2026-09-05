# Release Interlock

Interlock publishes one npm package, `@type_of/interlock`, from the repository root. The private packages under `packages/` are bundled into it and are not released separately.

Changesets manages the root version and `CHANGELOG.md`. The CLI, UI, and MCP server read their version from the root `package.json`.

## Describe a change

For a change that needs a release, run:

```sh
pnpm changeset
```

Select `@type_of/interlock`, choose the version bump, and write a summary of the change for users. Include the generated `.changeset/*.md` file in the change's commit.

Use a patch for compatible fixes, a minor for compatible additions, and a major for breaking changes. Review breaking changes explicitly while the package is on `0.x` rather than relying on the suggested bump.

Internal development changes that do not affect the published package do not need a changeset.

## Prepare a version

From an up-to-date `main` checkout, inspect the pending release:

```sh
pnpm release:status
```

Apply the pending changesets:

```sh
pnpm release:version
```

This updates the root package version and changelog, removes the consumed changesets, and refreshes the pnpm lockfile. It does not publish anything.

Review the diff and validate the release:

```sh
pnpm test
pnpm build
pnpm test:package
pnpm format:check
```

Commit the version, changelog, lockfile, and changeset removals. Push the release commit to `main` before publishing.

## Publish the version

Sign in to npm with an account that can publish to the `type_of` organization:

```sh
npm login
npm whoami
```

With the release commit checked out, run:

```sh
pnpm release
```

This runs tests, builds the package, verifies a packed install, and invokes `changeset publish`. Complete npm's authentication prompt when requested. Changesets publishes versions missing from the registry and creates a local Git tag for each successful release.

Push the generated tag, substituting the released version:

```sh
git push origin @type_of/interlock@0.0.2
```

Verify the release from npm:

```sh
npm view @type_of/interlock version
npm install -g @type_of/interlock
interlock --version
```

If authentication or publication fails, inspect the registry before retrying `pnpm release`. Do not run `release:version` again to retry a publish. A published version cannot be reused.

The `prepack` hook rebuilds the package when npm or pnpm packs it. Local `.interlock` data, source files, and development dependencies are excluded from the published tarball.
