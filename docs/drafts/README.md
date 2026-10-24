# Release workflow drafts

`publish-npm.yml` and `publish-pypi.yml` belong in `.github/workflows/`. They are kept here because the token
that prepared them has no `workflow` scope. To enable them, a maintainer copies them into `.github/workflows/`
(e.g. through the GitHub web UI) and first completes the setup steps in each file's header:

- GitHub environments `npm-publish` and `pypi-publish`, each with Anton as required reviewer and main-only.
- npm trusted publisher (workflow `publish-npm.yml`, environment `npm-publish`) for each npm package.
- PyPI trusted publisher (workflow `publish-pypi.yml`, environment `pypi-publish`) for each PyPI project.

Both are manual (`workflow_dispatch`), run only from main, and default to a dry run.

Changes after the security re-review of Oct 24, 2026:

- **Signed tag, not main HEAD.** Each run takes a `tag` input (`<package>-v<version>`, e.g. `x402-preflight-v0.2.0`
  or `botsrated-v0.2.0`). A `verify` job checks, with `integrations/release-tools/verify-tag.sh` from main, that
  it is an annotated tag named after the package version, that its signature verifies against the keys in
  `.github/release-signers/` on main (`allowed_signers` for SSH-signed tags, `*.asc` for GPG-signed tags), and
  that it points at a commit on main. Everything is then built from that commit. Before the first run, commit the
  release signer key(s) to `.github/release-signers/` and sign tags with `git tag -s`.
- **npm: build and publish split.** `npm ci`, typecheck, tests and `npm pack` run in a `build` job without
  `id-token` or an environment. The `publish` job (environment `npm-publish`, `id-token: write`) only downloads the
  `.tgz` and runs `npm publish <tgz> --provenance --ignore-scripts`. npm provenance names the main workflow run;
  the job summary records the tag, its commit and the tarball's sha256.
- **PyPI: pinned build tools.** The wheel and sdist are built only with hash-pinned tools
  (`integrations/release-tools/requirements-release.txt`, `pip --require-hashes`: build 1.6.1, twine 7.0.0,
  hatchling 1.32.4) and `python -m build --no-isolation`, in a job that installs no test dependencies. Each
  package's `[build-system]` pins `hatchling==1.32.4`, and the job fails if the two differ. Tests run in a separate
  job with pinned test dependencies (`integrations/release-tools/constraints-test.txt`, including `x402==2.25.0`).

Changes after Security's recheck 2 (Oct 24, 2026):

- **R2-M1: GPG verification is pinned.** `verify-tag.sh` runs GPG with a fresh, empty `GNUPGHOME`, imports only
  the keys in `.github/release-signers/`, and then requires the fingerprint of the key that made the signature
  (from `git verify-tag --raw`: GPG `VALIDSIG`, signing subkey or primary key; SSH `SHA256:` fingerprint) to be
  listed in `integrations/release-tools/signers.txt` on main. A valid signature from any other key is rejected,
  including one whose key is already on the runner or sits in the signers folder without being pinned.
  `signers.txt` is committed empty, so releases fail closed until the owner adds a fingerprint there and the
  public key to `.github/release-signers/`. `integrations/release-tools/test-verify-tag.sh` is the self-test
  (throwaway keys and repo; the SSH cases run where `ssh-keygen` exists); the verify job runs it first.
- **R2-M2: the published tarball is built without install scripts.** A `pack` job builds from a fresh checkout
  with `npm ci --ignore-scripts`, compiles `dist/` by calling the lockfile's TypeScript compiler directly and runs
  `npm pack --ignore-scripts`. The `test` job (normal `npm ci`, typecheck, tests) packs a reference tarball, and a
  `compare` job requires the two to be byte-identical (sha256) before `publish` can run.
- **R2-L5: npm CLI integrity.** Every npm job installs npm 12.2.1 only from the registry tarball after checking its
  sha512 against `NPM_CLI_INTEGRITY` (the registry's `dist.integrity`), with `--ignore-scripts`. Bumping npm means
  updating both `NPM_CLI_VERSION` and `NPM_CLI_INTEGRITY`.
