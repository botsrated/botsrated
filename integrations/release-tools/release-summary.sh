#!/usr/bin/env bash
# Prints the "what changed since the last release" part of the release gate summary (Markdown), for the approver.
#   usage: release-summary.sh <tag-prefix> <sha> <package-dir> <owner/repo> [<server-url>]
#   e.g.   release-summary.sh x402-preflight 375d95a... integrations/x402-client botsrated/botsrated
# Needs full history and tags (actions/checkout with fetch-depth: 0 and fetch-tags: true).
# The base is the newest <tag-prefix>-v* tag that is an ancestor of <sha>; with no such tag, the first commit.
# Writes base=<sha> and compare_url=<url> to $GITHUB_OUTPUT when that is set. Read-only: makes no network calls.
set -euo pipefail
prefix="$1"; sha="$2"; pkgdir="$3"; repo="$4"; server="${5:-https://github.com}"
max=100

sha=$(git rev-parse --verify "$sha^{commit}")
last_tag=$(git tag --list "$prefix-v*" --merged "$sha" --sort=-version:refname | head -n1 || true)
if [ -n "$last_tag" ]; then
  base=$(git rev-parse "$last_tag^{commit}"); base_label="last release tag \`$last_tag\`"
else
  base=$(git rev-list --max-parents=0 "$sha" | tail -n1); base_label="the first commit (no \`$prefix-v*\` tag yet)"
fi
compare="$server/$repo/compare/$base...$sha"
range=("$base..$sha")
[ -n "$last_tag" ] || range=("$sha")   # no tag: everything up to sha, including the first commit
total=$(git rev-list --count "${range[@]}")
in_pkg=$(git rev-list --count "${range[@]}" -- "$pkgdir")
workflow_touch=$(git rev-list --count "${range[@]}" -- .github docs/drafts integrations/release-tools)

echo "### Changes since $base_label"
echo
echo "- Compare: $compare"
echo "- Commits: $total in total, $in_pkg touching \`$pkgdir\`, $workflow_touch touching \`.github\`, \`docs/drafts\` or \`integrations/release-tools\`"
echo
echo "<details><summary>Commit list (newest first, up to $max)</summary>"
echo
git log --format="- [\`%h\`]($server/$repo/commit/%H) %s (%an, %ad)" --date=short -n "$max" "${range[@]}" | sed 's/[<>]/ /g'
[ "$total" -le "$max" ] || echo "- ... and $((total - max)) more (see the compare link)"
echo
echo "</details>"
echo
echo "<details><summary>Files changed in \`$pkgdir\`</summary>"
echo
echo '```'
if [ -n "$last_tag" ]; then git diff --stat=100 "$base" "$sha" -- "$pkgdir"; else git ls-tree -r --name-only "$sha" -- "$pkgdir" | head -n 200; fi
echo '```'
echo
echo "</details>"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "base=$base"; echo "compare_url=$compare"; echo "commits=$total"; } >> "$GITHUB_OUTPUT"
fi
