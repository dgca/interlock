# Changesets

Run `pnpm changeset` for changes that need a release. Select the public root package, `@type_of/interlock`, even when the implementation lives in a private workspace package.

Commit the pending changeset with the feature. Use `pnpm release:status` to inspect the next release. After the feature merges, GitHub Actions creates a release PR with the version and changelog updates. Merging that PR publishes the package.

See [Release Interlock](../docs/releases.md) for setup, validation, and retries.
