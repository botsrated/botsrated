# Release workflow drafts

`publish-npm.yml` and `publish-pypi.yml` belong in `.github/workflows/`. They are kept here because the token
that prepared them has no `workflow` scope. To enable them, a maintainer copies them into `.github/workflows/`
(e.g. through the GitHub web UI) after the setup below.

## The release gate (phone-friendly, no signed tags)

Anton releases from the GitHub iPhone app, so the gate doesn't need GPG or SSH signing:

1. **Manual run on main only.** The workflows run only by `workflow_dispatch`. The first job (`gate`) fails unless
   the event is `workflow_dispatch` and the ref is `refs/heads/main`. Dry run is on by default.
2. **Version input must match.** The `version` input must equal `package.json` / `pyproject.toml` at the run's
   commit. The gate also fails if the release tag `<package>-v<version>` already exists or the version is already
   on npm / PyPI.
3. **Exact commit.** Every job checks out `github.sha`, the main commit the run started on, never a branch name.
   A push to main after the run starts doesn't change what's built.
4. **Anton approves.** The `publish` job uses the `npm-publish` / `pypi-publish` environment, with Anton as the
   required reviewer. He approves from the GitHub app, which needs his GitHub sign-in and 2FA. The publish job is
   the only one with `id-token: write`.
5. **CI tags the release.** After a successful real publish, a final `tag` job creates the annotated tag
   `<package>-v<version>` on that commit with the `GITHUB_TOKEN`. It's the only job with `contents: write`. It
   doesn't check anything out, and it fails if the tag already exists.

Kept from the security reviews:
- npm: separate `test`, `pack` and `compare` jobs. The published tarball is built with `npm ci --ignore-scripts`
  and must match the tested build byte for byte. The npm CLI is installed only from a checksum-verified tarball.
- PyPI: hash-pinned build tools and `--no-isolation`; pinned test dependencies.
- `persist-credentials: false` on every checkout; inputs reach scripts only through `env`.

The signed-tag check is still available but optional: `integrations/release-tools/verify-tag.sh` (pinned keys
and a fingerprint allowlist in `signers.txt`) and its self-test `test-verify-tag.sh`. The workflows don't call it.

## What Anton sets up (once)

- **Environments** `npm-publish` and `pypi-publish` (Settings → Environments): Anton as the required reviewer,
  and deployment branches limited to `main`. Turn on **Prevent self-review** only if releases are started by
  another account (for example a bot or a co-maintainer). If Anton starts the run himself, that setting would stop
  him from approving it.
- **Branch protection on `main`** (Settings → Rules or Branches): require a pull request before merging, block
  force pushes and deletions, and require the CI checks to pass. If someone else gets write access, also require
  an approving review.
- **Tag protection** (optional): a ruleset for `*-v*` tags that blocks updates and deletions, so a release tag
  can't be moved after CI creates it.
- **npm trusted publisher** for each package: repository `botsrated/botsrated`, workflow `publish-npm.yml`,
  environment `npm-publish`, and allow `npm publish`. Then set publishing access to "Require two-factor
  authentication and disallow tokens".
- **PyPI trusted publisher** for each project: owner `botsrated`, repository `botsrated`, workflow
  `publish-pypi.yml`, environment `pypi-publish`. Then remove the project's API tokens.

## Residual risks

- **Write access to main is the real trust boundary.** Anyone who can push to main, or merge to it, can change
  the code or the workflow before Anton approves. The approval screen shows the run and its commit, not a diff.
  Mitigation: branch protection that requires a pull request (and a review when there's more than one
  maintainer), and checking that the run's commit is the merge he expects before approving.
- **Approval is one tap.** It's protected by Anton's GitHub account and 2FA, so it's only as strong as that
  account. Keep 2FA on his own device and don't share the account.
- **No independent signature.** Without signed tags nothing outside GitHub vouches for the commit. npm
  provenance and PyPI attestations record which workflow run and commit produced the package, and the CI tag
  points at that same commit.
- **The `GITHUB_TOKEN` can write tags** in the final job. It runs only after a successful publish and uses fixed
  inputs from the gate. A tag ruleset (above) stops it, or anything else, from moving an existing tag.
- **Prevent self-review** can't be used if Anton both starts and approves the run (see setup).
- **Third-party actions** are pinned by commit SHA, but they still run code. Update the pins deliberately.
