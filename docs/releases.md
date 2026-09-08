# Release Interlock

Interlock publishes one npm package, `@type_of/interlock`, from the repository root. The private packages under `packages/` are bundled into it and are not released separately.

Changesets manages the root version and `CHANGELOG.md`. The CLI, UI, and MCP server read their version from the root `package.json`.

## One-time setup

1. In the repository's **Settings → Actions → General → Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. The workflow declares its own write permissions, so the default can stay read-only.
2. Merge the PR that adds `.github/workflows/release.yml` to `main`.
3. In npm's settings for `@type_of/interlock`, add a **GitHub Actions** trusted publisher with these values:

   | Field                | Value         |
   | -------------------- | ------------- |
   | Organization or user | `dgca`        |
   | Repository           | `interlock`   |
   | Workflow filename    | `release.yml` |
   | Environment          | Leave blank   |

   Allow direct publishing when choosing the publisher's allowed actions. The GitHub owner is `dgca`; `type_of` is the npm organization.

4. Finish this setup before merging the generated release PR.

The release job uses npm trusted publishing through GitHub's OIDC identity. No `NPM_TOKEN` secret is needed. The pinned pnpm version supports OIDC publishing, and the job grants `id-token: write`. Public releases include provenance linked to this repository. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the npm settings.

## Describe a change

For a change that needs a release, run:

```sh
pnpm changeset
```

Select `@type_of/interlock`, choose the version bump, and write a summary for users. Include the generated `.changeset/*.md` file in the feature PR. Leave the package version and changelog for the release PR.

While the package is on `0.x`, follow the [versioning policy in AGENTS.md](../AGENTS.md#preserve-these-boundaries): use patch bumps for non-breaking fixes and additions. Minor or major bumps require an explicit user request. Flag breaking changes before choosing a release bump.

Internal development changes that do not affect the published package do not need a changeset.

Inspect the pending release locally with `pnpm release:status`. Multiple patch changesets combine into one patch bump, so three patches on `0.0.1` produce `0.0.2`.

## Release a version

1. Merge the feature PR after CI passes.
2. The **Release** workflow creates or updates a **Release Interlock** PR. It runs `pnpm release:version` to update the root version, changelog, and lockfile, and remove consumed changesets.
3. Review the generated diff. GitHub does not automatically trigger PR workflows for PRs created with `GITHUB_TOKEN`. To check the release branch before merging, run **Actions → CI → Run workflow** and select `changeset-release/main`.
4. Merge the release PR. The next **Release** run executes `pnpm release`, which tests, builds, checks a packed install, and publishes unpublished versions. Changesets then pushes the release tag and creates a GitHub release.
5. Verify the version:

```sh
npm view @type_of/interlock version
npm install -g @type_of/interlock
interlock --version
```

The `prepack` hook rebuilds the package when it is packed. Local `.interlock` data, source files, and development dependencies are excluded from the tarball.

## Retry a failed release

Inspect the failed **Release** run and check the version in npm first. After fixing the cause, run **Actions → Release → Run workflow** on `main`. The workflow also runs when a fix merges to `main`.

Keep the existing version when retrying a failed publish. Changesets skips versions already in npm. A published version cannot be reused. If npm publication succeeded but GitHub release creation failed, check the tag and GitHub release separately, since a retry may skip the already-published package.
