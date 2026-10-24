#!/usr/bin/env bash
# Prints the "what changed since the last release" part of the release gate summary (Markdown), for the approver.
#   usage: release-summary.sh <tag-prefix> <sha> <package-dir> <owner/repo> <server-url> <npm|pypi> <package-name>
#   e.g.   release-summary.sh x402-preflight 375d95a... integrations/x402-client botsrated/botsrated \
#            https://github.com npm @botsrated/x402-preflight
# Needs full history and tags (actions/checkout with fetch-depth: 0 and fetch-tags: true), git, curl and jq
# (and npm for the npm registry).
#
# The base is the commit of the last version actually published on the registry, never just the newest tag
# (anyone with Write can create a tag, Security F-1):
#   npm:  the latest dist-tag's `gitHead` (npm view <pkg>@<latest> gitHead); if that is empty, the commit in the
#         version's npm provenance attestation; if that is missing too, the tag <prefix>-v<latest> (flagged).
#   PyPI: the tag <prefix>-v<latest>, where <latest> is info.version from https://pypi.org/pypi/<pkg>/json.
# The base must be a commit in this repo and an ancestor of <sha>. If it can't be determined, the summary says so
# in a WARNING and falls back to the first commit (the full history). If nothing is published yet, the base is the
# first commit. Every <prefix>-v* tag whose version isn't on the registry is listed as untrusted in a WARNING, and
# so is a tag for the latest version that doesn't point at the registry's commit.
# Commit subjects, authors, file names and tag names are HTML-escaped and shown inside <pre> blocks, so they can't
# add Markdown (bold, links, images) or break out of the block (Security F-2).
# Writes base=<sha>, base_source=<text>, compare_url=<url> and commits=<n> to $GITHUB_OUTPUT when that is set.
# Network: read-only GETs to the npm registry or PyPI. No credentials are used.
set -euo pipefail
if [ "$#" -ne 7 ]; then echo "usage: $0 <tag-prefix> <sha> <package-dir> <owner/repo> <server-url> <npm|pypi> <package-name>" >&2; exit 2; fi
prefix="$1"; sha="$2"; pkgdir="$3"; repo="$4"; server="$5"; registry="$6"; pkgname="$7"
case "$registry" in npm|pypi) ;; *) echo "registry must be npm or pypi, got '$registry'" >&2; exit 2;; esac
max=100

