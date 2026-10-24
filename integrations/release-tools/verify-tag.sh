#!/usr/bin/env bash
# Optional: verifies a signed release tag. The release workflows (docs/drafts/publish-*.yml) don't require it;
# see docs/drafts/README.md. Kept for maintainers who can sign tags.
#   usage: verify-tag.sh <tag> <expected-tag> <signers-dir> [<allowlist>]
# - the tag is an annotated tag named exactly <expected-tag> (<package>-v<version> from the package manifest);
# - its signature verifies against ONLY the signer keys in <signers-dir> (allowed_signers for SSH-signed tags and/or
#   *.asc public keys for GPG-signed tags), which the workflow takes from main, never from the tag itself. GPG runs
#   with a fresh, empty GNUPGHOME, so keys already on the runner are never accepted;
# - the fingerprint of the key that made the signature is listed in <allowlist> (default: signers.txt next to this
#   script, also from main). A valid signature by a key that is not listed is rejected;
# - the tagged commit is on main (so only reviewed code is released).
set -euo pipefail
tag="$1"; expected="$2"; signers="$3"
allowlist="${4:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/signers.txt}"
fail() { echo "::error::$*"; exit 1; }

if [ "$tag" != "$expected" ]; then fail "tag '$tag' does not match the package version (expected '$expected')"; fi
if [ "$(git cat-file -t "refs/tags/$tag" 2>/dev/null)" != "tag" ]; then fail "'$tag' is not an annotated (signable) tag"; fi

# Pinned fingerprints: one per line; GPG = 40 hex characters (spaces allowed), SSH = SHA256:<base64>. '#' comments.
[ -f "$allowlist" ] || fail "no signer allowlist at $allowlist"
pinned=$(sed -e 's/#.*//' "$allowlist" | tr -d ' \t\r' | grep -v '^$' || true)
[ -n "$pinned" ] || fail "signer allowlist $allowlist is empty: add the release signer fingerprint(s) first (see the file's header)"
is_pinned() { # $1 = fingerprint as reported
  local f="$1"
  case "$f" in SHA256:*) grep -qxF -- "$f" <<<"$pinned" ;; *) grep -qixF -- "$(tr -d ' ' <<<"$f")" <<<"$pinned" ;; esac
}

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
export GNUPGHOME="$work/gnupg"; mkdir -m 700 "$GNUPGHOME"   # empty keyring: only the keys imported below exist
allowed="$work/allowed_signers"; : > "$allowed"             # empty unless the signers dir has one
found=0
if [ -f "$signers/allowed_signers" ]; then cp "$signers/allowed_signers" "$allowed"; found=1; fi
shopt -s nullglob
for k in "$signers"/*.asc; do gpg --batch --quiet --import "$k" 2>/dev/null; found=1; done
[ "$found" = 1 ] || fail "no release signer keys in $signers (on main)"

# --raw prints the verifier's machine-readable output; config is forced so no runner or repo setting is used.
out="$work/verify.out"
if ! git -c gpg.program=gpg -c gpg.ssh.program=ssh-keygen -c gpg.ssh.allowedSignersFile="$allowed" \
     verify-tag --raw "$tag" >"$out" 2>&1; then
  cat "$out"; fail "signature on '$tag' does not verify against the keys in $signers"
fi

fp=""
if grep -q '^\[GNUPG:\] VALIDSIG ' "$out"; then
  [ "$(grep -c '^\[GNUPG:\] VALIDSIG ' "$out")" = 1 ] || fail "'$tag' carries more than one signature"
  grep -q '^\[GNUPG:\] GOODSIG ' "$out" || fail "no good GPG signature on '$tag'"
  read -r _ _ sub _ _ _ _ _ _ _ _ primary _ < <(grep '^\[GNUPG:\] VALIDSIG ' "$out")
  if is_pinned "$sub"; then fp="$sub"; elif [ -n "${primary:-}" ] && is_pinned "$primary"; then fp="$primary"; fi
  [ -n "$fp" ] || fail "'$tag' is signed by GPG key ${primary:-$sub}, which is not in $allowlist"
else
  ssh_fp=$(grep -oE 'key SHA256:[A-Za-z0-9+/=]+' "$out" | head -n1 | cut -d' ' -f2 || true)
  [ -n "$ssh_fp" ] || { cat "$out"; fail "could not read the signing key fingerprint for '$tag'"; }
  is_pinned "$ssh_fp" || fail "'$tag' is signed by SSH key $ssh_fp, which is not in $allowlist"
  fp="$ssh_fp"
fi

git merge-base --is-ancestor "refs/tags/$tag^{commit}" origin/main || fail "$tag is not on main"
echo "verified: $tag -> $(git rev-parse "refs/tags/$tag^{commit}") (signer $fp)"
