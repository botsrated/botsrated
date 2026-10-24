# Release workflow drafts

`publish-npm.yml` and `publish-pypi.yml` belong in `.github/workflows/`. They are kept here because the token
that prepared them has no `workflow` scope. To enable them, a maintainer copies them into `.github/workflows/`
(e.g. through the GitHub web UI) and first completes the setup steps in each file's header:

- GitHub environments `npm-publish` and `pypi-publish`, each with Anton as required reviewer and main-only.
- npm trusted publisher (workflow `publish-npm.yml`, environment `npm-publish`) for each npm package.
- PyPI trusted publisher (workflow `publish-pypi.yml`, environment `pypi-publish`) for each PyPI project.

Both are manual (`workflow_dispatch`), run only from main, and default to a dry run.
