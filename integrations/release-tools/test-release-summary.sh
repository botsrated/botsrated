#!/usr/bin/env bash
# Self-test for release-summary.sh in a throwaway repo, with fake `npm` and `curl` on PATH (no network).
#   usage: bash integrations/release-tools/test-release-summary.sh
# Needs git and jq. Covers Security F-1 (the base comes from the registry, planted or moved tags are flagged) and
# F-2 (commit subjects, authors and file names can't add Markdown or break out of the <pre> blocks).
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); rs="$here/release-summary.sh"
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
pass=0; failn=0
check() { # check <label> <command...>: the command must succeed (grep etc. on $t/out)
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then pass=$((pass+1)); echo "ok   - $label"; else failn=$((failn+1)); echo "FAIL - $label"; sed 's/^/     | /' "$t/out"; fi
}
has()  { grep -qF -- "$1" "$t/out"; }
hasnt() { ! grep -qF -- "$1" "$t/out"; }
base_is() { grep -qxF "base=$1" "$t/gh_out"; }

# Fake npm: `npm view <pkg> --json` prints $t/npm/json (or $t/npm/err and exits 1); `npm view <pkg>@<v> gitHead`
# prints $t/npm/githead.
mkdir -p "$t/bin" "$t/npm" "$t/curl"
cat > "$t/bin/npm" <<'SH'
#!/usr/bin/env bash
d="$FAKE/npm"
if [ "$1 $3" = "view --json" ]; then
  if [ -f "$d/err" ]; then cat "$d/err" >&2; exit 1; fi; cat "$d/json"; exit 0
fi
if [ "$1 $3" = "view gitHead" ]; then cat "$d/githead" 2>/dev/null; exit 0; fi
echo "fake npm: unexpected args $*" >&2; exit 99
SH
# Fake curl: prints $t/curl/body to the -o file (or stdout) and $t/curl/code for -w; with -f and a code >= 400, fails.
cat > "$t/bin/curl" <<'SH'
#!/usr/bin/env bash
d="$FAKE/curl"; o=""; w=""; f=""
while [ "$#" -gt 0 ]; do case "$1" in -o) o="$2"; shift;; -w) w="$2"; shift;; -f*) f=1;; esac; shift; done
code=$(cat "$d/code" 2>/dev/null || echo 000)
if [ "$code" = 000 ]; then exit 6; fi
if [ -n "$f" ] && [ "$code" -ge 400 ]; then exit 22; fi
if [ -n "$o" ]; then cat "$d/body" > "$o" 2>/dev/null || : > "$o"; else cat "$d/body" 2>/dev/null; fi
[ -z "$w" ] || printf '%s' "$code"
SH
chmod +x "$t/bin/npm" "$t/bin/curl"
export FAKE="$t" PATH="$t/bin:$PATH"

