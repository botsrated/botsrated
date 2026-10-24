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
4. **What you are approving.** Before the approval step, the run's Summary page shows:
   - who started the run, and the commit;
   - a compare link from the last `<package>-v*` release tag (or the first commit, if there's no tag yet) to that
     commit, with the commit list and the files changed in the package;
   - the sha256 of each file that will be published.

   The approval screen itself shows no diff, so open the run's Summary first.
   The publish job checks that the files it uploads have exactly those checksums.
5. **A reviewer approves.** Only a real publish uses the `npm-publish` / `pypi-publish` environment, which has
   Anton as the required reviewer. Dry runs never wait for approval. The publish job is the only one with
   `id-token: write`.
6. **CI tags the release.** After a successful real publish, a final `tag` job creates the annotated tag
   `<package>-v<version>` on that commit with the `GITHUB_TOKEN`. It's the only job with `contents: write`. It
   doesn't check anything out, and it fails if the tag already exists.

**What the approval does and doesn't prove.**
- GitHub checks 2FA when someone signs in, not on each approval. A phone that stays signed in can approve with one
  tap.
- Anyone holding a token for a reviewer account can approve through the API with no 2FA at all. A classic token
  needs `repo` scope; a fine-grained one needs Deployments write.
- So the approval is only as strong as who can use a reviewer account, and its tokens.

Kept from the security reviews:
- npm: separate `test`, `pack` and `compare` jobs. The published tarball is built with `npm ci --ignore-scripts`
  and must match the tested build byte for byte. The npm CLI is installed only from a checksum-verified tarball.
- PyPI: hash-pinned build tools and `--no-isolation`; pinned test dependencies.
- `persist-credentials: false` on every checkout; inputs reach scripts only through `env`.

The signed-tag check is still available but optional: `integrations/release-tools/verify-tag.sh` (pinned keys
and a fingerprint allowlist in `signers.txt`) and its self-test `test-verify-tag.sh`. The workflows don't call it.

## Setup (once)

It isn't decided yet who starts releases and whether the bot gets its own GitHub account. Today the bot and Anton
use the **same** account, which is an admin, and main isn't protected. Pick the case that matches what you set up.

**Always:**
- **Environments** `npm-publish` and `pypi-publish` (Settings → Environments):
  - required reviewer: Anton only;
  - **untick "Allow administrators to bypass configured protection rules"**, otherwise an admin can start the
    waiting job without an approval;
  - deployment branches: selected, `main` only. npm and PyPI trusted publishing bind to the workflow file and the
    environment, not the branch, so this setting is what stops a run on another branch from publishing;
  - no secrets and no variables.
- **Actions settings** (Settings → Actions → General):
  - default workflow permissions "Read repository contents";
  - untick **"Allow GitHub Actions to create and approve pull requests"**, so a workflow can't open and approve
    its own PR into main.
- **main ruleset** (Settings → Rules): block force pushes and deletions, require a pull request and the CI checks.
- **npm trusted publisher** for each package: repository `botsrated/botsrated`, workflow `publish-npm.yml`,
  environment `npm-publish`, and allow `npm publish`. Then set publishing access to "Require two-factor
  authentication and disallow tokens", and delete the old npm tokens.
- **PyPI trusted publisher** for each project: owner `botsrated`, repository `botsrated`, workflow
  `publish-pypi.yml`, environment `pypi-publish`. Then remove the project's API tokens.
- Optional: a tag ruleset for `*-v*` that blocks updates and deletions, so a release tag can't be moved.
- Secret scanning and push protection on (free for public repos).

**If the bot keeps using Anton's account (today's setup):**
- GitHub can't tell bot actions from Anton's. Anything the bot's token or connector can do counts as Anton.
- A required PR review can't work, because the author can't approve their own PR. Branch protection then only
  stops force pushes and direct pushes, and an admin can still bypass it unless the ruleset has no bypass.
- Prevent self-review must stay **off**, or Anton couldn't approve his own runs.
- Keep the bot's token scope below `repo` (today it's `public_repo`), so it can't approve a deployment through the
  API. This is the weakest option.

**If the bot gets its own account (recommended by Security):**
- Give it **Write** access (not Maintain or Admin) and a fine-grained token for this repo only, with Contents and
  Pull requests read/write. Give it no Administration, Environments, Deployments, Secrets or Workflows access.
  Revoke the old token the box uses.
- main ruleset: require 1 approving review, dismiss stale approvals, and require approval of the most recent
  push. The bypass list can hold "Repository admin, for pull requests only" so Anton can merge, and must never
  hold the bot.
- Prevent self-review: **on** if the bot starts releases (its token then also needs Actions write), **off** if
  Anton starts them himself.

## Residual risks

- **Write access to main is the real trust boundary.** Anyone who can merge or push to main can change the code
  or the workflow before the approval. The compare link and commit list in the run's Summary are there for
  checking that before tapping Approve. Mitigation: a main ruleset that requires a pull request (and a review by
  a second account, once there is one) with no bypass for the bot.
- **The approval is only as strong as the reviewer account.** 2FA is checked at sign-in, not per approval, and a
  token with the right scope can approve through the API without 2FA. Keep the account signed in only on Anton's
  own devices, and keep tokens for that account at the smallest scope.
- **Admin bypass.** An admin can bypass environment rules and rulesets unless bypass is switched off. Untick it on
  both environments.
- **Workflows approving PRs.** With "Allow GitHub Actions to create and approve pull requests" on, a workflow
  could open and approve a PR into main. Keep it off.
- **Same account for bot and human (today).** Until the bot has its own account, nothing GitHub records can show
  whether Anton or the bot started, merged or approved something.
- **No independent signature.** Without signed tags nothing outside GitHub vouches for the commit. npm
  provenance and PyPI attestations record which workflow run and commit produced the package, and the CI tag
  points at that same commit.
- **The `GITHUB_TOKEN` can write in the final job.** It runs only after a successful publish, with fixed inputs
  from the gate, and only creates `refs/tags/<package>-v<version>`. Branch and tag rulesets close the rest.
- **Third-party actions** are pinned by commit SHA, but they still run code. Update the pins deliberately.
