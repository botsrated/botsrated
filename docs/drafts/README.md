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