# HTML-escape for text inside <pre>: & < > " ' and ` become entities, so nothing can close the block or add tags.
h() { local s="$1"; s=${s//&/"&amp;"}; s=${s//</"&lt;"}; s=${s//>/"&gt;"}; s=${s//\"/"&quot;"}; s=${s//\'/"&#39;"}; s=${s//\`/"&#96;"}; printf '%s' "$s"; }
# Inline Markdown text: HTML-escape (that covers ` < > &), then backslash-escape the other Markdown punctuation
# (# is left alone: it only matters at the start of a line, and escaping it would break the &#39; entities).
md() { h "$1" | sed -e 's/[][\\*_{}()+.!|~-]/\\&/g'; }
warnings=()
warn() { warnings+=("$1"); echo "::warning::release summary: $1" >&2; }
is_commit() { [[ "$1" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "$1^{commit}" 2>/dev/null; }

sha=$(git rev-parse --verify "$sha^{commit}")
first=$(git rev-list --max-parents=0 "$sha" | tail -n1)

# --- What the registry says: latest version, all versions, and (npm) the latest version's commit.
latest=""; reg_commit=""; reg_commit_src=""; versions=""; reg_state="unknown"   # published | unpublished | unknown
if [ "$registry" = npm ]; then
  err=$(mktemp); trap 'rm -f "$err"' EXIT
  if out=$(npm view "$pkgname" --json 2>"$err"); then
    latest=$(jq -r '."dist-tags".latest // empty' <<<"$out" 2>/dev/null || true)
    versions=$(jq -r '.versions | if type=="array" then .[] elif type=="string" then . else empty end' <<<"$out" 2>/dev/null || true)
    if [ -n "$latest" ]; then
      reg_state=published
      gh_head=$(npm view "$pkgname@$latest" gitHead 2>/dev/null | tr -d '[:space:]' || true)
      if [ -n "$gh_head" ]; then reg_commit="$gh_head"; reg_commit_src="npm \`gitHead\` of $(md "$pkgname@$latest")"; fi
      if [ -z "$reg_commit" ]; then
        prov=$(curl -fsS --proto '=https' --max-time 30 --retry 2 "https://registry.npmjs.org/-/npm/v1/attestations/$pkgname@$latest" 2>/dev/null \
          | jq -r '.attestations[]? | select(.predicateType | test("slsa.dev/provenance")) | .bundle.dsseEnvelope.payload' 2>/dev/null \
          | head -n1 | base64 -d 2>/dev/null \
          | jq -r '.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit // .predicate.materials[0].digest.sha1 // empty' 2>/dev/null || true)
        if [ -n "$prov" ]; then reg_commit="$prov"; reg_commit_src="npm provenance of $(md "$pkgname@$latest")"; fi
      fi
    else
      warn "npm returned no \"latest\" dist-tag for $pkgname"
    fi
  elif grep -q 'E404' "$err"; then
    reg_state=unpublished
  else
    warn "could not query npm for $pkgname ($(head -c 200 "$err" | tr '\n' ' '))"
  fi
else
  body=$(mktemp); trap 'rm -f "$body"' EXIT
  code=$(curl -sS --proto '=https' --max-time 30 --retry 2 -o "$body" -w '%{http_code}' "https://pypi.org/pypi/$pkgname/json" 2>/dev/null || true)
  if [ "$code" = 200 ]; then
    latest=$(jq -r '.info.version // empty' "$body" 2>/dev/null || true)
    versions=$(jq -r '.releases | keys[]' "$body" 2>/dev/null || true)
    if [ -n "$latest" ]; then reg_state=published; else warn "PyPI returned no info.version for $pkgname"; fi
  elif [ "$code" = 404 ]; then
    reg_state=unpublished
  else
    warn "could not query PyPI for $pkgname (HTTP ${code:-none})"
  fi
fi

# --- Tags: a <prefix>-v<version> tag is trusted only if <version> is on the registry.
latest_tag="$prefix-v$latest"
untrusted=()
while IFS= read -r t; do
  [ -n "$t" ] || continue
  v="${t#"$prefix"-v}"
  if [ "$reg_state" = unknown ] || ! grep -qxF -- "$v" <<<"$versions"; then untrusted+=("$t"); fi
done < <(git tag --list "$prefix-v*")

# --- Pick the base.
base=""; base_label=""; base_source=""
if [ "$reg_state" = published ]; then
  tag_commit=""
  if git rev-parse -q --verify "refs/tags/$latest_tag" >/dev/null; then tag_commit=$(git rev-parse "refs/tags/$latest_tag^{commit}"); fi
  if [ -z "$reg_commit" ] && [ -n "$tag_commit" ]; then
    reg_commit="$tag_commit"; reg_commit_src="tag $(md "$latest_tag") (version $(md "$latest") is on $registry)"
    [ "$registry" = pypi ] || warn "npm has no gitHead or provenance commit for $pkgname@$latest; using the tag $latest_tag, which the registry doesn't confirm"
  fi
  if [ -z "$reg_commit" ]; then
    warn "the latest published version $pkgname $latest has no commit on record (no gitHead/provenance, no tag $latest_tag)"
  elif ! is_commit "$reg_commit"; then
    warn "the registry's commit for $pkgname $latest ($reg_commit) is not a commit in this repository"
  elif ! git merge-base --is-ancestor "$reg_commit" "$sha"; then
    warn "the registry's commit for $pkgname $latest ($reg_commit) is not an ancestor of $sha"
  else
    base="$reg_commit"; base_source="$registry:$latest"
    base_label="the last published version $(md "$pkgname $latest") (commit from $reg_commit_src)"
    if [ -n "$tag_commit" ] && [ "$tag_commit" != "$reg_commit" ]; then
      warn "tag $latest_tag points at $tag_commit, but $registry says $latest was built from $reg_commit; the tag was moved or planted"
      untrusted+=("$latest_tag")
    fi
  fi
fi
if [ -z "$base" ]; then
  base="$first"; base_source="first-commit"
  if [ "$reg_state" = unpublished ]; then
    base_label="the first commit ($(md "$pkgname") is not on $registry yet)"
  else
    base_label="the first commit (COULD NOT DETERMINE THE LAST PUBLISHED VERSION)"
    warn "could not determine the commit of the last published version, so this summary covers the whole history; check the last published version's commit yourself before approving"
  fi
fi

compare="$server/$repo/compare/$base...$sha"
range=("$base..$sha")
[ "$base_source" != first-commit ] || range=("$sha")   # from the first commit: everything up to sha, including it
total=$(git rev-list --count "${range[@]}")
in_pkg=$(git rev-list --count "${range[@]}" -- "$pkgdir")
workflow_touch=$(git rev-list --count "${range[@]}" -- .github docs/drafts integrations/release-tools)

echo "### Changes since $base_label"
echo
if [ "${#untrusted[@]}" -gt 0 ]; then
  warn "untrusted tags (version not on $registry, or not at the registry's commit), ignored for the base: ${untrusted[*]}"
fi
if [ "${#warnings[@]}" -gt 0 ]; then
  echo "> [!WARNING]"
  for w in "${warnings[@]}"; do echo "> - **WARNING:** $(md "$w")"; done
  echo
fi
echo "- Compare: $compare"
echo "- Commits: $total in total, $in_pkg touching \`$pkgdir\`, $workflow_touch touching \`.github\`, \`docs/drafts\` or \`integrations/release-tools\`"
echo
echo "<details><summary>Commit list (newest first, up to $max)</summary>"
echo
echo "<pre>"
while IFS=$'\x1f' read -r full short subj author date; do
  echo "<a href=\"$(h "$server/$repo/commit/$full")\">$short</a> $(h "$subj") ($(h "$author"), $date)"
done < <(git log --format='%H%x1f%h%x1f%s%x1f%an%x1f%ad' --date=short -n "$max" "${range[@]}")
[ "$total" -le "$max" ] || echo "... and $((total - max)) more (see the compare link)"
echo "</pre>"
echo
echo "</details>"
echo
echo "<details><summary>Files changed in $(h "$pkgdir")</summary>"
echo
echo "<pre>"
if [ "$base_source" != first-commit ]; then git diff --stat=100 "$base" "$sha" -- "$pkgdir"; else git ls-tree -r --name-only "$sha" -- "$pkgdir" | head -n 200; fi \
  | while IFS= read -r line; do h "$line"; echo; done
echo "</pre>"
echo
echo "</details>"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  { echo "base=$base"; echo "base_source=$base_source"; echo "compare_url=$compare"; echo "commits=$total"; } >> "$GITHUB_OUTPUT"
fi
