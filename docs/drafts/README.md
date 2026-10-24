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
   - a compare link from the last version **published on the registry** to that commit, with the commit list and
     the files changed in the package. The base is never just the newest tag, because anyone with Write can create
     one: for npm it's the `gitHead` of the latest version (`npm view <pkg>@<latest> gitHead`, or the commit in its
     provenance); for PyPI it's the `<package>-v<version>` tag of the latest version on PyPI. A `<package>-v*` tag
     whose version isn't on the registry, or a tag that doesn't point at the registry's commit, shows up as a
     **WARNING**. If the base can't be determined (registry unreachable, unknown commit, no tag for the latest PyPI
     version), the Summary says so in a WARNING and lists everything since the first commit. Commit subjects,
     authors and file names are HTML-escaped inside `<pre>` blocks, so they can't add formatting or links;
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

Decided: the bot has its own GitHub account, **`botsrated-bot`**, and **Anton (`amcc8q`) is the only owner and
the only reviewer**. Anton starts releases himself.

**Accounts:**
- `botsrated-bot`: member of the `botsrated` org and a **Write** collaborator on this repo (not Maintain or Admin).
  Its only credential on the box is a fine-grained token for this repo only, with **Contents** and **Pull
  requests** read/write. No Administration, Workflows, Actions, Deployments, Environments, Secrets or Commit
  statuses access. It can push branches and open PRs; it can't merge to main without Anton's approval, change
  workflows, start a release or approve a deployment. Its 2FA (passkey or TOTP) and recovery codes stay with Anton,
  not on the box.
- `amcc8q` (Anton): the only org owner and repo admin, and the only required reviewer on both environments. The box
  and the bot's connectors must hold **no** credential for this account. Otherwise the bot could open a PR as one
  account and approve it as the other.

**main ruleset** ("main protection", active on the default branch, **no bypass actors**, not even admins):
- block force pushes and deletions;
- require a pull request with **1 approving review**, **dismiss stale approvals** on new pushes and require
  **approval of the most recent push**;
- require the **8 CI checks** (`Python …` ×3, `Node … (…)` ×4, `Receipt spec verifier`), each pinned to the
  **GitHub Actions** source, so a commit status posted by a token can't stand in for a check.

So the bot's PRs need Anton's approval, and Anton's own PRs need an approval from the other Write account, the bot.
That one is a formality, not a review, since Anton wrote the change.

**Environments** `npm-publish` and `pypi-publish`: Anton is the only required reviewer and **"Allow administrators
to bypass configured protection rules" is off**. Prevent self-review stays off, because Anton starts the runs he
approves.

**Tags:** a tag ruleset for `*-v*` with only GitHub Actions as a bypass isn't possible (GitHub rejected the Actions
integration as a bypass actor). Anyone with Write, including the bot, can therefore create a `<package>-v*` tag.
That's why the approval summary takes its base from the registry, not from tags, and flags tags whose version isn't
published.

**Checklist (Settings):**
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
- **main ruleset** (Settings → Rules): as above, with no bypass.
- **npm trusted publisher** for each package: repository `botsrated/botsrated`, workflow `publish-npm.yml`,
  environment `npm-publish`, and allow `npm publish`. Then set publishing access to "Require two-factor
  authentication and disallow tokens", and delete the old npm tokens.
- **PyPI trusted publisher** for each project: owner `botsrated`, repository `botsrated`, workflow
  `publish-pypi.yml`, environment `pypi-publish`. Then remove the project's API tokens.
- Secret scanning and push protection on (free for public repos).

## Residual risks

- **Write access to main is the real trust boundary.** Anyone who can merge or push to main can change the code
  or the workflow before the approval. The compare link and commit list in the run's Summary are there for
  checking that before tapping Approve. Mitigation: the main ruleset requires a pull request approved by the other
  account, with no bypass.
- **The approval is only as strong as the reviewer account.** 2FA is checked at sign-in, not per approval, and a
  token with the right scope can approve through the API without 2FA. Keep the account signed in only on Anton's
  own devices, and keep tokens for that account at the smallest scope.
- **Admin bypass.** An admin can bypass environment rules and rulesets unless bypass is switched off. Untick it on
  both environments.
- **Workflows approving PRs.** With "Allow GitHub Actions to create and approve pull requests" on, a workflow
  could open and approve a PR into main. Keep it off.
- **Two accounts, one human.** `botsrated-bot` and `amcc8q` are separate, so GitHub records who did what, but the
  review is only independent while the box holds no `amcc8q` credential. Anton's own PRs are approved by the bot,
  which is a formality. A repo admin or org owner (Anton) can still edit or delete the ruleset and the environment
  rules in Settings; the audit log is the only record, so keep that role on Anton's own devices.
- **Tags can be created by anyone with Write.** There's no tag ruleset (see Setup). The approval summary doesn't
  trust tags: its base comes from the registry, and unpublished or moved tags show as a WARNING.
- **No independent signature.** Without signed tags nothing outside GitHub vouches for the commit. npm
  provenance and PyPI attestations record which workflow run and commit produced the package, and the CI tag
  points at that same commit.
- **The `GITHUB_TOKEN` can write in the final job.** It runs only after a successful publish, with fixed inputs
  from the gate, and only creates `refs/tags/<package>-v<version>`. Branch and tag rulesets close the rest.
- **Third-party actions** are pinned by commit SHA, but they still run code. Update the pins deliberately.