reset_fakes() { rm -f "$t"/npm/* "$t"/curl/*; }
npm_published() { # npm_published <latest> <githead> <versions...>
  local latest="$1" gh="$2"; shift 2
  jq -n --arg l "$latest" '{"dist-tags": {latest: $l}, versions: $ARGS.positional}' --args "$@" > "$t/npm/json"
  printf '%s\n' "$gh" > "$t/npm/githead"
}
pypi() { # pypi <http-code> [<latest> <versions...>]
  echo "$1" > "$t/curl/code"; shift
  if [ "$#" -gt 0 ]; then
    local latest="$1"; shift
    jq -n --arg l "$latest" '{info: {version: $l}, releases: ($ARGS.positional | map({(.): []}) | add)}' --args "$@" > "$t/curl/body"
  fi
}
run() { # run <npm|pypi> <name>: summary for HEAD into $t/out, outputs into $t/gh_out
  : > "$t/gh_out"
  GITHUB_OUTPUT="$t/gh_out" bash "$rs" pkg "$head" pkgdir o/r https://github.example "$1" "$2" > "$t/out" 2>"$t/err" || { echo "exit $?" >> "$t/out"; cat "$t/err" >> "$t/out"; }
}

# Repo: first -> released (0.1.0) -> MALICIOUS backdoor -> later (planted pkg-v9.9.9 here) -> hostile subject/file.
git init -q -b main "$t/repo"; cd "$t/repo"
git config user.name t; git config user.email t@example.invalid; git config tag.gpgSign false; git config commit.gpgSign false
mkdir pkgdir; echo 0 > pkgdir/a; git add .; git commit -qm first; first=$(git rev-parse HEAD)
echo 1 > pkgdir/a; git commit -qam released; rel=$(git rev-parse HEAD)
git tag -a -m r pkg-v0.1.0 "$rel"
echo evil > pkgdir/a; git commit -qam "MALICIOUS backdoor"
echo 2 > pkgdir/b; git add .; git commit -qm later; later=$(git rev-parse HEAD)
git tag pkg-v9.9.9 "$later"
fname='pkgdir/x```y&<img src=x>.txt'
echo h > "$fname"; git add .
# (git drops < and > from author names)
git -c user.name='Eve **[admin](https://evil.example)** </pre>' commit -qm \
  'feat: **APPROVED BY SECURITY** [safe](https://evil.example) ![i](https://evil.example/i.png) </pre> ``` <img src=x> &amp;'
head=$(git rev-parse HEAD)

echo "# F-1: npm"
reset_fakes; npm_published 0.1.0 "$rel" 0.1.0; run npm @s/pkg
check "npm: base is the gitHead of the latest version, not the newest tag" base_is "$rel"
check "npm: the malicious commit is listed"                               has "MALICIOUS backdoor"
check "npm: the planted tag pkg-v9.9.9 is flagged as untrusted"          has "untrusted tags"
check "npm: ... and named"                                               has "pkg\\-v9\\.9\\.9"
check "npm: the label names the registry version"                        has "last published version @s/pkg 0\\.1\\.0"
check "npm: the planted tag is not the base"                             hasnt "Changes since last release tag"
check "npm: commit count is 3 (malicious, later, hostile)"               grep -qxF "commits=3" "$t/gh_out"
check "npm: base_source output"                                          grep -qxF "base_source=npm:0.1.0" "$t/gh_out"

git tag -f -a -m moved pkg-v0.1.0 "$later" >/dev/null
reset_fakes; npm_published 0.1.0 "$rel" 0.1.0; run npm @s/pkg
check "npm: a moved tag for the real version doesn't change the base"    base_is "$rel"
check "npm: ... and is reported as moved or planted"                     has "the tag was moved or planted"
git tag -f -a -m r pkg-v0.1.0 "$rel" >/dev/null

reset_fakes; npm_published 0.1.0 "" 0.1.0
payload=$(jq -nc --arg c "$rel" '{predicate: {buildDefinition: {resolvedDependencies: [{digest: {gitCommit: $c}}]}}}' | base64 -w0)
jq -n --arg p "$payload" '{attestations: [{predicateType: "https://slsa.dev/provenance/v1", bundle: {dsseEnvelope: {payload: $p}}}]}' > "$t/curl/body"
echo 200 > "$t/curl/code"; run npm @s/pkg
check "npm: no gitHead, base from the provenance attestation"            base_is "$rel"
check "npm: ... labelled as provenance"                                  has "npm provenance of"

reset_fakes; npm_published 0.1.0 "" 0.1.0; echo 404 > "$t/curl/code"; run npm @s/pkg
check "npm: no gitHead or provenance, falls back to the version's tag"   base_is "$rel"
check "npm: ... with a warning that npm doesn't confirm it"              has "which the registry doesn"

reset_fakes; npm_published 0.1.0 0123456789abcdef0123456789abcdef01234567 0.1.0; run npm @s/pkg
check "npm: gitHead not in the repo -> first commit"                    base_is "$first"
check "npm: ... loudly"                                                  has "COULD NOT DETERMINE"
check "npm: ... and says why"                                            has "is not a commit in this repository"

git checkout -q -b side "$first"; echo s > side; git add side; git commit -qm side; side=$(git rev-parse HEAD); git checkout -q main
reset_fakes; npm_published 0.1.0 "$side" 0.1.0; run npm @s/pkg
check "npm: gitHead not an ancestor -> first commit, loudly"            has "is not an ancestor of"
check "npm: ... base is the first commit"                                base_is "$first"

reset_fakes; echo "npm error code E404" > "$t/npm/err"; run npm @s/pkg
check "npm: never published -> first commit"                            base_is "$first"
check "npm: ... says not on npm yet"                                     has "is not on npm yet"
check "npm: ... and existing tags are untrusted"                         has "pkg\\-v0\\.1\\.0"

reset_fakes; echo "npm error code ENOTFOUND registry.npmjs.org" > "$t/npm/err"; run npm @s/pkg
check "npm: registry unreachable -> first commit"                        base_is "$first"
check "npm: ... loudly"                                                  has "COULD NOT DETERMINE"
check "npm: ... a WARNING block"                                          has "> [!WARNING]"
check "npm: ... and an Actions warning annotation"                       grep -qF "::warning::" "$t/err"

echo "# F-1: PyPI"
reset_fakes; pypi 200 0.1.0 0.1.0; run pypi pkg
check "pypi: base is the tag of the latest PyPI version"                 base_is "$rel"
check "pypi: the planted tag is untrusted"                               has "untrusted tags"
check "pypi: the malicious commit is listed"                             has "MALICIOUS backdoor"

reset_fakes; pypi 200 0.2.0 0.1.0 0.2.0; run pypi pkg
check "pypi: latest version has no tag -> first commit"                  base_is "$first"
check "pypi: ... loudly"                                                 has "COULD NOT DETERMINE"

reset_fakes; pypi 404; run pypi pkg
check "pypi: never published -> first commit"                           base_is "$first"
check "pypi: ... says not on pypi yet"                                   has "is not on pypi yet"
check "pypi: ... no COULD NOT warning"                                   hasnt "COULD NOT DETERMINE"

reset_fakes; pypi 503; run pypi pkg
check "pypi: PyPI error -> first commit"                                 base_is "$first"
check "pypi: ... loudly"                                                 has "COULD NOT DETERMINE"

echo "# F-2: escaping"
reset_fakes; npm_published 0.1.0 "$rel" 0.1.0; run npm @s/pkg
nohtml() { sed -e 's#<a href="[^"<>]*">[0-9a-f]*</a>##g' -e 's#</\{0,1\}\(pre\|details\|summary\)>##g' -e 's#^> ##' "$t/out" | grep -q '[<>]' && return 1 || return 0; }
check "exactly two <pre> blocks"                                         test "$(grep -cxF '<pre>' "$t/out")" = 2
check "exactly two </pre> lines (subjects can't close the block)"         test "$(grep -cxF '</pre>' "$t/out")" = 2
check "no raw < or > besides the script's own tags"                      nohtml
check "no backticks from commit data (no code fence)"                    hasnt '```'
check "subject is HTML-escaped"                                          has "&lt;/pre&gt; &#96;&#96;&#96; &lt;img src=x&gt; &amp;amp;"
check "subject's Markdown is inert (inside <pre>)"                       has "**APPROVED BY SECURITY** [safe](https://evil.example)"
check "author's Markdown is inert (inside <pre>)"                        has "(Eve **[admin](https://evil.example)** /pre, "
check "file name is HTML-escaped"                                        has "x&#96;&#96;&#96;y&amp;&lt;img src=x&gt;.txt"
check "commit links still point at the commit"                           has "<a href=\"https://github.example/o/r/commit/$head\">"

echo
echo "$pass passed, $failn failed"
[ "$failn" -eq 0 ]
